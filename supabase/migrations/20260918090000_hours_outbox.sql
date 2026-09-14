-- T8: mail profiles, deadlines and an outbox with draft approval.
--
-- `_shared/hours-schedule.ts` has decided what goes out and when since the first
-- release, and says so itself: "pure planning only. A sender must recheck the
-- current revision, recipient and outbound pause." It was never connected to
-- anything. This migration is the other half: somewhere to keep the profile, a
-- durable outbox, an explicit approval, and the service-role route the sender
-- uses. The timing semantics stay in that one TypeScript module; nothing here
-- computes a moment. The two deadlines keep coming from the week's own frozen
-- `settings_snapshot`, so a later settings change cannot move an old week.
--
-- Four things this route may not do, and where each is enforced:
--
--  * **A send time never bypasses an approval.** An `approval_required` row can
--    never reach `gereed` (a table CHECK), and only `hours_approve_outbox_message`
--    - an internal user with finance.manage - can set `goedgekeurd`.
--  * **A repeated run sends nothing twice.** `unique (organization_id, dedup_key)`
--    on the planner's own key, plus a trigger that makes a sent row immutable.
--  * **A provider 5xx does not retry without a bound.** A claim counts an attempt;
--    the fifth failure ends in `mislukt`, and every retry waits.
--  * **A blocked message is logged, not dropped.** The pause path is `paused`:
--    the claim is released, the attempt is given back, the approval stands, and
--    the concept itself is logged in `communications` by the shared sender.
--
-- No write to the legacy `timesheets` route, to `hours_day_releases` (T12, still
-- empty and still without a write route), to an hours day or to a matrix basis.
-- No paid provider call.
begin;

-- ---------------------------------------------------------------------------
-- The profile: which messages go out for one client, to whom, and when
-- ---------------------------------------------------------------------------

-- Configuration, so it is mutable by design - unlike the ledgers of T7 and T10.
-- One row per client; `rules` is the planner's own rule shape, stored verbatim
-- so there is no second dialect to keep in step. What SQL checks here is the
-- structure and the vocabulary; the timing meaning stays in hours-schedule.ts.
create table if not exists public.hours_mail_profiles (
  company_id uuid primary key references public.companies(id),
  organization_id uuid not null references public.organizations(id),
  version integer not null default 1 check (version > 0),
  late_approval_mode text not null default 'require_review'
    check (late_approval_mode in ('require_review', 'send_if_window')),
  late_approval_window_minutes integer not null default 60
    check (late_approval_window_minutes between 1 and 20160),
  rules jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 50),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp()
);

-- The text of one message, per language. `template_id` is the identifier the
-- planner's rule already carried; this is where the words finally live.
create table if not exists public.hours_mail_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  template_id text not null check (template_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  language text not null check (language in ('nl', 'en', 'pl')),
  subject text not null check (length(btrim(subject)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 10000),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, template_id, language)
);

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

-- One row per planned message, keyed by the planner's `dedupKey`. A row moves
-- through states; it is not append-only, because a queue that cannot change is
-- not a queue. What *is* immutable is a sent row: see the trigger below.
create table if not exists public.hours_outbox_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  company_id uuid not null references public.companies(id),
  dedup_key text not null check (length(dedup_key) between 8 and 400),
  rule_id text not null check (length(rule_id) between 1 and 120),
  -- Deliberately without the two deadline task types: an escalation is a task
  -- for the responsible person and belongs to T11, not to a mailbox.
  mail_type text not null check (mail_type in ('hours_request', 'approval_request',
    'submission_reminder', 'approval_reminder', 'correction_query')),
  party text not null check (party in ('customer', 'employee', 'internal')),
  recipient_id text not null check (length(recipient_id) between 1 and 120),
  scheduled_at timestamptz not null,
  effective_at timestamptz not null,
  status text not null check (status in ('concept', 'gereed', 'goedgekeurd', 'verzonden', 'mislukt', 'vervallen')),
  -- Why it is not sendable, in the planner's own vocabulary, or which part of
  -- the profile is missing.
  block_reason text check (block_reason is null or length(block_reason) <= 120),
  approval_required boolean not null default false,
  subject text not null default '' check (length(subject) <= 400),
  body_html text not null default '' check (length(body_html) <= 200000),
  recipients jsonb not null default '[]'::jsonb
    check (jsonb_typeof(recipients) = 'array' and jsonb_array_length(recipients) <= 50),
  company_contact_id uuid references public.company_contacts(id),
  candidate_id uuid references public.candidates(id),
  content_hash text not null check (length(content_hash) between 1 and 64),
  source_revision text not null check (length(source_revision) between 1 and 64),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  approved_content_hash text,
  approved_source_revision text,
  request_id uuid references public.hours_week_requests(id),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  outbound_message_id text check (outbound_message_id is null or length(outbound_message_id) between 3 and 512),
  conversation_id text check (conversation_id is null or length(conversation_id) between 1 and 512),
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  -- The planner's key is the whole anti-duplication story.
  unique (organization_id, dedup_key),
  foreign key (week_id, organization_id) references public.hours_weeks(id, organization_id),
  -- A scheduled moment may not stand in for a person's approval.
  check (not approval_required or status <> 'gereed'),
  -- Sent is a terminal fact and has to carry its evidence.
  check ((sent_at is null) = (status <> 'verzonden')),
  check (status <> 'verzonden' or (outbound_message_id is not null or conversation_id is not null)),
  check (status <> 'verzonden' or jsonb_array_length(recipients) > 0),
  -- An approval is a whole fact or no fact at all.
  check ((approved_at is null) = (approved_by is null)),
  check (approved_at is null or (approved_content_hash is not null and approved_source_revision is not null)),
  check (status <> 'goedgekeurd' or approved_at is not null),
  -- A claim is a whole fact too, so a half-released row cannot exist.
  check (num_nulls(claim_token, claimed_at, lease_expires_at) in (0, 3))
);

