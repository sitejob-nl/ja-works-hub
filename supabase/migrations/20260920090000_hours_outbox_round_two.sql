-- T8, tweede reviewronde. Vier defecten, waarvan drie door de eerste ronde
-- reparaties zijn veroorzaakt — fixes zijn waar nieuwe fouten ontstaan.
--
--  1. **Van de lijst halen was een eenrichtingsdeur, en het scherm beloofde het
--     tegendeel.** Intrekken zette `vervallen` + `ingetrokken`, en de nieuwe
--     bescherming uit ronde één slaat precies die combinatie voorgoed over. Een
--     mislukt bericht "van de lijst halen" doodde dus de hele week. Er zijn nu
--     twee bedoelingen: `ingetrokken` (een mens stopt dit, definitief) en
--     `opnieuw_plannen` (haal het weg zodat de planner het opnieuw voorstelt).
--  2. **Een gesneuvelde verzendpoging stuurde de mail nog een keer.** Een
--     verlopen lease legde het bericht terug in de wachtrij, ook als de mail al
--     bij de klant lag en alleen het vastleggen was mislukt. Stilte betekent nu
--     onzekerheid, en onzekerheid gaat naar een mens: `mislukt` met
--     `verzending_onzeker`. De enige weg terug naar de wachtrij is een
--     expliciete mededeling dát er niets is verstuurd.
--  3. **De claim controleerde de ontvanger niet.** Een regel bleef aanstaan maar
--     wees inmiddels iemand anders aan; het klaarstaande bericht ging alsnog
--     naar de vertrokken contactpersoon.
--  4. **Een vervallen goedkeuring zei "wacht op goedkeuring" in plaats van "de
--     uren zijn gewijzigd".** Precies het signaal dat het contract belooft.
--
-- Daarnaast krijgt `hours_outbox_sync` een `p_prune`-schakelaar, zodat een
-- planning die niet in één keer past niets meer opruimt wat hij niet zag.
begin;

-- --------------------------------------------------------------------------
-- 1: twee bedoelingen achter "van de lijst halen"
-- --------------------------------------------------------------------------
drop function if exists public.hours_withdraw_outbox_message(uuid, text);

