-- Cover the complete organization/report foreign key while keeping one log per report.
drop index if exists public.communications_feedback_report_idx;
create unique index communications_feedback_report_idx on public.communications(organization_id, feedback_report_id);
