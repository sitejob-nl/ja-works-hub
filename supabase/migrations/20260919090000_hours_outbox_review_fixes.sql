-- T8, reviewronde: vier defecten die een adversariële review op de uitgerolde
-- versie vond. Alle vier gaan over hetzelfde thema — een beslissing die op de
-- ene plek wordt genomen en op een andere plek niet wordt gerespecteerd.
--
--  1. De planner en de goedkeuringsroute spraken twee talen. De planner schrijft
--     `correction_approval_required`; `hours_approve_outbox_message` eiste
--     `goedkeuring_vereist`. Daardoor kon **geen enkel** correctie- of
--     navraagbericht ooit worden goedgekeurd: de knop stond er, en gaf altijd
--     een fout. Nu is er één woord voor die toestand.
--  2. Intrekken hield geen stand. `hours_outbox_sync` sloeg alleen `verzonden`
--     en `mislukt` over, dus de eerstvolgende planning zette een ingetrokken
--     bericht terug op `gereed` en vijf minuten later ging het alsnog de deur
--     uit. Een besluit van een mens wint nu van een herplanning.
--  3. De claim controleerde het mailprofiel niet. Een berichtsoort uitzetten
--     haalde de week uit de planning, maar liet een al klaargezette rij gewoon
--     verzendbaar. Nu leest de claim de regel zelf.
--  4. Het overzicht sorteerde op tijdstip aflopend, dus honderd toekomstige
--     concepten verdrongen precies de berichten die op een mens wachtten.
begin;

