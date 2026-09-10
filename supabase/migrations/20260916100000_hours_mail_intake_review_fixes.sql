-- Findings of the first review round on the mail intake.
--
--  1. Following a folder asked only whether the mailbox belonged to the tenant.
--     The access table is leading for mailbox access — a finance role is not a
--     mailbox key — so a `finance.manage` user could point the intake at any
--     connected mailbox, a colleague's personal one included.
--  2. The listing of due folders was ordered by creation and bounded, so a run
--     that could take ten folders would take the same ten forever and starve
--     everything after them. It also had no way to ask for one tenant, which a
--     manual run needs: filtering a globally ordered page hides a folder that
--     happens to sit past the bound.
--  3. A mailed proposal could not carry what the control was unsure of. Every
--     other reading route blocks applying until such a doubt is confirmed; on
--     this one the same contradiction would have written an unclassifiable day
--     revision.
begin;

-- Only a company mailbox, and only one this person may actually read. A
-- personal mailbox is somebody's own mail and never the office's intake, even
-- for its owner: what the intake reads becomes administration of the whole team.
create or replace function public.hours_mail_set_folder(p_mail_account_id uuid, p_folder_id text,
  p_folder_label text, p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_account record; v_id uuid; begin
  p_folder_id := nullif(private.hours_source_trim(p_folder_id), '');
  p_folder_label := nullif(private.hours_source_trim(p_folder_label), '');
  if p_folder_id is null or length(p_folder_id) > 512 or p_folder_id ~ '[[:cntrl:]]'
     or p_folder_label is null or length(p_folder_label) > 200 or p_enabled is null then
    raise exception 'Ongeldige map' using errcode = '22023';
  end if;
  select a.id, a.scope into v_account from public.mail_accounts a
    where a.id = p_mail_account_id and a.organization_id = v_org and a.provider = 'outlook'
      and a.deleted_at is null and a.mail_read_enabled is true;
  if not found then
    raise exception 'Deze mailbox bestaat niet of mag niet gelezen worden' using errcode = '22023';
  end if;
  if v_account.scope is distinct from 'organization' then
    raise exception 'Een persoonlijke mailbox wordt niet gevolgd' using errcode = '22023';
  end if;
  -- mail_account_user_access is leading. Without this, following a folder was a
  -- way around the mailbox rights the office set on purpose.
  if not exists (select 1 from public.mail_account_user_access g
      where g.mail_account_id = p_mail_account_id and g.organization_id = v_org
        and g.user_id = auth.uid() and g.can_read_mail is true) then
    raise exception 'U heeft geen leesrecht op deze mailbox' using errcode = '42501';
  end if;
  insert into public.hours_mail_folders(organization_id, mail_account_id, folder_id, folder_label,
    enabled, created_by)
    values (v_org, p_mail_account_id, p_folder_id, p_folder_label, p_enabled, auth.uid())
  on conflict (organization_id, mail_account_id, folder_id)
    do update set folder_label = excluded.folder_label, enabled = excluded.enabled
    returning id into v_id;
  return private.hours_mail_overview_projection(v_org) || jsonb_build_object('folder_row_id', v_id);
end $$;

-- Which folders to poll: the ones that waited longest, optionally of one tenant.
-- A run takes a handful, so the order decides what is *never* reached; oldest
-- first by creation meant a new folder behind ten busy ones never got a turn.
drop function if exists public.hours_mail_due_folders(integer);
create or replace function public.hours_mail_due_folders(p_limit integer default 25,
  p_organization_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de innamefunctie mag dit doen' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Ongeldig aantal' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(row order by ordinal) from (
    select jsonb_build_object('id', f.id, 'organization_id', f.organization_id,
      'mail_account_id', f.mail_account_id, 'folder_id', f.folder_id,
      'folder_label', f.folder_label, 'delta_link', f.delta_link,
      'created_at', f.created_at) as row,
      row_number() over (order by f.last_run_at asc nulls first, f.created_at, f.id) as ordinal
    from public.hours_mail_folders f
    join public.organization_modules m on m.organization_id = f.organization_id
      and m.module_name = 'uren-workflow' and m.enabled is true
    join public.mail_accounts a on a.id = f.mail_account_id
    where f.enabled and a.deleted_at is null and a.mail_read_enabled is true
      and (p_organization_id is null or f.organization_id = p_organization_id)
    order by f.last_run_at asc nulls first, f.created_at, f.id limit p_limit) as rows), '[]'::jsonb);
end $$;

-- A doubt the control found travels with the proposal, exactly as it does on the
-- workbook and scan routes. The canonical form and the allowed labels are the
-- released helper's, so one route can never accept a label another one refuses.
create or replace function public.hours_mail_file_message(p_message_id uuid, p_claim_token uuid,
  p_source jsonb, p_attachments jsonb default '[]'::jsonb, p_proposals jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.hours_mail_messages%rowtype; v_week public.hours_weeks%rowtype;
  v_source_id uuid; v_entry jsonb; v_day public.hours_days%rowtype; v_ids uuid[];
  v_minutes integer; v_reason text; v_note text; v_label text; v_input jsonb; v_page integer;
  v_doubt text[]; v_attachments integer := 0; v_proposals integer := 0; v_child uuid;
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
      -- Letter for letter the released check of hours_create_source_proposals.
      -- An unknown label is refused rather than silently dropped: dropping it
      -- would turn the reader's own doubt into apparent certainty. Two variants
      -- of this rule would be two lists that can drift apart.
      v_doubt := null;
      if v_entry ? 'uncertain_fields' and jsonb_typeof(v_entry->'uncertain_fields') = 'array'
         and jsonb_array_length(v_entry->'uncertain_fields') > 0 then
        if jsonb_array_length(v_entry->'uncertain_fields') > 5 then
          raise exception 'Onbekende onzekerheid in deze uitlezing' using errcode = '22023';
        end if;
        select array_agg(value) into v_doubt
          from jsonb_array_elements_text(v_entry->'uncertain_fields') as value;
        if v_doubt is null or exists (select 1 from unnest(v_doubt) as f where f is null)
           or (select count(distinct f) from unnest(v_doubt) as f)
              <> cardinality(private.hours_canonical_uncertain_fields(v_doubt)) then
          raise exception 'Onbekende onzekerheid in deze uitlezing' using errcode = '22023';
        end if;
        v_doubt := nullif(private.hours_canonical_uncertain_fields(v_doubt), array[]::text[]);
      elsif v_entry ? 'uncertain_fields' and jsonb_typeof(v_entry->'uncertain_fields')
            not in ('null', 'array') then
        raise exception 'Onbekende onzekerheid in deze uitlezing' using errcode = '22023';
      end if;
      insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
        no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain,
        uncertain_fields, mail_message_id)
        values (v_row.organization_id, v_week.id, v_source_id, v_day.id, v_minutes, v_reason, v_note,
          v_input, v_label, coalesce(v_page, 1),
          coalesce((v_entry->>'assignment_uncertain')::boolean, false)
            or private.hours_page_contradicts(v_source_id, coalesce(v_page, 1), v_day.member_id),
          v_doubt, p_message_id);
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

do $$ declare f text; begin
  foreach f in array array['public.hours_mail_set_folder(uuid, text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.hours_mail_due_folders(integer, uuid)',
    'public.hours_mail_file_message(uuid, uuid, jsonb, jsonb, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
