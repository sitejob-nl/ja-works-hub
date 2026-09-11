-- Durable mail intake: a reply to the hours request becomes a source and a
-- proposal without anybody opening the inbox.
--
-- The boundary is unchanged. A message that comes in is a fact about a delivery,
-- not payable time: only hours_apply_source_proposal writes a day revision, and
-- it takes the proposal literally, by an explicit act of a named internal user.
-- Nothing here writes timesheets, invoicing, hour letters, CSV import or
-- communication, and this route never calls a paid provider.
--
-- Three things arrive together because they only make sense together:
--
--  1. hours_week_requests — the request reference. The ticket names it as if it
--     existed; it did not. It scopes one outgoing hours request to exactly one
--     client week and carries a short, readable code that travels in the subject
--     line. T8 fills in the message id, conversation and recipients after it
--     sends; everything on the receiving side is already here.
--  2. hours_mail_folders — one durable cursor per followed folder.
--  3. hours_mail_messages — the queue, the deduplication and the control bin in
--     one place, because they are three views of the same fact: this message was
--     seen, and this is how far it got.
begin;

-- ---------------------------------------------------------------------------
-- The request reference
-- ---------------------------------------------------------------------------

-- Deliberately not a secret. The code says which week a delivery belongs to; it
-- gives no access and makes no hours. It travels in a subject line that will be
-- quoted and forwarded, so treating it as a secret would be a lie. The sender
-- still has to be recognised, and applying still needs an internal user.
create table if not exists public.hours_week_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  company_id uuid not null references public.companies(id),
  -- Crockford-ish: no 0/O and no 1/I, so a human can read one back over the phone.
  code text not null check (code ~ '^UR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$'),
  label text check (label is null or length(label) between 1 and 200),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_note text check (revoke_note is null or length(revoke_note) <= 2000),
  -- Filled by T8 once it has actually sent. Until then the code carries the load.
  outbound_message_id text check (outbound_message_id is null or length(outbound_message_id) between 3 and 512),
  conversation_id text check (conversation_id is null or length(conversation_id) between 1 and 512),
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array'
    and jsonb_array_length(recipients) <= 50),
  sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week_id, organization_id) references public.hours_weeks(id, organization_id),
  check (revoked_at is null or revoke_note is not null or true),
  check ((sent_at is null) or (outbound_message_id is not null or conversation_id is not null))
);
create unique index if not exists hours_week_requests_code_idx
  on public.hours_week_requests(organization_id, code);
-- One outgoing message id resolves to one request, or the reply chain would be
-- a second way to be ambiguous.
create unique index if not exists hours_week_requests_message_idx
  on public.hours_week_requests(organization_id, lower(outbound_message_id))
  where outbound_message_id is not null;
create index if not exists hours_week_requests_week_idx
  on public.hours_week_requests(week_id, organization_id);
create index if not exists hours_week_requests_conversation_idx
  on public.hours_week_requests(organization_id, conversation_id)
  where conversation_id is not null;

-- What a request is may never move: its week, its company and its code are the
-- coupling itself. Withdrawing moves once, and T8's three fields are filled once.
create or replace function private.hours_request_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Uitvragen zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.company_id, new.code, new.label,
      new.expires_at, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.company_id, old.code, old.label,
      old.expires_at, old.created_by, old.created_at) then
    raise exception 'Uitvragen zijn onveranderlijk' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Deze uitvraag is al ingetrokken' using errcode = '42501';
  end if;
  if (old.outbound_message_id is not null and new.outbound_message_id is distinct from old.outbound_message_id)
     or (old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id)
     or (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
     or (old.sent_at is not null and new.recipients is distinct from old.recipients) then
    raise exception 'De verzendgegevens van een uitvraag liggen vast' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_request_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_request_guard on public.hours_week_requests;
create trigger hours_request_guard before update or delete on public.hours_week_requests
  for each row execute function private.hours_request_guard();

-- ---------------------------------------------------------------------------
-- Followed folders and their cursor
-- ---------------------------------------------------------------------------

create table if not exists public.hours_mail_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mail_account_id uuid not null references public.mail_accounts(id),
  -- A Graph folder id or a well-known name; the intake never invents one.
  folder_id text not null check (length(folder_id) between 1 and 512),
  folder_label text not null check (length(folder_label) between 1 and 200),
  enabled boolean not null default true,
  -- The cursor. Written only when a whole pass finished, so an interrupted run
  -- resumes at the last complete position instead of skipping what it had seen.
  delta_link text check (delta_link is null or length(delta_link) <= 8192),
  cursor_updated_at timestamptz,
  resync_count integer not null default 0 check (resync_count >= 0),
  last_run_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists hours_mail_folders_unique_idx
  on public.hours_mail_folders(organization_id, mail_account_id, folder_id);
create index if not exists hours_mail_folders_org_idx on public.hours_mail_folders(organization_id);
create index if not exists hours_mail_folders_account_idx on public.hours_mail_folders(mail_account_id);

create or replace function private.hours_mail_folder_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Een gevolgde map wordt uitgezet, niet gewist' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.mail_account_id, new.folder_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.mail_account_id, old.folder_id, old.created_by, old.created_at) then
    raise exception 'Een gevolgde map kan niet naar een andere mailbox wijzen' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_mail_folder_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_mail_folder_guard on public.hours_mail_folders;
create trigger hours_mail_folder_guard before update or delete on public.hours_mail_folders
  for each row execute function private.hours_mail_folder_guard();

-- ---------------------------------------------------------------------------
-- The queue, the deduplication and the control bin
-- ---------------------------------------------------------------------------

create table if not exists public.hours_mail_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  folder_row_id uuid not null references public.hours_mail_folders(id),
  mail_account_id uuid not null references public.mail_accounts(id),
  -- The RFC Message-ID, which is the only identity that survives a move between
  -- folders: Graph hands a moved message a new id of its own. A sender broken
  -- enough to omit it falls back to `graph:<id>`, which is honestly less stable.
  message_key text not null check (length(message_key) between 1 and 512),
  graph_message_id text not null check (length(graph_message_id) between 1 and 2048),
  internet_message_id text check (internet_message_id is null or length(internet_message_id) <= 512),
  subject text check (subject is null or length(subject) <= 1000),
  from_address text check (from_address is null or length(from_address) <= 320),
  from_name text check (from_name is null or length(from_name) <= 320),
  received_at timestamptz,
  has_attachments boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'filed', 'needs_attention', 'dismissed')),
  reason_code text check (reason_code is null or reason_code in (
    'geen_uitvraag', 'onbekende_uitvraag', 'dubbele_uitvraag', 'uitvraag_gesloten',
    'onbekende_afzender', 'tegenstrijdige_koppeling', 'week_gesloten', 'geen_werkdagen',
    'niet_leesbaar', 'te_vaak_geprobeerd', 'verdwenen', 'handmatig_afgehandeld')),
  reason_note text check (reason_note is null or length(reason_note) <= 2000),
  week_id uuid,
  request_id uuid references public.hours_week_requests(id),
  source_id uuid,
  -- A human at the office pointing this message at a week beats every mechanism.
  assigned_week_id uuid,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz,
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  renewal_count integer not null default 0 check (renewal_count between 0 and 100),
  proposal_count integer not null default 0 check (proposal_count between 0 and 2000),
  attachment_count integer not null default 0 check (attachment_count between 0 and 200),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  foreign key (week_id, organization_id) references public.hours_weeks(id, organization_id),
  foreign key (assigned_week_id, organization_id) references public.hours_weeks(id, organization_id),
  foreign key (source_id, week_id, organization_id)
    references public.hours_week_sources(id, week_id, organization_id),
  -- A claim is a token plus a lease plus a status, or it is nothing at all.
  check ((status = 'processing') = (claim_token is not null)),
  check ((claim_token is null) = (lease_expires_at is null)),
  -- A filed message names what it produced; anything else names why it stopped.
  check ((status <> 'filed') or (week_id is not null and source_id is not null)),
  check ((status not in ('needs_attention', 'dismissed')) or reason_code is not null),
  check ((status in ('filed', 'needs_attention', 'dismissed')) = (resolved_at is not null)),
  check ((assigned_week_id is null) = (assigned_by is null))
    ,check ((assigned_by is null) = (assigned_at is null))
);
-- Fetching the same message twice is one row, one claim and one source.
create unique index if not exists hours_mail_messages_key_idx
  on public.hours_mail_messages(organization_id, mail_account_id, message_key);
