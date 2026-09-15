-- Uitgaande urenmail - ronde vier: drie kleine dingen die stil het verkeerde
-- deden.
--
-- 1. De opslag nam een Poolse klantregel aan die de planner weigert. Het scherm
--    meldde "opgeslagen" en die regel verstuurde nooit iets.
-- 2. `last_issues` staat per opdrachtgever maar werd per week overschreven, dus
--    van de vijfentwintig weken die een run plant bleef alleen de laatste over.
-- 3. Een profiel opslaan maakte `last_planned_at` leeg, en daarmee sprong die
--    opdrachtgever telkens naar de kop van de wachtrij.

begin;

create or replace function private.hours_mail_rules_valid(p_rules jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v_rule jsonb; v_ids text[] := '{}'; begin
  if jsonb_typeof(p_rules) is distinct from 'array' then return 'De berichtregels moeten een lijst zijn'; end if;
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(v_rule) is distinct from 'object' then return 'Een berichtregel moet een object zijn'; end if;
    if nullif(btrim(coalesce(v_rule->>'id', '')), '') is null or length(v_rule->>'id') > 120 then
      return 'Elke berichtregel heeft een eigen, vaste id nodig';
    end if;
    if (v_rule->>'id') = any(v_ids) then return 'Twee berichtregels delen dezelfde id'; end if;
    v_ids := v_ids || (v_rule->>'id');
    if jsonb_typeof(v_rule->'enabled') is distinct from 'boolean' then
      return 'Zet elke berichtregel expliciet aan of uit';
    end if;
    -- A deadline escalation is a task for the responsible person and belongs to
    -- T11. Accepting one here would store a message that never goes anywhere.
    if (v_rule->>'mailType') in ('submission_deadline', 'approval_deadline') then
      return 'Een deadlinetaak hoort bij het interne weekoverzicht, niet bij de uitgaande mail';
    end if;
    if (v_rule->>'mailType') not in ('hours_request', 'approval_request', 'submission_reminder',
      'approval_reminder', 'correction_query') then
      return 'Onbekende berichtsoort';
    end if;
    if (v_rule->>'party') not in ('customer', 'employee', 'internal') then return 'Onbekende partij'; end if;
    if jsonb_typeof(v_rule->'recipientIds') is distinct from 'array'
       or jsonb_array_length(v_rule->'recipientIds') = 0
       or jsonb_array_length(v_rule->'recipientIds') > 25 then
      return 'Kies tussen een en vijfentwintig ontvangers per berichtsoort';
    end if;
    -- "Everyone on this week" only means something for the employees on it.
    if coalesce(v_rule->'recipientIds', '[]'::jsonb) @> '["*"]'::jsonb then
      if (v_rule->>'party') <> 'employee' then
        return 'Alle medewerkers van de week kan alleen bij een bericht aan medewerkers';
      end if;
      if jsonb_array_length(v_rule->'recipientIds') <> 1 then
        return 'Kies of alle medewerkers van de week, of een vaste lijst; niet allebei';
      end if;
    end if;
    if nullif(btrim(coalesce(v_rule->>'templateId', '')), '') is null then
      return 'Kies de tekst die bij deze berichtsoort hoort';
    end if;
    if (v_rule->>'language') not in ('nl', 'en', 'pl') then return 'Kies een taal'; end if;
    -- Dezelfde grens die de planner trekt, en op hetzelfde moment: die slaat een
    -- uitgeschakelde regel over voordat hij naar de taal kijkt. Strenger zijn zou
    -- een heel profiel onopslaanbaar maken door een regel die niets doet.
    -- Nam de opslag deze combinatie wel aan, dan meldde het scherm "opgeslagen"
    -- en verstuurde die regel daarna nooit iets, zonder dat ergens te zien was
    -- waarom.
    if (v_rule->'enabled')::boolean is true
       and (v_rule->>'party') = 'customer' and (v_rule->>'language') = 'pl' then
      return 'Pools kan niet naar een opdrachtgever; kies Nederlands of Engels';
    end if;
    if jsonb_typeof(v_rule->'at') is distinct from 'object' then return 'Kies een verzendmoment'; end if;
    if (v_rule->'at'->>'kind') not in ('week_time', 'deadline_offset') then
      return 'Een verzendmoment is een weekmoment of een verschuiving ten opzichte van een deadline';
    end if;
  end loop;
  return null;
end $$;

create or replace function public.hours_outbox_sync(p_week_id uuid, p_actions jsonb,
  p_issues jsonb default '[]'::jsonb, p_prune boolean default true,
  p_prune_keys jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_week public.hours_weeks%rowtype; v_action jsonb; v_source text; v_status text; v_block text;
  v_existing public.hours_outbox_messages%rowtype; v_keys text[] := '{}'; v_now timestamptz := clock_timestamp();
  v_stale boolean; v_approved boolean; v_had_approval boolean;
  v_planned integer := 0; v_expired integer := 0; v_issue text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de urenmailfunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_week from public.hours_weeks where id = p_week_id for update;
  if not found then raise exception 'Onbekende urenweek' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_week.organization_id);
  if jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions) > 200 then
    raise exception 'Ongeldige planning' using errcode = '22023';
  end if;
  -- Vooraan, bij de andere argumentcontroles: verderop zou een afgekeurde
  -- melding de hele planning terugdraaien die er al in stond.
  if p_issues is not null and jsonb_typeof(p_issues) is distinct from 'array' then
    raise exception 'Ongeldige melding' using errcode = '22023';
  end if;
  v_source := private.hours_week_source_revision(v_week.id, v_week.organization_id);
  for v_action in select value from jsonb_array_elements(p_actions) loop
    v_keys := v_keys || (v_action->>'dedup_key');
    v_issue := nullif(v_action->>'issue', '');
    if v_issue is not null then
      v_status := 'concept'; v_block := v_issue;
    elsif (v_action->>'status') = 'due' then
      v_status := case when (v_action->>'approval_required')::boolean then 'goedgekeurd' else 'gereed' end;
      v_block := null;
    elsif (v_action->>'status') = 'skipped' then
      v_status := 'vervallen'; v_block := coalesce(v_action->>'reason', 'niet_meer_nodig');
    else
      v_status := 'concept';
      v_block := coalesce(v_action->>'reason', v_action->>'status');
      if v_block = 'correction_approval_required' then v_block := 'goedkeuring_vereist'; end if;
    end if;
    select * into v_existing from public.hours_outbox_messages
      where organization_id = v_week.organization_id and dedup_key = (v_action->>'dedup_key') for update;
    if found then
      -- Terminal, expliciet gestopt, of onderweg: onaangeroerd laten. Alleen
      -- `ingetrokken` staat vast; `opnieuw_plannen` en `niet_meer_gepland` mag de
      -- planner weer oppakken.
      if v_existing.status in ('verzonden', 'mislukt')
         or (v_existing.status = 'vervallen' and v_existing.block_reason = 'ingetrokken')
         -- Elke rij met een claim-token blijft met rust, ook als de lease allang
         -- afliep. Overschrijven zou het token laten staan zonder dat iemand nog
         -- kijkt of die mail is vertrokken; de claimveger is de enige plek waar
         -- die onzekerheid wordt beslecht.
         or v_existing.claim_token is not null then
        continue;
      end if;
      v_had_approval := v_existing.approved_at is not null;
      v_stale := v_had_approval
        and (v_existing.approved_content_hash is distinct from (v_action->>'content_hash')
             or v_existing.approved_source_revision is distinct from v_source);
      v_approved := v_had_approval and not v_stale;
      if v_status = 'goedgekeurd' and not v_approved then
        v_status := 'concept';
        v_block := case when v_stale then 'goedkeuring_vervallen' else 'goedkeuring_vereist' end;
      elsif v_approved and v_status = 'concept' and v_block is null then
        v_status := 'goedgekeurd';
      elsif v_stale and v_status = 'concept' and v_block is null then
        -- De planner zegt "wacht op goedkeuring" omdat hij dezelfde vergelijking
        -- maakt. De goedkeurder hoort te horen dát zijn eerdere akkoord verviel,
        -- niet alleen dat er nog een akkoord nodig is.
        v_block := 'goedkeuring_vervallen';
      end if;
      update public.hours_outbox_messages set
        scheduled_at = (v_action->>'scheduled_at')::timestamptz,
        effective_at = (v_action->>'effective_at')::timestamptz,
        status = v_status, block_reason = v_block,
        approval_required = (v_action->>'approval_required')::boolean,
        subject = coalesce(v_action->>'subject', ''), body_html = coalesce(v_action->>'body_html', ''),
        recipients = coalesce(v_action->'recipients', '[]'::jsonb),
        company_contact_id = nullif(v_action->>'company_contact_id', '')::uuid,
        candidate_id = nullif(v_action->>'candidate_id', '')::uuid,
        content_hash = v_action->>'content_hash', source_revision = v_source,
        request_id = nullif(v_action->>'request_id', '')::uuid,
        approved_by = case when v_approved then approved_by else null end,
        approved_at = case when v_approved then approved_at else null end,
        approved_content_hash = case when v_approved then approved_content_hash else null end,
        approved_source_revision = case when v_approved then approved_source_revision else null end
        where id = v_existing.id;
    else
      insert into public.hours_outbox_messages(organization_id, week_id, company_id, dedup_key, rule_id,
        mail_type, party, recipient_id, scheduled_at, effective_at, status, block_reason,
        approval_required, subject, body_html, recipients, company_contact_id, candidate_id,
        content_hash, source_revision, request_id)
        values (v_week.organization_id, v_week.id, v_week.company_id, v_action->>'dedup_key',
          v_action->>'rule_id', v_action->>'mail_type', v_action->>'party', v_action->>'recipient_id',
          (v_action->>'scheduled_at')::timestamptz, (v_action->>'effective_at')::timestamptz,
          case when v_status = 'goedgekeurd' then 'concept' else v_status end,
          case when v_status = 'goedgekeurd' then 'goedkeuring_vereist' else v_block end,
          (v_action->>'approval_required')::boolean,
          coalesce(v_action->>'subject', ''), coalesce(v_action->>'body_html', ''),
          coalesce(v_action->'recipients', '[]'::jsonb),
          nullif(v_action->>'company_contact_id', '')::uuid, nullif(v_action->>'candidate_id', '')::uuid,
          v_action->>'content_hash', v_source, nullif(v_action->>'request_id', '')::uuid);
    end if;
    v_planned := v_planned + 1;
  end loop;
  -- Opruimen mag alleen als deze aanroep de hele planning van de week zag. Een
  -- afgekapte lijst die tóch opruimt, vernietigt precies de berichten die er
  -- niet meer in pasten - inclusief een goedkeuring van een mens.
  if p_prune_keys is not null and (jsonb_typeof(p_prune_keys) is distinct from 'array'
      or jsonb_array_length(p_prune_keys) > 2000) then
    raise exception 'Ongeldige planning' using errcode = '22023';
  end if;
  if p_prune then
    update public.hours_outbox_messages set status = 'vervallen', block_reason = 'niet_meer_gepland'
      where week_id = v_week.id and organization_id = v_week.organization_id
        and status in ('concept', 'gereed', 'goedgekeurd')
        and not (dedup_key = any(coalesce(
          (select array_agg(value) from jsonb_array_elements_text(p_prune_keys)), v_keys)))
        and claim_token is null;
    get diagnostics v_expired = row_count;
  end if;
  -- `last_issues` staat per opdrachtgever maar wordt per week geschreven, en een
  -- run plant er vijfentwintig. Vervangen zou betekenen dat de laatste week
  -- alles overschrijft wat de eerdere te melden hadden. Dus: alleen de meldingen
  -- van deze week vervangen, de rest laten staan, en het geheel begrenzen.
  update public.hours_mail_profiles f set
    last_issues = (
      select coalesce(jsonb_agg(entry order by rang, volgorde), '[]'::jsonb) from (
        select entry, rang, volgorde from (
          -- Deze planning eerst. Het plafond moet knippen in wat oud is, nooit
          -- in wat deze run net te melden had - dat is precies waar hij voor
          -- liep. De opslag stempelt de week zelf, zodat die niet van een
          -- aanroeper kan afhangen.
          select jsonb_set(value, '{weekStart}', to_jsonb(v_week.week_start::text)) as entry,
                 0 as rang, ordinaliteit as volgorde
            from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb))
              with ordinality as nieuw(value, ordinaliteit)
          union all
          -- Wat andere weken meldden blijft staan. Een melding zonder week is
          -- van voor deze migratie: die hoort bij de week die het laatst plande
          -- en is niet toe te wijzen, dus die vervalt hier eenmalig.
          select value, 1, ordinaliteit
            from jsonb_array_elements(coalesce(f.last_issues, '[]'::jsonb))
              with ordinality as oud(value, ordinaliteit)
            where value->>'weekStart' is distinct from v_week.week_start::text
              and value->>'weekStart' is not null
        ) as alles
        order by rang, volgorde
        limit 50) as kept),
    last_planned_at = v_now
    where f.company_id = v_week.company_id and f.organization_id = v_week.organization_id;
  return jsonb_build_object('ok', true, 'planned', v_planned, 'expired', v_expired,
    'pruned', p_prune, 'issues', coalesce(p_issues, '[]'::jsonb));