create index if not exists hours_mail_profiles_org_idx on public.hours_mail_profiles(organization_id);
create index if not exists hours_mail_profiles_actor_idx on public.hours_mail_profiles(updated_by);
create index if not exists hours_mail_templates_org_idx on public.hours_mail_templates(organization_id);
create index if not exists hours_mail_templates_actor_idx on public.hours_mail_templates(updated_by);
create index if not exists hours_outbox_org_idx on public.hours_outbox_messages(organization_id);
create index if not exists hours_outbox_week_idx on public.hours_outbox_messages(week_id, organization_id);
create index if not exists hours_outbox_company_idx on public.hours_outbox_messages(company_id, organization_id);
-- The claim's own read: what is sendable, oldest first.
create index if not exists hours_outbox_sendable_idx on public.hours_outbox_messages(effective_at, id)
  where status in ('gereed', 'goedgekeurd');
create index if not exists hours_outbox_request_idx on public.hours_outbox_messages(request_id);
create index if not exists hours_outbox_contact_idx on public.hours_outbox_messages(company_contact_id);
create index if not exists hours_outbox_candidate_idx on public.hours_outbox_messages(candidate_id);
create index if not exists hours_outbox_approver_idx on public.hours_outbox_messages(approved_by);

-- A sent message is a fact about the world: it left the building. Nothing in
-- this module may rewrite or remove it, the database owner included.
create or replace function private.hours_outbox_sent_immutable()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    if old.status = 'verzonden' then
      raise exception 'Een verzonden bericht kan niet worden verwijderd' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'verzonden' then
    raise exception 'Een verzonden bericht kan niet worden gewijzigd' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function private.hours_outbox_sent_immutable() from public, anon, authenticated, service_role;

drop trigger if exists hours_outbox_sent_immutable on public.hours_outbox_messages;
create trigger hours_outbox_sent_immutable before update or delete on public.hours_outbox_messages
  for each row execute function private.hours_outbox_sent_immutable();

