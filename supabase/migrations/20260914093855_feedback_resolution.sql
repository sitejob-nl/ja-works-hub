-- A resolution is also the personal in-app notification. Keeping both on the
-- same owner-scoped row makes notification creation atomic with resolving.
alter table public.feedback_reports
  add column if not exists status text not null default 'open',
  add column if not exists resolution text not null default '',
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolution_revision integer not null default 0,
  add column if not exists resolution_read_at timestamptz,
  add column if not exists resolution_dismissed_at timestamptz;
alter table public.feedback_reports drop constraint if exists feedback_resolution_state_check;
alter table public.feedback_reports add constraint feedback_resolution_state_check check (
  status in ('open', 'resolved') and char_length(resolution) <= 2000 and resolution_revision >= 0
  and ((status = 'open' and resolved_at is null) or (status = 'resolved' and resolved_at is not null))
);
create index if not exists feedback_reports_resolved_by_idx on public.feedback_reports(resolved_by);
create index if not exists feedback_reports_notifications_idx on public.feedback_reports(submitted_by, resolved_at desc)
  where status = 'resolved' and resolution_dismissed_at is null;
-- Existing RLS remains: only the active internal owner or a superadmin can read.
-- All writes still go through the authenticated edge function. No org-wide
-- employee_notifications row is created, so private feedback stays private.