create index if not exists hours_mail_messages_queue_idx
  on public.hours_mail_messages(folder_row_id, status, first_seen_at);
create index if not exists hours_mail_messages_org_idx
  on public.hours_mail_messages(organization_id, status);
create index if not exists hours_mail_messages_graph_idx
  on public.hours_mail_messages(mail_account_id, graph_message_id);
create index if not exists hours_mail_messages_week_idx
  on public.hours_mail_messages(week_id, organization_id) where week_id is not null;

-- What a message *is* never moves; only how far it got does. A message can never
-- be re-attributed to another mailbox, another folder or another identity.
create or replace function private.hours_mail_message_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Ontvangen berichten zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.folder_row_id, new.mail_account_id, new.message_key,
      new.internet_message_id, new.subject, new.from_address, new.from_name, new.received_at,
      new.first_seen_at)
     is distinct from
     (old.id, old.organization_id, old.folder_row_id, old.mail_account_id, old.message_key,
      old.internet_message_id, old.subject, old.from_address, old.from_name, old.received_at,
      old.first_seen_at) then
    raise exception 'Ontvangen berichten zijn onveranderlijk' using errcode = '42501';
  end if;
  -- Filing is the one terminal state that produced administration; it may not be
  -- undone by a later pass, a later claim or a later hand.
  if old.status = 'filed' and new.status is distinct from 'filed' then
    raise exception 'Dit bericht is al verwerkt' using errcode = '42501';
  end if;
  if old.status = 'filed' and (new.source_id, new.week_id) is distinct from (old.source_id, old.week_id) then
    raise exception 'Dit bericht is al verwerkt' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_mail_message_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_mail_message_guard on public.hours_mail_messages;
create trigger hours_mail_message_guard before update or delete on public.hours_mail_messages
  for each row execute function private.hours_mail_message_guard();

-- ---------------------------------------------------------------------------
-- A third author for a delivered source
-- ---------------------------------------------------------------------------

-- A mailed delivery has no internal author and no client link: it names the
-- message it came out of. The administration says that rather than crediting
-- somebody who was not there.
alter table public.hours_week_sources add column if not exists mail_message_id uuid
  references public.hours_mail_messages(id);
alter table public.hours_source_proposals add column if not exists mail_message_id uuid
  references public.hours_mail_messages(id);
create index if not exists hours_sources_mail_message_idx
  on public.hours_week_sources(mail_message_id) where mail_message_id is not null;
create index if not exists hours_proposals_mail_message_idx
  on public.hours_source_proposals(mail_message_id) where mail_message_id is not null;

alter table public.hours_week_sources drop constraint if exists hours_week_sources_author_check;
alter table public.hours_week_sources add constraint hours_week_sources_author_check
  check ((created_by is not null)::int + (client_link_id is not null)::int
       + (mail_message_id is not null)::int = 1);

alter table public.hours_source_proposals drop constraint if exists hours_source_proposals_author_check;
alter table public.hours_source_proposals add constraint hours_source_proposals_author_check
  check (((created_by is not null)::int + (client_link_id is not null)::int
        + (mail_message_id is not null)::int = 1)
    -- Form input has no delivered file to point at; a file and a message do.
    and (client_link_id is not null) = (source_id is null));

-- A proposal out of a message is resolved by an internal user like any other,
-- so the resolution rule only has to learn that it may exist without one.
alter table public.hours_source_proposals drop constraint if exists hours_source_proposals_resolution_check;
alter table public.hours_source_proposals add constraint hours_source_proposals_resolution_check
  check ((status = 'open' and resolved_at is null and resolved_by is null
          and applied_revision_id is null and applied_created_revision is null)
      or (status = 'discarded' and resolved_at is not null
          and (resolved_by is not null or client_link_id is not null)
          and applied_revision_id is null and applied_created_revision is null)
      or (status = 'applied' and resolved_at is not null and resolved_by is not null
          and applied_revision_id is not null and applied_created_revision is not null));