create or replace function public.hours_withdraw_outbox_message(p_id uuid, p_note text default null,
  p_allow_replan boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_row public.hours_outbox_messages%rowtype; begin
  select * into v_row from public.hours_outbox_messages
    where id = p_id and organization_id = v_org for update;
  if not found then raise exception 'Geen toegang tot dit bericht' using errcode = '42501'; end if;
  if v_row.status = 'verzonden' then
    raise exception 'Dit bericht is al verstuurd' using errcode = '22023';
  end if;
  if v_row.claim_token is not null and v_row.lease_expires_at > clock_timestamp() then
    raise exception 'Dit bericht wordt op dit moment verstuurd; probeer het zo opnieuw' using errcode = 'PT409';
  end if;
  update public.hours_outbox_messages set status = 'vervallen',
    -- `ingetrokken` is een besluit dat blijft staan; `opnieuw_plannen` haalt het
    -- alleen van de lijst en laat de eerstvolgende planning het weer voorstellen.
    block_reason = case when p_allow_replan then 'opnieuw_plannen' else 'ingetrokken' end,
    approved_by = null, approved_at = null,
    approved_content_hash = null, approved_source_revision = null,
    attempt_count = case when p_allow_replan then 0 else attempt_count end,
    next_attempt_at = null,
    last_error = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
    where id = p_id;
  return public.hours_outbox_overview(v_row.week_id, null, 200);
end $$;

-- --------------------------------------------------------------------------
-- 2 + 4: sync respecteert het besluit, meldt een vervallen goedkeuring,
--        en ruimt niets op wat hij niet gezien heeft
-- --------------------------------------------------------------------------
create or replace function public.hours_outbox_sync(p_week_id uuid, p_actions jsonb,
  p_issues jsonb default '[]'::jsonb, p_prune boolean default true)
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
         or (v_existing.claim_token is not null and v_existing.lease_expires_at > v_now) then
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
      elsif v_stale and v_status = 'concept' then
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
  if p_prune then
    update public.hours_outbox_messages set status = 'vervallen', block_reason = 'niet_meer_gepland'
      where week_id = v_week.id and organization_id = v_week.organization_id
        and status in ('concept', 'gereed', 'goedgekeurd')
        and not (dedup_key = any(v_keys))
        and claim_token is null;
    get diagnostics v_expired = row_count;
  end if;
  update public.hours_mail_profiles set
    last_issues = case when jsonb_typeof(p_issues) = 'array'
      and jsonb_array_length(p_issues) <= 50 then p_issues else '[]'::jsonb end,
    last_planned_at = v_now
    where company_id = v_week.company_id and organization_id = v_week.organization_id;
  return jsonb_build_object('ok', true, 'planned', v_planned, 'expired', v_expired,
    'pruned', p_prune, 'issues', coalesce(p_issues, '[]'::jsonb));
end $$;

-- --------------------------------------------------------------------------
-- 2 + 3: stilte is onzekerheid, en de ontvanger moet nog bij de regel horen
-- --------------------------------------------------------------------------
create or replace function public.hours_outbox_claim(p_limit integer default 1,
  p_lease_seconds integer default 300, p_organization_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token uuid := gen_random_uuid(); v_rows jsonb; v_now timestamptz := clock_timestamp(); begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de urenmailfunctie mag dit doen' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 25
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Ongeldige claim' using errcode = '22023';
  end if;
  -- Een lease die afliep zonder uitsluitsel betekent dat niemand weet of de mail
  -- is vertrokken. Terugleggen in de wachtrij zou hem een tweede keer kunnen
  -- versturen; dat is erger dan een keer niet versturen. Dus naar een mens.
  -- De enige weg terug naar de wachtrij is een expliciete mededeling dat er
  -- niets is verstuurd: `hours_outbox_record_failure` of `hours_outbox_release`.
  update public.hours_outbox_messages o set status = 'mislukt',
    block_reason = 'verzending_onzeker',
    last_error = coalesce(o.last_error,
      'De verzendpoging is nooit afgerond. Controleer de postbus voordat je dit bericht opnieuw laat plannen.'),
    claim_token = null, claimed_at = null, lease_expires_at = null
    where o.status in ('gereed', 'goedgekeurd') and o.claim_token is not null and o.lease_expires_at < v_now
      and (p_organization_id is null or o.organization_id = p_organization_id)
      and exists (select 1 from public.organization_modules m
                  where m.organization_id = o.organization_id
                    and m.module_name = 'uren-workflow' and m.enabled is true);
  update public.hours_outbox_messages o set status = 'mislukt', block_reason = 'te_vaak_geprobeerd',
    claim_token = null, claimed_at = null, lease_expires_at = null
    where o.status in ('gereed', 'goedgekeurd') and o.attempt_count >= 5 and o.claim_token is null
      and (p_organization_id is null or o.organization_id = p_organization_id)
      and exists (select 1 from public.organization_modules m
                  where m.organization_id = o.organization_id
                    and m.module_name = 'uren-workflow' and m.enabled is true);
  with picked as (
    select o.id from public.hours_outbox_messages o
      join public.hours_weeks w on w.id = o.week_id and w.organization_id = o.organization_id
      join public.hours_company_settings s on s.company_id = o.company_id
        and s.organization_id = o.organization_id and s.enabled
      join public.organization_modules m on m.organization_id = o.organization_id
        and m.module_name = 'uren-workflow' and m.enabled is true
      join public.hours_mail_profiles f on f.company_id = o.company_id
        and f.organization_id = o.organization_id
      where o.status in ('gereed', 'goedgekeurd')
        and o.claim_token is null
        and o.effective_at <= v_now
        and (o.next_attempt_at is null or o.next_attempt_at <= v_now)
        and jsonb_array_length(o.recipients) > 0
        and length(o.subject) > 0 and length(o.body_html) > 0
        and (p_organization_id is null or o.organization_id = p_organization_id)
        -- De regel moet nog bestaan, nog aanstaan, én deze ontvanger nog noemen.
        -- Een regel die inmiddels iemand anders aanwijst mag niet alsnog naar de
        -- vertrokken contactpersoon sturen.
        and exists (select 1 from jsonb_array_elements(f.rules) as r
                    where r.value->>'id' = o.rule_id
                      and (r.value->>'enabled')::boolean is true
                      and (r.value->'recipientIds' @> to_jsonb(o.recipient_id)
                           or r.value->'recipientIds' @> '["*"]'::jsonb))
      order by o.effective_at, o.id limit p_limit for update of o skip locked),
  claimed as (
    update public.hours_outbox_messages o set claim_token = v_token, claimed_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      attempt_count = o.attempt_count + 1
      from picked where o.id = picked.id
      returning o.id, o.dedup_key, o.organization_id, o.company_id, o.week_id, o.subject, o.body_html,
        o.recipients, o.company_contact_id, o.candidate_id, o.request_id, o.mail_type, o.party)
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_rows from claimed;
  return jsonb_build_object('ok', true, 'claim_token', v_token, 'messages', v_rows);
end $$;

do $$ begin
  execute 'revoke all on function public.hours_withdraw_outbox_message(uuid, text, boolean) from public, anon, authenticated, service_role';
  execute 'grant execute on function public.hours_withdraw_outbox_message(uuid, text, boolean) to authenticated';
  execute 'revoke all on function public.hours_outbox_sync(uuid, jsonb, jsonb, boolean) from public, anon, authenticated, service_role';
  execute 'grant execute on function public.hours_outbox_sync(uuid, jsonb, jsonb, boolean) to service_role';
end $$;
drop function if exists public.hours_outbox_sync(uuid, jsonb, jsonb);

comment on function public.hours_outbox_claim(integer, integer, uuid) is 'Hands out what may go to the mailbox. A lease that runs out without an explicit outcome parks the message as uncertain for a person rather than queueing it again: sending twice is worse than not sending. The originating rule must still exist, still be on, and still name this recipient.';
comment on function public.hours_withdraw_outbox_message(uuid, text, boolean) is 'Takes a message off the list. Without p_allow_replan this is a decision that stands; with it the planner may propose the message again, which is what a failed message needs.';

commit;
notify pgrst, 'reload schema';