-- --------------------------------------------------------------------------
-- 1 + 2: sync respecteert het woord van de planner en het besluit van een mens
-- --------------------------------------------------------------------------
create or replace function public.hours_outbox_sync(p_week_id uuid, p_actions jsonb,
  p_issues jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_week public.hours_weeks%rowtype; v_action jsonb; v_source text; v_status text; v_block text;
  v_existing public.hours_outbox_messages%rowtype; v_keys text[] := '{}'; v_now timestamptz := clock_timestamp();
  v_stale boolean; v_approved boolean;
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
      -- The planner's own word for "a person has to approve this" is exactly the
      -- state `hours_approve_outbox_message` unblocks. Keep one vocabulary: two
      -- words for one state is how the approve button ends up doing nothing.
      if v_block = 'correction_approval_required' then v_block := 'goedkeuring_vereist'; end if;
    end if;
    select * into v_existing from public.hours_outbox_messages
      where organization_id = v_week.organization_id and dedup_key = (v_action->>'dedup_key') for update;
    if found then
      -- Terminal, withdrawn by a person, or in flight: leave it exactly as it is.
      -- `vervallen` is deliberately split: `ingetrokken` is somebody's decision
      -- and stands, while `niet_meer_gepland` is bookkeeping the planner may undo.
      if v_existing.status in ('verzonden', 'mislukt')
         or (v_existing.status = 'vervallen' and v_existing.block_reason = 'ingetrokken')
         or (v_existing.claim_token is not null and v_existing.lease_expires_at > v_now) then
        continue;
      end if;
      v_stale := v_existing.approved_at is not null
        and (v_existing.approved_content_hash is distinct from (v_action->>'content_hash')
             or v_existing.approved_source_revision is distinct from v_source);
      v_approved := v_existing.approved_at is not null and not v_stale;
      if v_status = 'goedgekeurd' and not v_approved then
        v_status := 'concept';
        v_block := case when v_stale then 'goedkeuring_vervallen' else 'goedkeuring_vereist' end;
      elsif v_approved and v_status = 'concept' and v_block is null then
        v_status := 'goedgekeurd';
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
  -- A message the planner no longer proposes stops being pending work. A sent
  -- one keeps standing, and so does one a person withdrew.
  update public.hours_outbox_messages set status = 'vervallen', block_reason = 'niet_meer_gepland'
    where week_id = v_week.id and organization_id = v_week.organization_id
      and status in ('concept', 'gereed', 'goedgekeurd')
      and not (dedup_key = any(v_keys))
      and claim_token is null;
  get diagnostics v_expired = row_count;
  update public.hours_mail_profiles set
    last_issues = case when jsonb_typeof(p_issues) = 'array'
      and jsonb_array_length(p_issues) <= 50 then p_issues else '[]'::jsonb end,
    last_planned_at = v_now
    where company_id = v_week.company_id and organization_id = v_week.organization_id;
  return jsonb_build_object('ok', true, 'planned', v_planned, 'expired', v_expired,
    'issues', coalesce(p_issues, '[]'::jsonb));
end $$;

-- --------------------------------------------------------------------------
-- 3: de claim leest het profiel zelf
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
  update public.hours_outbox_messages o set claim_token = null, claimed_at = null, lease_expires_at = null
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
      -- The rule this message came from has to still exist and still be on. The
      -- planning run is what normally demotes a message, but a week can drop out
      -- of the planning listing entirely - and then nothing would ever demote it.
      join public.hours_mail_profiles f on f.company_id = o.company_id
        and f.organization_id = o.organization_id
      where o.status in ('gereed', 'goedgekeurd')
        and o.claim_token is null
        and o.effective_at <= v_now
        and (o.next_attempt_at is null or o.next_attempt_at <= v_now)
        and jsonb_array_length(o.recipients) > 0
        and length(o.subject) > 0 and length(o.body_html) > 0
        and (p_organization_id is null or o.organization_id = p_organization_id)
        and exists (select 1 from jsonb_array_elements(f.rules) as r
                    where r.value->>'id' = o.rule_id and (r.value->>'enabled')::boolean is true)
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

-- --------------------------------------------------------------------------
-- 4: het overzicht toont eerst wat een mens vraagt
-- --------------------------------------------------------------------------
create or replace function public.hours_outbox_overview(p_week_id uuid default null,
  p_company_id uuid default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_rows jsonb; begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Ongeldig aantal' using errcode = '22023';
  end if;
  -- Ordered by what somebody has to do something about, not by clock. Every rule
  -- times every recipient times every week produces a row the moment it is
  -- planned, and those future placeholders have the furthest-away moment - so
  -- sorting on time alone pushed exactly the drafts and failures off the page.
  select coalesce(jsonb_agg(row order by rang, row->>'effective_at' desc, row->>'id'), '[]'::jsonb)
    into v_rows from (
    select case o.status
             when 'concept' then case when o.approval_required then 0 else 2 end
             when 'mislukt' then 1
             when 'goedgekeurd' then 3
             when 'gereed' then 4
             when 'verzonden' then 5
             else 6 end as rang,
      jsonb_build_object('id', o.id, 'week_id', o.week_id, 'company_id', o.company_id,
      'company_name', w.company_name, 'week_start', w.week_start,
      'rule_id', o.rule_id, 'mail_type', o.mail_type, 'party', o.party,
      'scheduled_at', o.scheduled_at, 'effective_at', o.effective_at,
      'status', o.status, 'block_reason', o.block_reason, 'approval_required', o.approval_required,
      'subject', o.subject, 'body_html', o.body_html, 'recipients', o.recipients,
      'content_hash', o.content_hash, 'source_revision', o.source_revision,
      'approved_at', o.approved_at, 'approved_by', o.approved_by,
      'attempt_count', o.attempt_count, 'next_attempt_at', o.next_attempt_at, 'last_error', o.last_error,
      'sent_at', o.sent_at, 'outbound_message_id', o.outbound_message_id) as row
    from public.hours_outbox_messages o
    join public.hours_weeks w on w.id = o.week_id and w.organization_id = o.organization_id
    where o.organization_id = v_org
      and (p_week_id is null or o.week_id = p_week_id)
      and (p_company_id is null or o.company_id = p_company_id)
    order by case o.status
               when 'concept' then case when o.approval_required then 0 else 2 end
               when 'mislukt' then 1
               when 'goedgekeurd' then 3
               when 'gereed' then 4
               when 'verzonden' then 5
               else 6 end, o.effective_at desc, o.id
    limit p_limit) as rows;
  return jsonb_build_object('messages', v_rows,
    'can_manage', public.has_role_permission('finance.manage'));
end $$;

comment on function public.hours_outbox_sync(uuid, jsonb, jsonb) is 'Makes one planning run durable. The planner word `correction_approval_required` is normalised to `goedkeuring_vereist` so the approval route unblocks exactly the state the planner asked for, and a message a person withdrew is never resurrected by a later run.';
comment on function public.hours_outbox_claim(integer, integer, uuid) is 'Hands out what may actually go to the mailbox. Re-reads the mail profile so a switched-off message type stops sending even when its week has dropped out of the planning listing.';

commit;
notify pgrst, 'reload schema';