-- The content of a proposal still never changes; the message it came out of
-- joins the tuple that may not move.
create or replace function private.hours_proposal_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.source_id, new.day_id, new.minutes,
      new.no_hours_reason, new.note, new.source_input, new.page_label, new.page_number,
      new.assignment_uncertain, new.client_link_id, new.mail_message_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.source_id, old.day_id, old.minutes,
      old.no_hours_reason, old.note, old.source_input, old.page_label, old.page_number,
      old.assignment_uncertain, old.client_link_id, old.mail_message_id, old.created_by, old.created_at) then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if old.status <> 'open' then
    raise exception 'Dit voorstel is al afgewikkeld' using errcode = '42501';
  end if;
  if (old.assignment_confirmed_at is not null
      and (new.assignment_confirmed_at, new.assignment_confirmed_by, new.assignment_note)
          is distinct from (old.assignment_confirmed_at, old.assignment_confirmed_by, old.assignment_note))
     or (old.values_confirmed_at is not null
      and (new.values_confirmed_at, new.values_confirmed_by, new.values_note)
          is distinct from (old.values_confirmed_at, old.values_confirmed_by, old.values_note)) then
    raise exception 'Deze bevestiging staat al vast' using errcode = '42501';
  end if;
  -- One doubt moves per write, so two confirmations can never ride along on one.
  if (new.assignment_confirmed_at is distinct from old.assignment_confirmed_at)
     and (new.values_confirmed_at is distinct from old.values_confirmed_at) then
    raise exception 'Bevestig één twijfel per handeling' using errcode = '42501';
  end if;
  if new.uncertain_fields is distinct from old.uncertain_fields then
    raise exception 'De gelezen twijfel van een voorstel ligt vast' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Access: the backend owns every write, internal reads need finance rights
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array['hours_week_requests', 'hours_mail_folders', 'hours_mail_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format($p$create policy hours_internal_read on public.%I for select to authenticated
      using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())
        and ((select public.has_role_permission('finance.view'))
          or (select public.has_role_permission('finance.manage'))))$p$, t);
    execute format('drop policy if exists hours_workflow_module_required on public.%I', t);
    execute format($p$create policy hours_workflow_module_required on public.%I as restrictive
      for select to authenticated using ((select private.hours_module_enabled()))$p$, t);
    execute format('drop trigger if exists hours_history_immutable on public.%I', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The service-role gate. An unattended run has no session, so the module check
-- cannot come from a profile; it comes from the organisation the row belongs to.
-- JA Werkt has this module switched off, which is why nothing happens there —
-- a fact of the gate, not a matter of discipline.
create or replace function private.hours_require_service_module(p_organization_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$ begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'Onbekende organisatie' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organization_modules
      where organization_id = p_organization_id and module_name = 'uren-workflow' and enabled is true) then
    raise exception 'De urenmodule is niet beschikbaar voor dit bedrijf' using errcode = '42501';
  end if;
  return p_organization_id;
end $$;
revoke all on function private.hours_require_service_module(uuid) from public, anon, authenticated, service_role;

-- Takes a claimed message under lock and proves the caller still holds it. An
-- instance whose lease expired while another picked the message up can no
-- longer finish it, which is the whole point of handing out a token.
create or replace function private.hours_mail_lock_claimed(p_message_id uuid, p_claim_token uuid)
returns public.hours_mail_messages language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.hours_mail_messages%rowtype; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_row from public.hours_mail_messages where id = p_message_id for update;
  if not found then raise exception 'Onbekend bericht' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_row.organization_id);
  if v_row.status <> 'processing' or p_claim_token is null or v_row.claim_token <> p_claim_token then
    raise exception 'Deze claim is niet meer geldig' using errcode = '22023';
  end if;
  return v_row;
end $$;
revoke all on function private.hours_mail_lock_claimed(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The addresses that belong to one client. A reply from someone else is not
-- refused because it is suspicious; it is refused because nothing says which
-- week it is about, and guessing is what this ticket forbids.
create or replace function private.hours_request_senders(p_request public.hours_week_requests)
returns text[] language sql stable set search_path = '' as $$
  select array(
    select distinct lower(btrim(address)) from (
      select c.email as address from public.companies c
        where c.id = p_request.company_id and c.organization_id = p_request.organization_id
      union all
      select c.invoice_email from public.companies c
        where c.id = p_request.company_id and c.organization_id = p_request.organization_id
      union all
      select k.email from public.company_contacts k
        where k.company_id = p_request.company_id and k.organization_id = p_request.organization_id
      union all
      select jsonb_array_elements_text(p_request.recipients)
    ) as addresses where nullif(btrim(address), '') is not null);
$$;
revoke all on function private.hours_request_senders(public.hours_week_requests)
  from public, anon, authenticated, service_role;

-- The week context one reading needs: who is expected and which workdays exist.
create or replace function private.hours_mail_week_context(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.candidate_name)
      order by m.candidate_name, m.id) from public.hours_week_members m
      where m.week_id = p_week_id and m.organization_id = p_org), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'member_id', d.member_id,
      'work_date', d.work_date) order by d.work_date, d.member_id) from public.hours_days d
      where d.week_id = p_week_id and d.organization_id = p_org), '[]'::jsonb));
$$;
revoke all on function private.hours_mail_week_context(uuid, uuid)
  from public, anon, authenticated, service_role;

-- What the office sees: the followed folders and everything that stopped.
create or replace function private.hours_mail_overview_projection(p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'organization_id', p_org,
    'can_manage', public.is_internal_user() and public.has_role_permission('finance.manage'),
    'folders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'mail_account_id', f.mail_account_id, 'folder_id', f.folder_id,
      'folder_label', f.folder_label, 'enabled', f.enabled,
      'mailbox_email', coalesce(a.mailbox_email, a.from_email), 'mailbox_name', a.display_name,
      'has_cursor', f.delta_link is not null, 'cursor_updated_at', f.cursor_updated_at,
      'resync_count', f.resync_count, 'last_run_at', f.last_run_at, 'last_error', f.last_error,
      'pending', (select count(*) from public.hours_mail_messages m
        where m.folder_row_id = f.id and m.status in ('pending', 'processing')),
      'filed', (select count(*) from public.hours_mail_messages m
        where m.folder_row_id = f.id and m.status = 'filed'))
      order by f.created_at, f.id)
      from public.hours_mail_folders f
      join public.mail_accounts a on a.id = f.mail_account_id
      where f.organization_id = p_org), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'subject', m.subject, 'from_address', m.from_address, 'from_name', m.from_name,
      'received_at', m.received_at, 'first_seen_at', m.first_seen_at, 'reason_code', m.reason_code,
      'reason_note', m.reason_note, 'attempt_count', m.attempt_count,
      'folder_label', f.folder_label, 'has_attachments', m.has_attachments)
      order by m.received_at desc nulls last, m.first_seen_at desc, m.id)
      from public.hours_mail_messages m
      join public.hours_mail_folders f on f.id = m.folder_row_id
      where m.organization_id = p_org and m.status = 'needs_attention'), '[]'::jsonb));
$$;
revoke all on function private.hours_mail_overview_projection(uuid)
  from public, anon, authenticated, service_role;

-- The two service-role functions of the scan release predate this helper and
-- were the one pair of routes the SaaS gate did not actually close: called with
-- the service key while the module was switched off, they still wrote into a
-- gated table. Their behaviour is otherwise untouched.
create or replace function public.hours_claim_source_reading(p_source_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_source public.hours_week_sources%rowtype; v_id uuid; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de uitleesfunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_source from public.hours_week_sources where id = p_source_id;
  if not found then raise exception 'Bron niet beschikbaar' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_source.organization_id);
  if not exists (select 1 from public.profiles p
                 where p.id = p_actor_id and p.organization_id = v_source.organization_id
                   and p.is_active is true) then
    raise exception 'Onbekende aanvrager voor deze bron' using errcode = '42501';
  end if;
  update public.hours_source_readings
    set status = 'failed', finished_at = clock_timestamp(), error_code = 'abandoned'
    where source_id = p_source_id and status = 'running'
      and started_at < clock_timestamp() - interval '15 minutes';
  begin
    insert into public.hours_source_readings(organization_id, week_id, source_id, actor_id)
      values (v_source.organization_id, v_source.week_id, p_source_id, p_actor_id)
      returning id into v_id;
  exception when unique_violation then
    raise exception 'Deze bron wordt al uitgelezen; wacht tot die uitlezing klaar is'
      using errcode = '22023';
  end;
  return jsonb_build_object('ok', true, 'reading_id', v_id, 'source_id', p_source_id,
    'week_id', v_source.week_id, 'organization_id', v_source.organization_id);
end $$;