-- Same gate as the rest of the module: internal reader of the own organisation
-- with a finance right, behind the restrictive SaaS module policy. No table here
-- has an INSERT, UPDATE or DELETE policy; every write goes through a definer RPC.
do $$ declare t text; begin
  foreach t in array array['hours_mail_profiles', 'hours_mail_templates', 'hours_outbox_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
    execute format('drop policy if exists hours_workflow_module_required on public.%I', t);
    execute format('create policy hours_workflow_module_required on public.%I as restrictive for select to authenticated using ((select private.hours_module_enabled()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reading a week the way the planner wants it
-- ---------------------------------------------------------------------------

-- The fingerprint of everything a message could be about: the current day
-- versions of the week. When this moves, a draft that was approved against the
-- old value is no longer the message a person read.
create or replace function private.hours_week_source_revision(p_week_id uuid, p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(md5(string_agg(coalesce(d.current_revision_id::text, '-'), ',' order by d.id)), 'leeg')
    from public.hours_days d
    where d.week_id = p_week_id and d.organization_id = p_org
$$;
revoke all on function private.hours_week_source_revision(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The same fingerprint for one employee's own days, so an employee message is
-- invalidated by a change to *their* hours and not by somebody else's.
create or replace function private.hours_member_source_revision(p_week_id uuid, p_org uuid, p_candidate uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(md5(string_agg(coalesce(d.current_revision_id::text, '-'), ',' order by d.id)), 'leeg')
    from public.hours_days d
    join public.hours_week_members m on m.id = d.member_id and m.organization_id = d.organization_id
    where d.week_id = p_week_id and d.organization_id = p_org and m.candidate_id = p_candidate
$$;
revoke all on function private.hours_member_source_revision(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- The two deadlines as the planner states them, rebuilt from the week's own
-- frozen snapshot. One truth: `hours_weeks.submission_deadline_at` was computed
-- from exactly these numbers when the week was prepared.
create or replace function private.hours_deadline_moment(p_offset integer, p_time text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('kind', 'week_time',
    'weekOffset', p_offset / 7, 'weekday', (p_offset % 7) + 1,
    'time', substr(p_time, 1, 5))
$$;
revoke all on function private.hours_deadline_moment(integer, text)
  from public, anon, authenticated, service_role;

-- Which addresses the configured recipient ids actually resolve to, inside this
-- organisation. An id that belongs to somebody else simply does not come back;
-- the message then lands visibly as a draft with `onbekende_ontvanger`, never
-- at a guessed address.
create or replace function private.hours_outbox_recipients(p_org uuid, p_company uuid, p_ids text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(resolved.id, resolved.row), '{}'::jsonb) from (
    -- Name from first/last only: those two exist both here and in the released
    -- QA fixture, so the resolver is exercised by the inherited database proof.
    select k.id::text as id, jsonb_build_object('email', k.email,
      'name', coalesce(nullif(btrim(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '')), ''), k.email),
      'kind', 'company_contact', 'company_contact_id', k.id) as row
      from public.company_contacts k
      where k.organization_id = p_org and k.company_id = p_company
        and k.id::text = any(p_ids) and nullif(btrim(k.email), '') is not null
    union all
    select c.id::text, jsonb_build_object('email', c.email,
      'name', coalesce(nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.email),
      'kind', 'candidate', 'candidate_id', c.id)
      from public.candidates c
      where c.organization_id = p_org and c.id::text = any(p_ids)
        and nullif(btrim(c.email), '') is not null
    union all
    select p.id::text, jsonb_build_object('email', p.email, 'name', coalesce(p.full_name, p.email),
      'kind', 'profile')
      from public.profiles p
      where p.organization_id = p_org and p.id::text = any(p_ids) and p.is_active is true
        and nullif(btrim(p.email), '') is not null) as resolved
$$;
revoke all on function private.hours_outbox_recipients(uuid, uuid, text[])
  from public, anon, authenticated, service_role;

-- The planner wants fixed recipient ids, but the employees on a week are not
-- fixed: they change with the placements. One explicit wildcard bridges that
-- without teaching the planner about weeks. `*` means "every employee on this
-- week" and is expanded here, per week, before the plan is made - so every
-- dedup key still names one real person and nothing is sent to a group.
-- It is deliberately only allowed for the employee party: a client contact and
-- an internal owner are people somebody chose, not a set.
create or replace function private.hours_outbox_expand_rules(p_week public.hours_weeks, p_rules jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rule jsonb; v_out jsonb := '[]'::jsonb; v_ids jsonb; begin
  select coalesce(jsonb_agg(distinct to_jsonb(m.candidate_id::text)), '[]'::jsonb) into v_ids
    from public.hours_week_members m
    where m.week_id = p_week.id and m.organization_id = p_week.organization_id;
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if v_rule->>'party' = 'employee'
       and coalesce(v_rule->'recipientIds', '[]'::jsonb) @> '["*"]'::jsonb then
      -- An empty week simply has nobody to write to; the rule then plans nothing
      -- instead of planning an action without an addressee.
      if jsonb_array_length(v_ids) = 0 then continue; end if;
      v_rule := jsonb_set(v_rule, '{recipientIds}', v_ids);
    end if;
    v_out := v_out || jsonb_build_array(v_rule);
  end loop;
  return v_out;
end $$;
revoke all on function private.hours_outbox_expand_rules(public.hours_weeks, jsonb)
  from public, anon, authenticated, service_role;

-- What the planner calls `recipientStates`: per configured recipient, whether
-- the week is complete for them and - for an employee - which revision of their
-- own hours stands and whether they have agreed to exactly that one.
create or replace function private.hours_outbox_recipient_states(p_week public.hours_weeks, p_rules jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_complete boolean; v_states jsonb := '[]'::jsonb; v_rule jsonb; v_id text; v_candidate uuid;
  v_revision text; v_available timestamptz; v_approved text; v_seen text[] := '{}';
begin
  -- Complete means: every expected work day of the week carries a version.
  select bool_and(d.current_revision_id is not null) into v_complete
    from public.hours_days d
    where d.week_id = p_week.id and d.organization_id = p_week.organization_id;
  v_complete := coalesce(v_complete, false);
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    for v_id in select value from jsonb_array_elements_text(coalesce(v_rule->'recipientIds', '[]'::jsonb)) loop
      -- The planner refuses a state list with two entries for one recipient.
      if (v_rule->>'party' || ':' || v_id) = any(v_seen) then continue; end if;
      v_seen := v_seen || (v_rule->>'party' || ':' || v_id);
      if v_rule->>'party' in ('customer', 'internal') then
        v_states := v_states || jsonb_build_array(jsonb_build_object(
          'party', v_rule->>'party', 'recipientId', v_id,
          'submissionComplete', v_complete, 'approvalComplete', v_complete));
      elsif v_rule->>'party' = 'employee' then
        begin
          v_candidate := v_id::uuid;
        exception when others then
          continue;
        end;
        select max(r.created_at) into v_available
          from public.hours_days d
          join public.hours_week_members m on m.id = d.member_id and m.organization_id = d.organization_id
          join public.hours_day_revisions r on r.id = d.current_revision_id and r.organization_id = d.organization_id
          where d.week_id = p_week.id and d.organization_id = p_week.organization_id
            and m.candidate_id = v_candidate;
        if v_available is null then continue; end if;
        v_revision := private.hours_member_source_revision(p_week.id, p_week.organization_id, v_candidate);
        -- Agreed only when every one of their days carries a confirmation on the
        -- version that stands right now; one stale agreement is no agreement.
        select case when bool_and(f.id is not null and f.decision = 'confirmed') then v_revision else null end
          into v_approved
          from public.hours_days d
          join public.hours_week_members m on m.id = d.member_id and m.organization_id = d.organization_id
          left join public.hours_day_confirmations f on f.day_id = d.id
            and f.revision_id = d.current_revision_id and f.organization_id = d.organization_id
          where d.week_id = p_week.id and d.organization_id = p_week.organization_id
            and m.candidate_id = v_candidate;
        v_states := v_states || jsonb_build_array(jsonb_build_object(
          'party', 'employee', 'recipientId', v_id,
          'hours', jsonb_build_object('availableAt', to_char(v_available at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'revision', v_revision, 'approvedRevision', v_approved)));
      end if;
    end loop;
  end loop;
  return v_states;
end $$;
revoke all on function private.hours_outbox_recipient_states(public.hours_weeks, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The service-role route the sender uses
-- ---------------------------------------------------------------------------

-- Everything one run needs about one week, in one answer. The tenant checks all
-- live here, so the sender never has to be trusted with a scope.
create or replace function public.hours_outbox_due_weeks(p_limit integer default 25,
  p_organization_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb := '[]'::jsonb; v_week public.hours_weeks%rowtype; v_profile public.hours_mail_profiles%rowtype;
  v_ids text[]; v_source text; v_request jsonb; v_templates jsonb; v_existing jsonb; v_approvals jsonb;
  v_missing jsonb; v_now timestamptz := clock_timestamp(); v_snapshot jsonb; v_rules jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de urenmailfunctie mag dit doen' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ongeldig aantal' using errcode = '22023';
  end if;
  for v_week in
    select w.* from public.hours_weeks w
      join public.organization_modules m on m.organization_id = w.organization_id
        and m.module_name = 'uren-workflow' and m.enabled is true
      join public.hours_company_settings s on s.company_id = w.company_id
        and s.organization_id = w.organization_id and s.enabled
      join public.hours_mail_profiles f on f.company_id = w.company_id
        and f.organization_id = w.organization_id
      where (p_organization_id is null or w.organization_id = p_organization_id)
        -- A week stops being interesting a fortnight after its last deadline.
        and w.confirmation_deadline_at > v_now - interval '14 days'
        and exists (select 1 from jsonb_array_elements(f.rules) as r
                    where (r.value->>'enabled')::boolean is true)
      order by w.submission_deadline_at, w.id
      limit p_limit
  loop
    select * into v_profile from public.hours_mail_profiles
      where company_id = v_week.company_id and organization_id = v_week.organization_id;
    v_snapshot := v_week.settings_snapshot;
    -- Expand the employee wildcard first; everything below reads real people.
    v_rules := private.hours_outbox_expand_rules(v_week, v_profile.rules);
    select coalesce(array_agg(distinct rid.value), '{}'::text[]) into v_ids
      from jsonb_array_elements(v_rules) as r
      cross join lateral jsonb_array_elements_text(coalesce(r.value->'recipientIds', '[]'::jsonb)) as rid;
    v_source := private.hours_week_source_revision(v_week.id, v_week.organization_id);
    select to_jsonb(q) into v_request from (
      select rq.id, rq.code, rq.revoked_at from public.hours_week_requests rq
        where rq.week_id = v_week.id and rq.organization_id = v_week.organization_id
          and rq.revoked_at is null and rq.expires_at > v_now
        order by rq.created_at desc limit 1) as q;
    select coalesce(jsonb_object_agg(t.template_id || ':' || t.language,
        jsonb_build_object('subject', t.subject, 'body', t.body)), '{}'::jsonb)
      into v_templates from public.hours_mail_templates t
      where t.organization_id = v_week.organization_id
        and exists (select 1 from jsonb_array_elements(v_rules) as r
                    where r.value->>'templateId' = t.template_id and r.value->>'language' = t.language);
    -- Only a finished or in-flight action is reported back as existing. A draft
    -- is deliberately left out, so a replan refreshes it and a changed source
    -- revision can still invalidate a standing approval.
    select coalesce(jsonb_agg(jsonb_build_object('dedupKey', o.dedup_key,
        'status', case when o.status = 'verzonden' then 'completed'
                       when o.status = 'mislukt' then 'uncertain'
                       else 'in_progress' end)), '[]'::jsonb)
      into v_existing from public.hours_outbox_messages o
      where o.week_id = v_week.id and o.organization_id = v_week.organization_id
        and (o.status in ('verzonden', 'mislukt')
             or (o.claim_token is not null and o.lease_expires_at > v_now));
    select coalesce(jsonb_agg(jsonb_build_object('ruleId', o.rule_id, 'recipientId', o.recipient_id,
        'contentHash', o.content_hash, 'sourceRevision', v_source,
        'approvedContentHash', o.approved_content_hash,
        'approvedSourceRevision', o.approved_source_revision)), '[]'::jsonb)
      into v_approvals from public.hours_outbox_messages o
      where o.week_id = v_week.id and o.organization_id = v_week.organization_id
        and o.mail_type = 'correction_query';
    select coalesce(jsonb_agg(distinct m.candidate_name), '[]'::jsonb) into v_missing
      from public.hours_days d
      join public.hours_week_members m on m.id = d.member_id and m.organization_id = d.organization_id
      where d.week_id = v_week.id and d.organization_id = v_week.organization_id
        and d.current_revision_id is null;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'week_id', v_week.id, 'organization_id', v_week.organization_id,
      'company_id', v_week.company_id, 'company_name', v_week.company_name,
      'week_start', v_week.week_start,
      'config', jsonb_build_object(
        'timezone', 'Europe/Amsterdam',
        'submissionDeadline', private.hours_deadline_moment(
          (v_snapshot->>'submission_day_offset')::integer, v_snapshot->>'submission_time'),
        'approvalDeadline', private.hours_deadline_moment(
          (v_snapshot->>'confirmation_day_offset')::integer, v_snapshot->>'confirmation_time'),
        'lateApproval', jsonb_build_object('mode', v_profile.late_approval_mode,
          'minimumWindowMinutes', v_profile.late_approval_window_minutes),
        'rules', v_rules),
      'recipient_states', private.hours_outbox_recipient_states(v_week, v_rules),
      'correction_approvals', v_approvals,
      'existing_actions', v_existing,
      'recipients', private.hours_outbox_recipients(v_week.organization_id, v_week.company_id, v_ids),
      'templates', v_templates,
      'request', v_request,
      'facts', jsonb_build_object('missing_members', v_missing,
        'submission_deadline_at', v_week.submission_deadline_at,
        'confirmation_deadline_at', v_week.confirmation_deadline_at)));
  end loop;
  return v_rows;
end $$;

-- What the planner produced, made durable. Idempotent by construction: the key
-- is the planner's own `dedupKey`, so a repeated run updates one row instead of
-- adding a second. A sent, failed or in-flight row is never touched.
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
    -- A configuration gap keeps the message visible as a draft that says what is
    -- missing; it is never sent to a guessed address or with an empty body.
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
    end if;
    select * into v_existing from public.hours_outbox_messages
      where organization_id = v_week.organization_id and dedup_key = (v_action->>'dedup_key') for update;
    if found then
      -- Terminal or in flight: leave it exactly as it is.
      if v_existing.status in ('verzonden', 'mislukt')
         or (v_existing.claim_token is not null and v_existing.lease_expires_at > v_now) then
        continue;
      end if;
      -- A standing approval survives only while both the words and the hours it
      -- was given for are unchanged. This is the whole of "a changed source
      -- revision invalidates the draft".
      v_stale := v_existing.approved_at is not null
        and (v_existing.approved_content_hash is distinct from (v_action->>'content_hash')
             or v_existing.approved_source_revision is distinct from v_source);
      v_approved := v_existing.approved_at is not null and not v_stale;
      -- An approval is a person's, so the plan can never hand one out. A message
      -- that needs one goes back to being a draft the moment its approval is
      -- gone, and a plan that says "due" does not change that.
      if v_status = 'goedgekeurd' and not v_approved then
        v_status := 'concept';
        v_block := case when v_stale then 'goedkeuring_vervallen' else 'goedkeuring_vereist' end;
      elsif v_approved and v_status = 'concept' and v_block is null then
        v_status := 'goedgekeurd';
      end if;
      -- A stale approval is dropped below either way, but it only *blocks* a
      -- message that actually needs one. A message that never did keeps its own
      -- schedule; being looked at once is not a condition for sending it.
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
          -- A brand new row was never approved by anyone, so a `due` correction
          -- still starts as a draft; only the approve RPC can lift that.
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
  -- one keeps standing; this only clears what never went out.
  update public.hours_outbox_messages set status = 'vervallen', block_reason = 'niet_meer_gepland'
    where week_id = v_week.id and organization_id = v_week.organization_id
      and status in ('concept', 'gereed', 'goedgekeurd')
      and not (dedup_key = any(v_keys))
      and claim_token is null;
  get diagnostics v_expired = row_count;
  return jsonb_build_object('ok', true, 'planned', v_planned, 'expired', v_expired,
    'issues', coalesce(p_issues, '[]'::jsonb));
end $$;

-- What may actually go to the mailbox right now. Only `gereed` (the schedule is
-- the authorisation) and `goedgekeurd` (a person is) ever come back, and only
-- while the client's hours workflow is still switched on.
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
  -- A lease that ran out returns the message to the queue with its attempt
  -- already counted, so a crash costs one attempt and not the whole message.
  --
  -- Both sweeps stay inside the scope the caller asked for, and inside the SaaS
  -- gate: a switched-off organisation may not have its rows moved along either.
  -- Housekeeping is still a write, and the module being off means this module
  -- does nothing at all for that tenant.
  update public.hours_outbox_messages o set claim_token = null, claimed_at = null, lease_expires_at = null
    where o.status in ('gereed', 'goedgekeurd') and o.claim_token is not null and o.lease_expires_at < v_now
      and (p_organization_id is null or o.organization_id = p_organization_id)
      and exists (select 1 from public.organization_modules m
                  where m.organization_id = o.organization_id
                    and m.module_name = 'uren-workflow' and m.enabled is true);
  -- Past the bound it stops being work and starts being something a person has
  -- to look at. This is what keeps a failing provider from looping.
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
      where o.status in ('gereed', 'goedgekeurd')
        and o.claim_token is null
        and o.effective_at <= v_now
        and (o.next_attempt_at is null or o.next_attempt_at <= v_now)
        and jsonb_array_length(o.recipients) > 0
        and length(o.subject) > 0 and length(o.body_html) > 0
        and (p_organization_id is null or o.organization_id = p_organization_id)
      order by o.effective_at, o.id limit p_limit for update of o skip locked),
  claimed as (
    update public.hours_outbox_messages o set claim_token = v_token, claimed_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      attempt_count = o.attempt_count + 1
      from picked where o.id = picked.id
      returning o.id, o.organization_id, o.company_id, o.week_id, o.subject, o.body_html,
        o.recipients, o.company_contact_id, o.candidate_id, o.request_id, o.mail_type, o.party)
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_rows from claimed;
  return jsonb_build_object('ok', true, 'claim_token', v_token, 'messages', v_rows);
end $$;

-- It left the building. The row becomes immutable from here, and the request
-- reference finally learns which thread its answers will arrive in.
create or replace function public.hours_outbox_record_sent(p_id uuid, p_claim_token uuid,
  p_outbound_message_id text, p_conversation_id text, p_recipients jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.hours_outbox_messages%rowtype; v_recipients jsonb; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de urenmailfunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_row from public.hours_outbox_messages where id = p_id for update;
  if not found or v_row.claim_token is distinct from p_claim_token then
    raise exception 'Deze claim is niet meer geldig' using errcode = 'PT409';
  end if;
  perform private.hours_require_service_module(v_row.organization_id);
  if nullif(btrim(coalesce(p_outbound_message_id, '')), '') is null
     and nullif(btrim(coalesce(p_conversation_id, '')), '') is null then
    raise exception 'Een verzonden bericht moet een bericht- of gespreks-id dragen' using errcode = '22023';
  end if;
  v_recipients := case when jsonb_typeof(p_recipients) = 'array' then p_recipients else v_row.recipients end;
  update public.hours_outbox_messages set status = 'verzonden', sent_at = clock_timestamp(),
    outbound_message_id = nullif(btrim(coalesce(p_outbound_message_id, '')), ''),
    conversation_id = nullif(btrim(coalesce(p_conversation_id, '')), ''),
    recipients = v_recipients, block_reason = null, last_error = null, next_attempt_at = null,
    claim_token = null, claimed_at = null, lease_expires_at = null
    where id = p_id;
  -- The request reference carries the thread the intake side recognises, and T7
  -- froze those fields the moment `sent_at` is set: `hours_request_guard` refuses
  -- to move the message id, the conversation, the recipients or the timestamp
  -- afterwards. So this writes them exactly once, on the first customer message.
  -- A reminder deliberately leaves them alone: a client replies to the message in
  -- front of them, and moving the anchor would break that very thread.
  if v_row.party = 'customer' and v_row.request_id is not null then
    update public.hours_week_requests r set
      outbound_message_id = nullif(btrim(coalesce(p_outbound_message_id, '')), ''),
      conversation_id = nullif(btrim(coalesce(p_conversation_id, '')), ''),
      recipients = (select coalesce(jsonb_agg(address), '[]'::jsonb) from (
        select distinct address from jsonb_array_elements_text(v_recipients) as address
        where nullif(btrim(address), '') is not null
        order by address limit 50) as capped),
      sent_at = clock_timestamp()
      where r.id = v_row.request_id and r.organization_id = v_row.organization_id
        and r.sent_at is null;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- The three ways a send does not happen, each with its own consequence.
create or replace function public.hours_outbox_record_failure(p_id uuid, p_claim_token uuid,
  p_kind text, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.hours_outbox_messages%rowtype; v_wait interval; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de urenmailfunctie mag dit doen' using errcode = '42501';
  end if;
  if p_kind not in ('paused', 'transient', 'permanent') then
    raise exception 'Onbekende uitkomst' using errcode = '22023';
  end if;
  select * into v_row from public.hours_outbox_messages where id = p_id for update;
  if not found or v_row.claim_token is distinct from p_claim_token then
    raise exception 'Deze claim is niet meer geldig' using errcode = 'PT409';
  end if;
  perform private.hours_require_service_module(v_row.organization_id);
  if p_kind = 'paused' then
    -- The kill-switch logged the concept in `communications`. The approval and
    -- the place in the queue stand, and the attempt is handed back: an operator
    -- pause is not a failed delivery and may not consume the retry budget.
    update public.hours_outbox_messages set claim_token = null, claimed_at = null, lease_expires_at = null,
      attempt_count = greatest(v_row.attempt_count - 1, 0),
      next_attempt_at = clock_timestamp() + interval '15 minutes',
      last_error = left(coalesce(p_error, 'uitgaande e-mail staat op pauze'), 500),
      block_reason = 'uitgaande_pauze'
      where id = p_id;
  elsif p_kind = 'transient' then
    -- Exponential-ish backoff on the attempt already counted by the claim.
    v_wait := make_interval(mins => least(power(3, v_row.attempt_count)::integer, 240));
    update public.hours_outbox_messages set claim_token = null, claimed_at = null, lease_expires_at = null,
      next_attempt_at = clock_timestamp() + v_wait,
      last_error = left(coalesce(p_error, 'tijdelijke storing'), 500),
      status = case when v_row.attempt_count >= 5 then 'mislukt' else v_row.status end,
      block_reason = case when v_row.attempt_count >= 5 then 'te_vaak_geprobeerd' else 'tijdelijke_storing' end
      where id = p_id;
  else
    update public.hours_outbox_messages set status = 'mislukt', claim_token = null, claimed_at = null,
      lease_expires_at = null, next_attempt_at = null,
      last_error = left(coalesce(p_error, 'definitief geweigerd'), 500),
      block_reason = 'definitief_geweigerd'
      where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'kind', p_kind);
end $$;

-- A run that fell over hands the message back without judging it.
create or replace function public.hours_outbox_release(p_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.hours_outbox_messages%rowtype; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de urenmailfunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_row from public.hours_outbox_messages where id = p_id for update;
  if not found or v_row.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok', false);
  end if;
  perform private.hours_require_service_module(v_row.organization_id);
  update public.hours_outbox_messages set claim_token = null, claimed_at = null, lease_expires_at = null,
    next_attempt_at = clock_timestamp() + interval '5 minutes' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- What a person does: configure, read, approve, withdraw
-- ---------------------------------------------------------------------------

-- Structure and vocabulary only. What a moment *means* stays in hours-schedule.ts;
-- checking it twice in two languages is how the two drift apart.
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
    if jsonb_typeof(v_rule->'at') is distinct from 'object' then return 'Kies een verzendmoment'; end if;
    if (v_rule->'at'->>'kind') not in ('week_time', 'deadline_offset') then
      return 'Een verzendmoment is een weekmoment of een verschuiving ten opzichte van een deadline';
    end if;
  end loop;
  return null;
end $$;
revoke all on function private.hours_mail_rules_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function public.hours_get_mail_profile(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_row public.hours_mail_profiles%rowtype;
  v_templates jsonb; begin
  if not exists (select 1 from public.companies where id = p_company_id and organization_id = v_org) then
    raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501';
  end if;
  select * into v_row from public.hours_mail_profiles
    where company_id = p_company_id and organization_id = v_org;
  select coalesce(jsonb_agg(jsonb_build_object('template_id', t.template_id, 'language', t.language,
      'subject', t.subject, 'body', t.body) order by t.template_id, t.language), '[]'::jsonb)
    into v_templates from public.hours_mail_templates t where t.organization_id = v_org;
  return jsonb_build_object(
    'company_id', p_company_id,
    'version', coalesce(v_row.version, 0),
    'late_approval_mode', coalesce(v_row.late_approval_mode, 'require_review'),
    'late_approval_window_minutes', coalesce(v_row.late_approval_window_minutes, 60),
    'rules', coalesce(v_row.rules, '[]'::jsonb),
    'templates', v_templates,
    'can_manage', public.has_role_permission('finance.manage'));
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
      rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return public.hours_get_mail_profile(p_company_id);
end $$;

create or replace function public.hours_save_mail_template(p_template_id text, p_language text,
  p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); begin
  if p_template_id !~ '^[a-z0-9][a-z0-9-]{0,62}$' then
    raise exception 'Gebruik een korte naam met kleine letters, cijfers en streepjes' using errcode = '22023';
  end if;
  if p_language not in ('nl', 'en', 'pl') then raise exception 'Kies een taal' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_subject, ''))) not between 1 and 200 then
    raise exception 'Het onderwerp is leeg of te lang' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 10000 then
    raise exception 'De tekst is leeg of te lang' using errcode = '22023';
  end if;
  insert into public.hours_mail_templates(organization_id, template_id, language, subject, body,
    updated_by, updated_at)
    values (v_org, p_template_id, p_language, btrim(p_subject), p_body, auth.uid(), clock_timestamp())
    on conflict (organization_id, template_id, language) do update set subject = excluded.subject,
      body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'template_id', p_template_id, 'language', p_language);
end $$;

-- The outbox as a screen reads it. Never the body of somebody else's tenant:
-- the definer check and the table policy say the same thing.
create or replace function public.hours_outbox_overview(p_week_id uuid default null,
  p_company_id uuid default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_rows jsonb; begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Ongeldig aantal' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(row order by row->>'effective_at', row->>'id'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', o.id, 'week_id', o.week_id, 'company_id', o.company_id,
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
    order by o.effective_at desc, o.id limit p_limit) as rows;
  return jsonb_build_object('messages', v_rows,
    'can_manage', public.has_role_permission('finance.manage'));
end $$;

-- The only route to `goedgekeurd`. It approves exactly the words and exactly the
-- hours the approver had in front of them; anything else is a conflict, not an
-- approval of something they never read.
create or replace function public.hours_approve_outbox_message(p_id uuid,
  p_expected_content_hash text, p_expected_source_revision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_row public.hours_outbox_messages%rowtype;
  v_source text; begin
  select * into v_row from public.hours_outbox_messages
    where id = p_id and organization_id = v_org for update;
  if not found then raise exception 'Geen toegang tot dit bericht' using errcode = '42501'; end if;
  if v_row.status not in ('concept') then
    raise exception 'Alleen een concept kan worden goedgekeurd' using errcode = '22023';
  end if;
  -- Approval means exactly one thing: lifting the block that a message needing
  -- approval carries. It is not a way to bring a message forward that the
  -- planner is still holding back for its own reasons - that would be the send
  -- time bypassing the schedule instead of the approval.
  if not v_row.approval_required then
    raise exception 'Dit bericht wacht niet op goedkeuring maar op zijn eigen verzendmoment'
      using errcode = '22023';
  end if;
  if v_row.block_reason is distinct from 'goedkeuring_vereist'
     and v_row.block_reason is distinct from 'goedkeuring_vervallen' then
    raise exception 'Dit bericht is nog niet aan de beurt; er is meer dan een goedkeuring nodig'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_row.recipients) = 0 or length(btrim(v_row.subject)) = 0
     or length(btrim(v_row.body_html)) = 0 then
    raise exception 'Dit bericht is nog niet volledig' using errcode = '22023';
  end if;
  v_source := private.hours_week_source_revision(v_row.week_id, v_org);
  if p_expected_content_hash is distinct from v_row.content_hash
     or p_expected_source_revision is distinct from v_row.source_revision
     or v_row.source_revision is distinct from v_source then
    raise exception 'Het concept of de onderliggende uren zijn gewijzigd; lees opnieuw' using errcode = 'PT409';
  end if;
  update public.hours_outbox_messages set status = 'goedgekeurd', block_reason = null,
    approved_by = auth.uid(), approved_at = clock_timestamp(),
    approved_content_hash = v_row.content_hash, approved_source_revision = v_source,
    next_attempt_at = null, last_error = null
    where id = p_id;
  return public.hours_outbox_overview(v_row.week_id, null, 200);
end $$;

create or replace function public.hours_withdraw_outbox_message(p_id uuid, p_note text default null)
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
    block_reason = 'ingetrokken', approved_by = null, approved_at = null,
    approved_content_hash = null, approved_source_revision = null,
    last_error = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
    where id = p_id;
  return public.hours_outbox_overview(v_row.week_id, null, 200);
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

do $$ declare f text; begin
  foreach f in array array[
    'public.hours_get_mail_profile(uuid)',
    'public.hours_save_mail_profile(uuid, integer, jsonb, text, integer)',
    'public.hours_save_mail_template(text, text, text, text)',
    'public.hours_outbox_overview(uuid, uuid, integer)',
    'public.hours_approve_outbox_message(uuid, text, text)',
    'public.hours_withdraw_outbox_message(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.hours_outbox_due_weeks(integer, uuid)',
    'public.hours_outbox_sync(uuid, jsonb, jsonb)',
    'public.hours_outbox_claim(integer, integer, uuid)',
    'public.hours_outbox_record_sent(uuid, uuid, text, text, jsonb)',
    'public.hours_outbox_record_failure(uuid, uuid, text, text)',
    'public.hours_outbox_release(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

comment on table public.hours_mail_profiles is 'Which messages go out for one client, to whom and when. Stores the planner rule shape of _shared/hours-schedule.ts verbatim; the timing meaning lives there, not here. Empty means nothing goes out.';
comment on table public.hours_mail_templates is 'The words of one message per language, addressed by the templateId a planner rule already carried.';
comment on table public.hours_outbox_messages is 'One row per planned outgoing hours message, keyed by the planner dedup key. A scheduled moment can never stand in for an approval, a sent row is immutable, and a blocked send is logged as a concept in communications rather than dropped.';

commit;
notify pgrst, 'reload schema';
