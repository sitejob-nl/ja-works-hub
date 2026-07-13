-- Cover the audit actor foreign key reported by the Supabase performance advisor.

CREATE INDEX IF NOT EXISTS user_permission_overrides_updated_by_idx
  ON public.user_permission_overrides (updated_by);