create or replace function public.hours_finish_source_reading(p_reading_id uuid, p_status text,
  p_request_id text default null, p_cost_cents integer default null, p_lines integer default null,
  p_error_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.hours_source_readings%rowtype; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de uitleesfunctie mag dit doen' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed') then
    raise exception 'Onbekende uitkomst van deze uitlezing' using errcode = '22023';
  end if;
  select * into v_row from public.hours_source_readings where id = p_reading_id;
  if not found then raise exception 'Deze uitlezing is al afgerond' using errcode = '22023'; end if;
  perform private.hours_require_service_module(v_row.organization_id);
  update public.hours_source_readings
    set status = p_status, finished_at = clock_timestamp(),
        ai_request_id = case when p_request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then p_request_id::uuid else null end,
        cost_cents = greatest(coalesce(p_cost_cents, 0), 0),
        line_count = least(greatest(coalesce(p_lines, 0), 0), 2000),
        error_code = left(nullif(btrim(coalesce(p_error_code, '')), ''), 100)
    where id = p_reading_id and status = 'running' returning * into v_row;
  if not found then raise exception 'Deze uitlezing is al afgerond' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'reading_id', v_row.id, 'status', v_row.status);
end $$;

-- ---------------------------------------------------------------------------
-- What the office can do
-- ---------------------------------------------------------------------------

create or replace function public.hours_issue_week_request(p_week_id uuid, p_label text default null,
  p_valid_days integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_week public.hours_weeks%rowtype; v_code text; v_id uuid; v_try integer := 0; begin
  v_week := private.hours_lock_week(p_week_id);
  p_label := nullif(private.hours_source_trim(p_label), '');
  if length(p_label) > 200 then raise exception 'Label is te lang' using errcode = '22023'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 120 then
    raise exception 'Kies een geldigheidsduur tussen één en honderdtwintig dagen' using errcode = '22023';
  end if;
  loop
    v_try := v_try + 1;
    -- Eight characters out of a 32-symbol alphabet, so a code is readable back
    -- over the phone and still not worth guessing at.
    select 'UR-' || string_agg(part, '') into v_code from (
      select case when n = 5 then '-' else '' end
        || substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                  1 + floor(random() * 32)::int, 1) as part
      from generate_series(1, 8) as n) as parts;
    begin
      insert into public.hours_week_requests(organization_id, week_id, company_id, code, label,
        expires_at, created_by)
        values (v_week.organization_id, p_week_id, v_week.company_id, v_code, p_label,
          clock_timestamp() + make_interval(days => p_valid_days), auth.uid())
        returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 8 then raise; end if;
    end;
  end loop;
  return private.hours_week_sources_projection(p_week_id, v_week.organization_id)
    || jsonb_build_object('request_id', v_id, 'code', v_code);
end $$;

create or replace function public.hours_revoke_week_request(p_request_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_row public.hours_week_requests%rowtype; begin
  select * into v_row from public.hours_week_requests
    where id = p_request_id and organization_id = v_org for update;
  if not found then raise exception 'Geen toegang tot deze uitvraag' using errcode = '42501'; end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  if v_row.revoked_at is not null then
    raise exception 'Deze uitvraag is al ingetrokken' using errcode = '22023';
  end if;
  update public.hours_week_requests set revoked_at = clock_timestamp(), revoke_note = p_note
    where id = p_request_id;
  return private.hours_week_sources_projection(v_row.week_id, v_org);
end $$;

create or replace function public.hours_mail_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); begin
  return private.hours_mail_overview_projection(v_org);
end $$;

