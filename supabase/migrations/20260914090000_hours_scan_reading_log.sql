-- A record of every paid reading, and one reading per source at a time.
--
-- Two things were missing. First, nothing anywhere said which document had been
-- sent to the provider: the AI ledger records organization, user, feature and
-- cost, but not the source, so "which of our employees' data went out, and
-- when" could not be answered — which the accountability duty needs and a
-- processor incident cannot be scoped without. Second, the only thing between
-- two clicks and two charges was browser state, which is always one render
-- behind.
--
-- This log answers both. It is append-only like every other hours fact, it
-- holds no content from the document, and it is written only by the edge
-- function that makes the call.
begin;

create table if not exists public.hours_source_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  source_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  ai_request_id uuid,
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  line_count integer check (line_count is null or line_count between 0 and 2000),
  error_code text check (length(error_code) <= 100),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  foreign key (source_id, week_id, organization_id)
    references public.hours_week_sources(id, week_id, organization_id),
  check ((status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null))
);

create index if not exists hours_source_readings_source_idx
  on public.hours_source_readings(source_id, organization_id);
create index if not exists hours_source_readings_org_idx on public.hours_source_readings(organization_id);
create index if not exists hours_source_readings_actor_idx on public.hours_source_readings(actor_id);
create index if not exists hours_source_readings_week_idx on public.hours_source_readings(week_id, organization_id);
-- One open claim per source is the single-flight; the partial unique index makes
-- it a database fact rather than a habit of the writer.
create unique index if not exists hours_source_readings_one_open_idx
  on public.hours_source_readings(source_id) where status = 'running';

-- Same posture as the other seventeen hours tables: the backend owns every
-- write, internal reads need finance rights, and the SaaS switch gates them.
alter table public.hours_source_readings enable row level security;
revoke all on public.hours_source_readings from public, anon, authenticated, service_role;
grant select on public.hours_source_readings to authenticated;
drop policy if exists hours_internal_read on public.hours_source_readings;
create policy hours_internal_read on public.hours_source_readings for select to authenticated
using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())
  and ((select public.has_role_permission('finance.view')) or (select public.has_role_permission('finance.manage'))));
drop policy if exists hours_workflow_module_required on public.hours_source_readings;
create policy hours_workflow_module_required on public.hours_source_readings as restrictive for select
  to authenticated using ((select private.hours_module_enabled()));
drop trigger if exists hours_history_immutable on public.hours_source_readings;

-- A reading resolves exactly once; everything about the attempt stays put.
create or replace function private.hours_reading_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Uitleeslogregels zijn onveranderlijk' using errcode = '42501';
  end if;
  if old.status <> 'running' or new.status not in ('succeeded', 'failed')
     or (new.id, new.organization_id, new.week_id, new.source_id, new.actor_id, new.started_at)
        is distinct from (old.id, old.organization_id, old.week_id, old.source_id, old.actor_id, old.started_at) then
    raise exception 'Uitleeslogregels zijn onveranderlijk' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_reading_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_reading_guard on public.hours_source_readings;
create trigger hours_reading_guard before update or delete on public.hours_source_readings
  for each row execute function private.hours_reading_guard();

-- Claiming happens before the provider is called. The edge function holds the
-- service role and passes the internal user it already verified; the actor has
-- to belong to the source's organization, so a stray id cannot be logged.
create or replace function public.hours_claim_source_reading(p_source_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_source public.hours_week_sources%rowtype; v_id uuid; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de uitleesfunctie mag dit doen' using errcode = '42501';
  end if;
  select * into v_source from public.hours_week_sources where id = p_source_id;
  if not found then raise exception 'Bron niet beschikbaar' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p
                 where p.id = p_actor_id and p.organization_id = v_source.organization_id
                   and p.is_active is true) then
    raise exception 'Onbekende aanvrager voor deze bron' using errcode = '42501';
  end if;
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

-- Finishing records what the attempt cost and how much came out of it. Never
-- the content: this log is about the transfer, not about the hours.
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

do $$ declare f text; begin
  foreach f in array array['public.hours_claim_source_reading(uuid, uuid)',
    'public.hours_finish_source_reading(uuid, text, text, integer, integer, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

comment on table public.hours_source_readings is 'One row per paid reading of a delivered source: which document, which week, who asked, what it cost. Holds no content from the document. Append-only; one open claim per source is the single-flight that keeps a second click from becoming a second charge.';

notify pgrst, 'reload schema';

commit;
