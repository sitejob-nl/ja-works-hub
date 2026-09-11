-- The fourth net under the coupling, actually connected.
--
-- The contract names four ways a reply is tied to a client week: a hand, the
-- reference code, the reply chain, and Graph's own conversation. The fourth one
-- was matched against `hours_week_requests.conversation_id` but the *message*
-- never carried its thread anywhere: the recording dropped it and the claim did
-- not hand it back, so the intake could never pass one in. A documented
-- mechanism that cannot fire is worse than one that does not exist.
--
-- The thread is part of what a message *is*, so it joins the tuple the guard
-- refuses to let move.
begin;

alter table public.hours_mail_messages add column if not exists conversation_id text;
alter table public.hours_mail_messages drop constraint if exists hours_mail_messages_conversation_check;
alter table public.hours_mail_messages add constraint hours_mail_messages_conversation_check
  check (conversation_id is null or length(conversation_id) between 1 and 512);
create index if not exists hours_mail_messages_conversation_idx
  on public.hours_mail_messages(organization_id, conversation_id)
  where conversation_id is not null;

create or replace function private.hours_mail_message_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Ontvangen berichten zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.folder_row_id, new.mail_account_id, new.message_key,
      new.internet_message_id, new.subject, new.from_address, new.from_name, new.received_at,
      new.conversation_id, new.first_seen_at)
     is distinct from
     (old.id, old.organization_id, old.folder_row_id, old.mail_account_id, old.message_key,
      old.internet_message_id, old.subject, old.from_address, old.from_name, old.received_at,
      old.conversation_id, old.first_seen_at) then
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

create or replace function public.hours_mail_record_messages(p_folder_row_id uuid,
  p_messages jsonb, p_removed text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_folder public.hours_mail_folders%rowtype; v_entry jsonb; v_key text; v_graph text;
  v_added integer := 0; v_seen integer := 0; v_gone integer := 0; v_back integer := 0;
  v_id uuid; v_revived integer;
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
      received_at, conversation_id, has_attachments)
      values (v_folder.organization_id, v_folder.id, v_folder.mail_account_id, v_key, v_graph,
        left(nullif(btrim(coalesce(v_entry->>'internet_message_id', '')), ''), 512),
        left(nullif(btrim(coalesce(v_entry->>'subject', '')), ''), 1000),
        lower(left(nullif(btrim(coalesce(v_entry->>'from_address', '')), ''), 320)),
        left(nullif(btrim(coalesce(v_entry->>'from_name', '')), ''), 320),
        nullif(v_entry->>'received_at', '')::timestamptz,
        left(nullif(btrim(coalesce(v_entry->>'conversation_id', '')), ''), 512),
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
      -- Gone and back is the same message, and nothing was written for it. Only
      -- the mailbox's own 'gone' is revived: a person's decision stands, and a
      -- filed message stays filed.
      update public.hours_mail_messages
        set status = 'pending', reason_code = null, reason_note = null,
            resolved_at = null, resolved_by = null, attempt_count = 0, renewal_count = 0
        where organization_id = v_folder.organization_id
          and mail_account_id = v_folder.mail_account_id and message_key = v_key
          and status = 'dismissed' and reason_code = 'verdwenen';
      get diagnostics v_revived = row_count;
      v_back := v_back + v_revived;
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
  return jsonb_build_object('ok', true, 'added', v_added, 'seen_again', v_seen,
    'removed', v_gone, 'returned', v_back);
end $$;

-- The claim hands the thread back, because the caller has no other way to know it.
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
        m.received_at, m.conversation_id, m.has_attachments, m.assigned_week_id, m.organization_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'graph_message_id', graph_message_id,
    'message_key', message_key, 'subject', subject, 'from_address', from_address,
    'received_at', received_at, 'conversation_id', conversation_id,
    'has_attachments', has_attachments,
    'assigned_week_id', assigned_week_id, 'organization_id', organization_id)), '[]'::jsonb)
    into v_rows from claimed;
  return jsonb_build_object('ok', true, 'claim_token', v_token, 'messages', v_rows);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.hours_mail_record_messages(uuid, jsonb, text[])',
    'public.hours_mail_claim_messages(uuid, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