-- Following a folder, or stopping. There is no delete: what has already been
-- observed stays observed, and a folder that is switched off is simply not
-- polled again.
create or replace function public.hours_mail_set_folder(p_mail_account_id uuid, p_folder_id text,
  p_folder_label text, p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_id uuid; begin
  p_folder_id := nullif(private.hours_source_trim(p_folder_id), '');
  p_folder_label := nullif(private.hours_source_trim(p_folder_label), '');
  if p_folder_id is null or length(p_folder_id) > 512 or p_folder_id ~ '[[:cntrl:]]'
     or p_folder_label is null or length(p_folder_label) > 200 or p_enabled is null then
    raise exception 'Ongeldige map' using errcode = '22023';
  end if;
  if not exists (select 1 from public.mail_accounts a
      where a.id = p_mail_account_id and a.organization_id = v_org and a.provider = 'outlook'
        and a.deleted_at is null and a.mail_read_enabled is true) then
    raise exception 'Deze mailbox bestaat niet of mag niet gelezen worden' using errcode = '22023';
  end if;
  insert into public.hours_mail_folders(organization_id, mail_account_id, folder_id, folder_label,
    enabled, created_by)
    values (v_org, p_mail_account_id, p_folder_id, p_folder_label, p_enabled, auth.uid())
  on conflict (organization_id, mail_account_id, folder_id)
    do update set folder_label = excluded.folder_label, enabled = excluded.enabled
    returning id into v_id;
  return private.hours_mail_overview_projection(v_org) || jsonb_build_object('folder_row_id', v_id);
end $$;

-- Taking something off the control bin. It is not deleted and it is not filed:
-- somebody looked at it and said it needs nothing.
create or replace function public.hours_mail_dismiss_message(p_message_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_row public.hours_mail_messages%rowtype; begin
  select * into v_row from public.hours_mail_messages
    where id = p_message_id and organization_id = v_org for update;
  if not found then raise exception 'Geen toegang tot dit bericht' using errcode = '42501'; end if;
  if v_row.status <> 'needs_attention' then
    raise exception 'Alleen een bericht in de controlebak kan worden afgehandeld' using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_mail_messages set status = 'dismissed', reason_code = 'handmatig_afgehandeld',
    reason_note = p_note, resolved_by = auth.uid(), resolved_at = clock_timestamp()
    where id = p_message_id;
  return private.hours_mail_overview_projection(v_org);
end $$;

-- Pointing a message at a week by hand. This is the one place a human decision
-- overrides the reference: the next pass files it against that week without
-- asking the sender check, because somebody who can see both has already looked.
create or replace function public.hours_mail_assign_message(p_message_id uuid, p_week_id uuid,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_row public.hours_mail_messages%rowtype;
  v_week public.hours_weeks%rowtype; begin
  select * into v_row from public.hours_mail_messages
    where id = p_message_id and organization_id = v_org for update;
  if not found then raise exception 'Geen toegang tot dit bericht' using errcode = '42501'; end if;
  if v_row.status <> 'needs_attention' then
    raise exception 'Alleen een bericht in de controlebak kan worden toegewezen' using errcode = '22023';
  end if;
  -- The same lock and the same client gate every other writer of this week uses.
  v_week := private.hours_lock_week(p_week_id);
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_mail_messages set status = 'pending', reason_code = null, reason_note = p_note,
    assigned_week_id = v_week.id, assigned_by = auth.uid(), assigned_at = clock_timestamp(),
    resolved_by = null, resolved_at = null, attempt_count = 0, renewal_count = 0
    where id = p_message_id;
  return private.hours_mail_overview_projection(v_org);
end $$;

-- ---------------------------------------------------------------------------
-- What the unattended run does
-- ---------------------------------------------------------------------------

-- Which folders to poll. Only organisations with the module switched on, and
-- only folders somebody chose to follow.
create or replace function public.hours_mail_due_folders(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ongeldig aantal' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(row order by row->>'created_at', row->>'id') from (
    select jsonb_build_object('id', f.id, 'organization_id', f.organization_id,
      'mail_account_id', f.mail_account_id, 'folder_id', f.folder_id,
      'folder_label', f.folder_label, 'delta_link', f.delta_link,
      'created_at', f.created_at) as row
    from public.hours_mail_folders f
    join public.organization_modules m on m.organization_id = f.organization_id
      and m.module_name = 'uren-workflow' and m.enabled is true
    join public.mail_accounts a on a.id = f.mail_account_id
    where f.enabled and a.deleted_at is null and a.mail_read_enabled is true
    order by f.created_at, f.id limit p_limit) as rows), '[]'::jsonb);
end $$;

-- Recording what a pass observed. Idempotent by construction: the same message
-- twice is one row. A message that moved keeps its identity and only updates the
-- Graph id it currently answers to.
create or replace function public.hours_mail_record_messages(p_folder_row_id uuid,
  p_messages jsonb, p_removed text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_folder public.hours_mail_folders%rowtype; v_entry jsonb; v_key text; v_graph text;
  v_added integer := 0; v_seen integer := 0; v_gone integer := 0; v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_folder from public.hours_mail_folders where id = p_folder_row_id for update;
  if not found then raise exception 'Onbekende map' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_folder.organization_id);
  if jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages) > 500 then
    raise exception 'Geef hoogstens vijfhonderd berichten op' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_messages) as value loop
    v_graph := nullif(btrim(coalesce(v_entry->>'graph_message_id', '')), '');
    v_key := nullif(btrim(coalesce(v_entry->>'message_key', '')), '');
    if v_graph is null or length(v_graph) > 2048 or v_key is null or length(v_key) > 512 then
      raise exception 'Een bericht zonder identiteit kan niet worden vastgelegd' using errcode = '22023';
    end if;
    insert into public.hours_mail_messages(organization_id, folder_row_id, mail_account_id,
      message_key, graph_message_id, internet_message_id, subject, from_address, from_name,
      received_at, has_attachments)
      values (v_folder.organization_id, v_folder.id, v_folder.mail_account_id, v_key, v_graph,
        left(nullif(btrim(coalesce(v_entry->>'internet_message_id', '')), ''), 512),
        left(nullif(btrim(coalesce(v_entry->>'subject', '')), ''), 1000),
        lower(left(nullif(btrim(coalesce(v_entry->>'from_address', '')), ''), 320)),
        left(nullif(btrim(coalesce(v_entry->>'from_name', '')), ''), 320),
        nullif(v_entry->>'received_at', '')::timestamptz,
        coalesce((v_entry->>'has_attachments')::boolean, false))
    on conflict (organization_id, mail_account_id, message_key) do nothing
    returning id into v_id;
    if v_id is null then
      v_seen := v_seen + 1;
      -- A moved message answers to a new Graph id; its identity did not change.
      update public.hours_mail_messages
        set graph_message_id = v_graph, last_seen_at = clock_timestamp()
        where organization_id = v_folder.organization_id
          and mail_account_id = v_folder.mail_account_id and message_key = v_key;
    else
      v_added := v_added + 1;
    end if;
  end loop;
  -- Removed by the mailbox: stop what has not started. A message that was
  -- already filed keeps its source, because that delivery really happened.
  if p_removed is not null and array_length(p_removed, 1) > 0 then
    update public.hours_mail_messages
      set status = 'dismissed', reason_code = 'verdwenen', resolved_at = clock_timestamp()
      where organization_id = v_folder.organization_id
        and mail_account_id = v_folder.mail_account_id
        and graph_message_id = any(p_removed) and status = 'pending';
    get diagnostics v_gone = row_count;
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'seen_again', v_seen, 'removed', v_gone);
end $$;

-- The cursor moves only when a whole pass finished. A pass that fell over leaves
-- it where it was: messages are seen again, never skipped.
create or replace function public.hours_mail_set_cursor(p_folder_row_id uuid, p_delta_link text,
  p_resynced boolean default false, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_folder public.hours_mail_folders%rowtype; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_folder from public.hours_mail_folders where id = p_folder_row_id for update;
  if not found then raise exception 'Onbekende map' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_folder.organization_id);
  p_delta_link := nullif(btrim(coalesce(p_delta_link, '')), '');
  if p_delta_link is not null and (length(p_delta_link) > 8192
      or p_delta_link !~ '^https://graph\.microsoft\.com/') then
    raise exception 'Een cursor moet van Microsoft Graph komen' using errcode = '22023';
  end if;
  update public.hours_mail_folders set
    delta_link = coalesce(p_delta_link, delta_link),
    cursor_updated_at = case when p_delta_link is not null then clock_timestamp() else cursor_updated_at end,
    resync_count = resync_count + case when coalesce(p_resynced, false) then 1 else 0 end,
    last_run_at = clock_timestamp(),
    last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
    where id = p_folder_row_id;
  return jsonb_build_object('ok', true, 'folder_row_id', p_folder_row_id);
end $$;

-- An expired delta token means starting the folder over. Throwing the cursor
-- away is safe precisely because the deduplication above turns a full pass into
-- the same rows, and therefore into no second source.
create or replace function public.hours_mail_clear_cursor(p_folder_row_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_folder public.hours_mail_folders%rowtype; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_folder from public.hours_mail_folders where id = p_folder_row_id for update;
  if not found then raise exception 'Onbekende map' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_folder.organization_id);
  update public.hours_mail_folders set delta_link = null, cursor_updated_at = clock_timestamp(),
    resync_count = resync_count + 1 where id = p_folder_row_id;
  return jsonb_build_object('ok', true, 'folder_row_id', p_folder_row_id);
end $$;

