-- Internal feedback is persisted before attachments or email. Client writes go
-- through the authenticated edge function; no browser can set delivery status.
create table if not exists public.feedback_reports (
  id uuid primary key,
  number bigint generated always as identity unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  reporter_name text not null,
  reporter_email text not null,
  kind text not null check (kind in ('bug', 'idea')),
  title text not null check (char_length(title) between 3 and 160),
  description text not null check (char_length(description) between 3 and 5000),
  steps text not null default '' check (char_length(steps) <= 3000),
  expected text not null default '' check (char_length(expected) <= 2000),
  diagnostics jsonb not null default '{}'::jsonb check (octet_length(diagnostics::text) <= 100000),
  request_hash text not null,
  has_screenshot boolean not null default false,
  screenshot_path text,
  email_status text not null default 'pending' check (email_status in ('pending','preparing','sending','sent','paused','failed','unknown')),
  email_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (organization_id, id)
);
create index if not exists feedback_reports_org_created_idx on public.feedback_reports(organization_id, created_at desc);
create index if not exists feedback_reports_user_created_idx on public.feedback_reports(submitted_by, created_at desc);
alter table public.feedback_reports enable row level security;
revoke all on public.feedback_reports from anon, authenticated;
grant select on public.feedback_reports to authenticated;
grant all on public.feedback_reports to service_role;
grant usage, select on sequence public.feedback_reports_number_seq to service_role;
drop policy if exists feedback_reports_read on public.feedback_reports;
create policy feedback_reports_read on public.feedback_reports for select to authenticated using (
  (select public.is_superadmin()) or
  (organization_id = (select public.get_user_org_id()) and submitted_by = (select auth.uid()) and (select public.is_internal_user()))
);

-- The service-only RPC serializes the per-user throttle and idempotent insert.
create or replace function public.create_feedback_report(p_report jsonb)
returns setof public.feedback_reports language plpgsql security invoker set search_path = public, pg_temp as $$
declare existing public.feedback_reports; actor uuid := (p_report->>'submitted_by')::uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || actor::text, 0));
  select * into existing from public.feedback_reports where id = (p_report->>'id')::uuid;
  if found then
    if existing.submitted_by is distinct from actor or existing.organization_id is distinct from (p_report->>'organization_id')::uuid
      or existing.request_hash is distinct from p_report->>'request_hash' then
      raise exception 'feedback_conflict' using errcode = '22023';
    end if;
    return next existing;
    return;
  end if;
  if (select count(*) from public.feedback_reports where submitted_by = actor and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'feedback_rate_limited' using errcode = 'P0001';
  end if;
  return query insert into public.feedback_reports (
    id, organization_id, submitted_by, reporter_name, reporter_email, kind, title, description, steps, expected,
    diagnostics, request_hash, has_screenshot
  ) values (
    (p_report->>'id')::uuid, (p_report->>'organization_id')::uuid, actor,
    p_report->>'reporter_name', p_report->>'reporter_email', p_report->>'kind', p_report->>'title',
    p_report->>'description', p_report->>'steps', p_report->>'expected', p_report->'diagnostics',
    p_report->>'request_hash', (p_report->>'has_screenshot')::boolean
  ) returning *;
end $$;
revoke all on function public.create_feedback_report(jsonb) from public, anon, authenticated;
grant execute on function public.create_feedback_report(jsonb) to service_role;

-- Preserve the existing concept-mail invariant without inventing a candidate or
-- company for a support message. The composite FK prevents cross-tenant links.
alter table public.communications add column if not exists feedback_report_id uuid;
alter table public.communications drop constraint if exists communications_feedback_report_fk;
alter table public.communications add constraint communications_feedback_report_fk
  foreign key (organization_id, feedback_report_id) references public.feedback_reports(organization_id, id) on delete cascade;
create unique index if not exists communications_feedback_report_idx on public.communications(feedback_report_id) where feedback_report_id is not null;
alter table public.communications drop constraint if exists chk_comm_target;
alter table public.communications add constraint chk_comm_target check (
  candidate_id is not null or company_id is not null or (feedback_report_id is not null and channel = 'email' and direction = 'outbound')
);

-- No public URL, nor direct browser reads/writes: the edge function checks the
-- caller before issuing a five-minute signed URL to a SiteJob superadmin.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 2097152, array['image/png'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