end $$;

create or replace function public.hours_save_mail_profile(p_company_id uuid, p_expected_version integer,
  p_rules jsonb, p_late_approval_mode text default 'require_review',
  p_late_approval_window_minutes integer default 60)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_version integer; v_error text; begin
  perform 1 from public.companies where id = p_company_id and organization_id = v_org for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  v_error := private.hours_mail_rules_valid(p_rules);
  if v_error is not null then raise exception '%', v_error using errcode = '22023'; end if;
  if p_late_approval_mode not in ('require_review', 'send_if_window') then
    raise exception 'Kies een regel voor late aanlevering' using errcode = '22023';
  end if;
  if p_late_approval_window_minutes is null or p_late_approval_window_minutes not between 1 and 20160 then
    raise exception 'Kies een akkoordvenster tussen een minuut en veertien dagen' using errcode = '22023';
  end if;
  select version into v_version from public.hours_mail_profiles
    where company_id = p_company_id and organization_id = v_org for update;
  if coalesce(v_version, 0) is distinct from coalesce(p_expected_version, 0) then
    raise exception 'Het mailprofiel is ondertussen gewijzigd; laad opnieuw' using errcode = 'PT409';
  end if;
  insert into public.hours_mail_profiles(company_id, organization_id, version, late_approval_mode,
    late_approval_window_minutes, rules, updated_by, updated_at)
    values (p_company_id, v_org, 1, p_late_approval_mode, p_late_approval_window_minutes,
      p_rules, auth.uid(), clock_timestamp())
    on conflict (company_id) do update set version = public.hours_mail_profiles.version + 1,
      late_approval_mode = excluded.late_approval_mode,
      late_approval_window_minutes = excluded.late_approval_window_minutes,
      rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
      -- Nieuwe regels, dus de klachten van de vorige planning gaan over iets wat
      -- niet meer bestaat. Ze komen vanzelf terug als ze nog gelden.
      -- `last_planned_at` blijft bewust staan: `due_weeks` sorteert daarop met
      -- `nulls first`, dus leegmaken zette deze opdrachtgever telkens vooraan.
      -- Wie zijn profiel vaak bewerkt, hongerde de rest daarmee uit.
      last_issues = '[]'::jsonb;
  return public.hours_get_mail_profile(p_company_id);
end $$;

do $$
begin
  execute 'revoke all on function public.hours_outbox_sync(uuid, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated, service_role';
  execute 'grant execute on function public.hours_outbox_sync(uuid, jsonb, jsonb, boolean, jsonb) to service_role';
  execute 'revoke all on function private.hours_mail_rules_valid(jsonb) from public, anon, authenticated, service_role';
end $$;

comment on function private.hours_mail_rules_valid(jsonb) is 'Bewaakt dezelfde grenzen als de planner, zodat een opgeslagen regel er ook een is die kan vertrekken. Een regel die de planner zou weigeren, wordt hier al geweigerd - met een reden die op het scherm past.';

commit;
notify pgrst, 'reload schema';