-- Claiming work. The lease is what makes a crashed instance recoverable, and the
-- attempt count is what keeps a message that structurally falls over from going
-- round forever.
create or replace function public.hours_mail_claim_messages(p_folder_row_id uuid,
  p_limit integer default 5, p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_folder public.hours_mail_folders%rowtype; v_token uuid := gen_random_uuid(); v_rows jsonb; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 25
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Ongeldige claim' using errcode = '22023';
  end if;
  select * into v_folder from public.hours_mail_folders where id = p_folder_row_id for update;
  if not found then raise exception 'Onbekende map' using errcode = '42501'; end if;
  perform private.hours_require_service_module(v_folder.organization_id);
  -- A lease that ran out returns the message to the queue with its attempt
  -- already counted, so a crash costs one attempt and not the whole message.
  update public.hours_mail_messages set status = 'pending', claim_token = null, claimed_at = null,
    lease_expires_at = null
    where folder_row_id = p_folder_row_id and status = 'processing'
      and lease_expires_at < clock_timestamp();
  -- Past the bound the message stops being work and starts being something the
  -- office has to look at.
  update public.hours_mail_messages set status = 'needs_attention', reason_code = 'te_vaak_geprobeerd',
    resolved_at = clock_timestamp()
    where folder_row_id = p_folder_row_id and status = 'pending' and attempt_count >= 5;
  with picked as (
    select id from public.hours_mail_messages
      where folder_row_id = p_folder_row_id and status = 'pending'
      order by first_seen_at, id limit p_limit for update skip locked),
  claimed as (
    update public.hours_mail_messages m set status = 'processing', claim_token = v_token,
      claimed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempt_count = m.attempt_count + 1, renewal_count = 0
      from picked where m.id = picked.id
      returning m.id, m.graph_message_id, m.message_key, m.subject, m.from_address,
        m.received_at, m.has_attachments, m.assigned_week_id, m.organization_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'graph_message_id', graph_message_id,
    'message_key', message_key, 'subject', subject, 'from_address', from_address,
    'received_at', received_at, 'has_attachments', has_attachments,
    'assigned_week_id', assigned_week_id, 'organization_id', organization_id)), '[]'::jsonb)
    into v_rows from claimed;
  return jsonb_build_object('ok', true, 'claim_token', v_token, 'messages', v_rows);
end $$;

-- Renewing, but not forever. Whoever needs a fourth extension is stuck, and a
-- stuck worker should lose the message to the queue rather than hold it.
create or replace function public.hours_mail_renew_lease(p_message_id uuid, p_claim_token uuid,
  p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.hours_mail_messages%rowtype; begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Ongeldige verlenging' using errcode = '22023';
  end if;
  v_row := private.hours_mail_lock_claimed(p_message_id, p_claim_token);
  if v_row.renewal_count >= 3 then
    raise exception 'Deze claim is al zo vaak verlengd als toegestaan' using errcode = '22023';
  end if;
  update public.hours_mail_messages
    set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        renewal_count = renewal_count + 1
    where id = p_message_id;
  return jsonb_build_object('ok', true, 'renewals_left', 3 - (v_row.renewal_count + 1));
end $$;

-- The coupling itself: which week this reply is about, and whether the sender
-- belongs to that client. Every step that does not close stops here; nothing
-- reads on to the next one and guesses.
create or replace function public.hours_mail_match_message(p_message_id uuid, p_claim_token uuid,
  p_codes text[] default null, p_reply_ids text[] default null, p_conversation_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.hours_mail_messages%rowtype; v_request public.hours_week_requests%rowtype;
  v_codes text[]; v_week public.hours_weeks%rowtype; v_reason text; v_days integer;
begin
  v_row := private.hours_mail_lock_claimed(p_message_id, p_claim_token);

  -- 1. A human at the office beats every mechanism.
  if v_row.assigned_week_id is not null then
    select * into v_week from public.hours_weeks
      where id = v_row.assigned_week_id and organization_id = v_row.organization_id;
  else
    -- 2. The reference code, from the subject and the new text only.
    select array(select distinct upper(btrim(code)) from unnest(coalesce(p_codes, '{}')) as code
                 where btrim(code) <> '') into v_codes;
    if array_length(v_codes, 1) > 1 then
      return jsonb_build_object('ok', false, 'reason_code', 'dubbele_uitvraag');
    end if;
    if array_length(v_codes, 1) = 1 then
      select * into v_request from public.hours_week_requests
        where organization_id = v_row.organization_id and code = v_codes[1];
      if not found then
        return jsonb_build_object('ok', false, 'reason_code', 'onbekende_uitvraag');
      end if;
    end if;
    -- 3. The reply chain, then 4. the conversation.
    if v_request.id is null and p_reply_ids is not null then
      select * into v_request from public.hours_week_requests
        where organization_id = v_row.organization_id
          and lower(outbound_message_id) = any (select lower(btrim(value))
            from unnest(p_reply_ids) as value where btrim(value) <> '')
        order by created_at desc limit 1;
    end if;
    if v_request.id is null and nullif(btrim(coalesce(p_conversation_id, '')), '') is not null then
      select * into v_request from public.hours_week_requests
        where organization_id = v_row.organization_id and conversation_id = btrim(p_conversation_id)
        order by created_at desc limit 1;
    end if;
    if v_request.id is null then
      return jsonb_build_object('ok', false, 'reason_code', 'geen_uitvraag');
    end if;
    if v_request.revoked_at is not null or v_request.expires_at <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'reason_code', 'uitvraag_gesloten');
    end if;
    -- The sender is what Graph recorded, never what the message body claims.
    if v_row.from_address is null
       or not (lower(v_row.from_address) = any (private.hours_request_senders(v_request))) then
      v_reason := case when exists (select 1 from public.company_contacts k
          where k.organization_id = v_row.organization_id and lower(k.email) = lower(v_row.from_address)
            and k.company_id is distinct from v_request.company_id)
        then 'tegenstrijdige_koppeling' else 'onbekende_afzender' end;
      return jsonb_build_object('ok', false, 'reason_code', v_reason);
    end if;
    select * into v_week from public.hours_weeks
      where id = v_request.week_id and organization_id = v_row.organization_id;
  end if;

  if v_week.id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'week_gesloten');
  end if;
  if not exists (select 1 from public.hours_company_settings s
      where s.company_id = v_week.company_id and s.organization_id = v_week.organization_id and s.enabled) then
    return jsonb_build_object('ok', false, 'reason_code', 'week_gesloten');
  end if;
  select count(*) into v_days from public.hours_days d
    where d.week_id = v_week.id and d.organization_id = v_week.organization_id;
  if v_days = 0 then
    return jsonb_build_object('ok', false, 'reason_code', 'geen_werkdagen');
  end if;
  -- The decision is recorded here, so filing cannot be pointed somewhere else.
  update public.hours_mail_messages set week_id = v_week.id, request_id = v_request.id
    where id = p_message_id;
  return jsonb_build_object('ok', true, 'week_id', v_week.id, 'company_id', v_week.company_id,
    'week_start', v_week.week_start, 'request_id', v_request.id,
    'context', private.hours_mail_week_context(v_week.id, v_week.organization_id));
end $$;

