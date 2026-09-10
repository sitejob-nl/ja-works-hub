-- A message that comes back is picked up again.
--
-- The mailbox reporting a message as gone closes it with `verdwenen`, and
-- nothing was written for it: no source, no proposal, no hours. If somebody then
-- puts that same message back in the followed folder, Graph reports it as added
-- again — and the row was already there, so the recording quietly did nothing
-- but update the Graph id. The message was then never worked on again.
--
-- Only the mailbox's own "gone" is revived. A decision of a person stands: a
-- message somebody took off the control bin stays off it, and a filed message
-- stays filed, because that delivery really happened.
begin;

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

do $$ begin
  execute 'revoke all on function public.hours_mail_record_messages(uuid, jsonb, text[]) '
    || 'from public, anon, authenticated, service_role';
  execute 'grant execute on function public.hours_mail_record_messages(uuid, jsonb, text[]) '
    || 'to service_role';
end $$;

notify pgrst, 'reload schema';

commit;