-- Filing, in one transaction. The message, what came attached to it and what was
-- read out of it land together or not at all; there is no state in which a
-- message stands half in the administration.
create or replace function public.hours_mail_file_message(p_message_id uuid, p_claim_token uuid,
  p_source jsonb, p_attachments jsonb default '[]'::jsonb, p_proposals jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.hours_mail_messages%rowtype; v_week public.hours_weeks%rowtype;
  v_source_id uuid; v_entry jsonb; v_day public.hours_days%rowtype; v_ids uuid[];
  v_minutes integer; v_reason text; v_note text; v_label text; v_input jsonb; v_page integer;
  v_attachments integer := 0; v_proposals integer := 0; v_child uuid;
begin
  v_row := private.hours_mail_lock_claimed(p_message_id, p_claim_token);
  if v_row.week_id is null then
    raise exception 'Dit bericht is nog niet aan een urenweek gekoppeld' using errcode = '22023';
  end if;
  select * into v_week from public.hours_weeks
    where id = v_row.week_id and organization_id = v_row.organization_id for update;
  if not found then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
  if not exists (select 1 from public.hours_company_settings s
      where s.company_id = v_week.company_id and s.organization_id = v_week.organization_id and s.enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;

  v_source_id := private.hours_mail_store_source(v_row, v_week, p_source, null);
  if jsonb_typeof(p_attachments) = 'array' then
    if jsonb_array_length(p_attachments) > 50 then
      raise exception 'Hoogstens vijftig bijlagen per bericht' using errcode = '22023';
    end if;
    for v_entry in select value from jsonb_array_elements(p_attachments) as value loop
      v_child := private.hours_mail_store_source(v_row, v_week, v_entry, v_source_id);
      v_attachments := v_attachments + 1;
    end loop;
  end if;

  if jsonb_typeof(p_proposals) = 'array' and jsonb_array_length(p_proposals) > 0 then
    if jsonb_array_length(p_proposals) > 500 then
      raise exception 'Geef hoogstens vijfhonderd voorstellen op' using errcode = '22023';
    end if;
    select array_agg(value->>'day_id' order by value->>'day_id')
      into v_ids from jsonb_array_elements(p_proposals) as value;
    if array_length(v_ids, 1) is distinct from (select count(distinct id) from unnest(v_ids) as id) then
      raise exception 'Elke werkdag mag maar één keer in deze uitlezing staan' using errcode = '22023';
    end if;
    -- The same fixed lock order over days as every other proposal writer.
    foreach v_entry in array (select array_agg(value order by value->>'day_id')
                              from jsonb_array_elements(p_proposals) as value) loop
      select * into v_day from public.hours_days where id = (v_entry->>'day_id')::uuid
        and organization_id = v_row.organization_id and week_id = v_week.id for update;
      if not found then
        raise exception 'Deze werkdag hoort niet bij deze urenweek' using errcode = '42501';
      end if;
      v_minutes := (v_entry->>'minutes')::integer;
      v_reason := nullif(private.hours_source_trim(v_entry->>'no_hours_reason'), '');
      v_note := nullif(private.hours_source_trim(v_entry->>'note'), '');
      v_label := nullif(private.hours_source_trim(v_entry->>'page_label'), '');
      v_input := nullif(v_entry->'source_input', 'null'::jsonb);
      v_page := (v_entry->>'page_number')::integer;
      if v_minutes is null or v_minutes not between 0 and 1440 or (v_minutes = 0 and v_reason is null)
         or (v_minutes > 0 and v_reason is not null) or length(v_reason) > 500 or length(v_note) > 2000
         or length(v_label) > 200 then
        raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
      end if;
      if v_page is not null and v_page <> 1 then
        raise exception 'Een bericht heeft maar één pagina' using errcode = '22023';
      end if;
      perform private.hours_validate_source_input(v_input);
      if v_minutes = 0 and v_input is not null then
        raise exception 'Geen uren kan niet samengaan met aangeleverde brongegevens' using errcode = '22023';
      end if;
      insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
        no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain,
        mail_message_id)
        values (v_row.organization_id, v_week.id, v_source_id, v_day.id, v_minutes, v_reason, v_note,
          v_input, v_label, coalesce(v_page, 1),
          coalesce((v_entry->>'assignment_uncertain')::boolean, false)
            or private.hours_page_contradicts(v_source_id, coalesce(v_page, 1), v_day.member_id),
          p_message_id);
      v_proposals := v_proposals + 1;
    end loop;
  end if;

  update public.hours_mail_messages set status = 'filed', source_id = v_source_id,
    proposal_count = v_proposals, attachment_count = v_attachments,
    resolved_at = clock_timestamp(), claim_token = null, claimed_at = null, lease_expires_at = null
    where id = p_message_id;
  return jsonb_build_object('ok', true, 'source_id', v_source_id, 'week_id', v_week.id,
    'proposals', v_proposals, 'attachments', v_attachments);
end $$;

-- One delivered file out of a message, stored the way every other delivery is:
-- the digest is the path, and the object has to exist with the size and type the
-- caller claims. The bytes were fetched and hashed by the server itself, so the
-- path is not a caller's choice the way it is on the client route.
create or replace function private.hours_mail_store_source(p_message public.hours_mail_messages,
  p_week public.hours_weeks, p_file jsonb, p_receipt uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_name text; v_type text; v_extension text; v_pages integer;
  v_object record; v_path text; v_id uuid; begin
  v_hash := lower(btrim(coalesce(p_file->>'content_hash', '')));
  v_name := nullif(private.hours_source_trim(p_file->>'file_name'), '');
  v_type := nullif(btrim(coalesce(p_file->>'content_type', '')), '');
  v_pages := (p_file->>'page_count')::integer;
  if v_hash !~ '^[0-9a-f]{64}$' or v_name is null or length(v_name) > 255
     or v_name ~ '[[:cntrl:]/\\]' then
    raise exception 'Ongeldige bronverwijzing of bestandsnaam' using errcode = '22023';
  end if;
  v_extension := case v_type
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'application/vnd.ms-excel' then 'xls'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/msword' then 'doc'
    when 'message/rfc822' then 'eml' else null end;
  if v_extension is null then
    raise exception 'Dit bestandstype wordt niet als bron bewaard' using errcode = '22023';
  end if;
  -- The message itself is the receipt and is always one page; an attachment that
  -- nobody counted stays honestly unknown rather than getting an invented count.
  if p_receipt is null then
    if v_type <> 'message/rfc822' then
      raise exception 'Een ontvangst is het bericht zelf' using errcode = '22023';
    end if;
    v_pages := 1;
  elsif v_type = 'message/rfc822' then
    raise exception 'Een bijlage van een bijlage wordt niet bewaard' using errcode = '22023';
  elsif v_type in ('image/jpeg', 'image/png') then
    v_pages := 1;
  end if;
  if v_pages is not null and v_pages not between 1 and 2000 then
    raise exception 'Het aantal pagina''s van deze bron is ongeldig' using errcode = '22023';
  end if;
  v_path := p_week.organization_id::text || '/' || p_week.id::text || '/' || v_hash || '.' || v_extension;
  select (o.metadata->>'size')::bigint as byte_size, o.metadata->>'mimetype' as mimetype into v_object
    from storage.objects o where o.bucket_id = 'hours-sources' and o.name = v_path;
  if not found or v_object.byte_size is null or v_object.byte_size not between 1 and 26214400
     or v_object.mimetype is distinct from v_type then
    raise exception 'Het opgeslagen bestand is niet gevonden of komt niet overeen' using errcode = '22023';
  end if;
  insert into public.hours_week_sources(organization_id, week_id, company_id, storage_path, file_name,
    content_type, byte_size, content_hash, page_count, received_with_source_id, mail_message_id)
    values (p_week.organization_id, p_week.id, p_week.company_id, v_path, v_name, v_type,
      v_object.byte_size, v_hash, v_pages, p_receipt, p_message.id)
  on conflict (week_id, content_hash) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.hours_week_sources
      where week_id = p_week.id and content_hash = v_hash;
  end if;
  return v_id;
end $$;
revoke all on function private.hours_mail_store_source(public.hours_mail_messages, public.hours_weeks,
  jsonb, uuid) from public, anon, authenticated, service_role;

-- Stopping visibly. A message the intake could not place is not deleted and not
-- half-processed: it is named, with the reason, in the control bin.
create or replace function public.hours_mail_fail_message(p_message_id uuid, p_claim_token uuid,
  p_status text, p_reason_code text, p_reason_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.hours_mail_messages%rowtype; begin
  v_row := private.hours_mail_lock_claimed(p_message_id, p_claim_token);
  if p_status is null or p_status not in ('needs_attention', 'dismissed') then
    raise exception 'Onbekende uitkomst' using errcode = '22023';
  end if;
  if p_reason_code is null then
    raise exception 'Een bericht komt nooit zonder reden in de controlebak' using errcode = '22023';
  end if;
  update public.hours_mail_messages set status = p_status, reason_code = p_reason_code,
    reason_note = left(nullif(btrim(coalesce(p_reason_note, '')), ''), 2000),
    resolved_at = clock_timestamp(), claim_token = null, claimed_at = null, lease_expires_at = null
    where id = p_message_id;
  return jsonb_build_object('ok', true, 'message_id', p_message_id, 'status', p_status);
end $$;

-- Handing a claim back untouched, so a pass that runs out of time does not cost
-- the message an attempt it never really used.
create or replace function public.hours_mail_release_message(p_message_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.hours_mail_lock_claimed(p_message_id, p_claim_token);
  update public.hours_mail_messages set status = 'pending', claim_token = null, claimed_at = null,
    lease_expires_at = null where id = p_message_id;
  return jsonb_build_object('ok', true, 'message_id', p_message_id);
end $$;

-- ---------------------------------------------------------------------------
-- The week projection learns about requests and about mail as an origin
-- ---------------------------------------------------------------------------

create or replace function private.hours_week_sources_projection(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  with counts as (
    select count(*) as open_proposals,
      count(*) filter (where p.assignment_uncertain and p.assignment_confirmed_at is null) as undecided_assignments,
      count(*) filter (where p.uncertain_fields is not null and p.values_confirmed_at is null) as uncertain_values
    from public.hours_source_proposals p
    where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open')
  select jsonb_build_object('week_id', p_week_id,
    'open_proposals', (select open_proposals from counts),
    'undecided_assignments', (select undecided_assignments from counts),
    'uncertain_values', (select uncertain_values from counts),
    'can_manage', public.is_internal_user() and public.has_role_permission('finance.manage')
      and exists (select 1 from public.hours_weeks w
        join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
        where w.id = p_week_id and w.organization_id = p_org and c.enabled),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'code', r.code, 'label', r.label, 'created_at', r.created_at,
      'expires_at', r.expires_at, 'revoked_at', r.revoked_at, 'revoke_note', r.revoke_note,
      'sent_at', r.sent_at, 'received', (select count(*) from public.hours_mail_messages m
        where m.request_id = r.id and m.status = 'filed'))
      order by r.created_at, r.id)
      from public.hours_week_requests r
      where r.week_id = p_week_id and r.organization_id = p_org), '[]'::jsonb),
    'client_links', coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'label', l.label, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'last_opened_at', l.last_opened_at, 'revoked_at', l.revoked_at, 'revoke_note', l.revoke_note,
      'report', private.hours_client_link_report(l.id),
      'proposals', (select coalesce(jsonb_agg(private.hours_proposal_projection(p, d, m)
        order by p.created_at, p.id), '[]'::jsonb)
        from public.hours_source_proposals p
        join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
        join public.hours_week_members m on m.id = d.member_id
        where p.client_link_id = l.id and p.organization_id = p_org))
      || private.hours_client_link_progress(l) order by l.created_at, l.id)
      from public.hours_client_week_links l
      where l.week_id = p_week_id and l.organization_id = p_org), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'file_name', s.file_name, 'content_type', s.content_type, 'byte_size', s.byte_size,
      'content_hash', s.content_hash, 'storage_path', s.storage_path, 'created_at', s.created_at,
      'page_count', s.page_count, 'client_link_id', s.client_link_id,
      'received_with_source_id', s.received_with_source_id,
      'mail_message_id', s.mail_message_id,
      'mail_from', (select m.from_address from public.hours_mail_messages m where m.id = s.mail_message_id),
      'pages', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'page_number', g.page_number, 'assignment', g.assignment, 'member_id', g.member_id,
        'candidate_name', gm.candidate_name, 'note', g.note, 'created_at', g.created_at)
        order by g.page_number), '[]'::jsonb)
        from public.hours_source_pages g
        left join public.hours_week_members gm on gm.id = g.member_id
        where g.source_id = s.id and g.organization_id = p_org and g.status = 'active'),
      'proposals', (select coalesce(jsonb_agg(private.hours_proposal_projection(p, d, m)
        order by p.created_at, p.id), '[]'::jsonb)
        from public.hours_source_proposals p
        join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
        join public.hours_week_members m on m.id = d.member_id
        where p.source_id = s.id and p.organization_id = p_org)
      ) order by s.created_at, s.id) from public.hours_week_sources s
      where s.week_id = p_week_id and s.organization_id = p_org), '[]'::jsonb));
$$;
revoke all on function private.hours_week_sources_projection(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

do $$ declare f text; begin
  foreach f in array array[
    'public.hours_issue_week_request(uuid, text, integer)',
    'public.hours_revoke_week_request(uuid, text)',
    'public.hours_mail_overview()',
    'public.hours_mail_set_folder(uuid, text, text, boolean)',
    'public.hours_mail_dismiss_message(uuid, text)',
    'public.hours_mail_assign_message(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.hours_mail_due_folders(integer)',
    'public.hours_mail_record_messages(uuid, jsonb, text[])',
    'public.hours_mail_set_cursor(uuid, text, boolean, text)',
    'public.hours_mail_clear_cursor(uuid)',
    'public.hours_mail_claim_messages(uuid, integer, integer)',
    'public.hours_mail_renew_lease(uuid, uuid, integer)',
    'public.hours_mail_match_message(uuid, uuid, text[], text[], text)',
    'public.hours_mail_file_message(uuid, uuid, jsonb, jsonb, jsonb)',
    'public.hours_mail_fail_message(uuid, uuid, text, text, text)',
    'public.hours_mail_release_message(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

comment on table public.hours_week_requests is 'One outgoing hours request, scoped to exactly one client week, with the short code that travels in the subject line. Deliberately not a secret: it says which week a reply belongs to, it gives no access and it makes no hours. T8 fills in the sent message id, conversation and recipients.';
comment on table public.hours_mail_folders is 'One followed mail folder with its durable delta cursor. The cursor only moves when a whole pass finished, so an interrupted run resumes instead of skipping.';
comment on table public.hours_mail_messages is 'Every message the intake observed: the queue, the deduplication key and the control bin in one place. Keyed on the RFC Message-ID, which survives a move between folders where Graph''s own id does not.';

notify pgrst, 'reload schema';

commit;
