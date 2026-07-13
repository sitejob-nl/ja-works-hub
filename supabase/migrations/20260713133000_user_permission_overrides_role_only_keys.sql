-- Keep these two permissions role-only until all production call paths can
-- enforce individual overrides before sending private data externally.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'user_permission_overrides_individual_key_check'
       AND conrelid = 'public.user_permission_overrides'::regclass
  ) THEN
    ALTER TABLE public.user_permission_overrides
      ADD CONSTRAINT user_permission_overrides_individual_key_check
      CHECK (permission_key NOT IN ('candidates.edit', 'finance.manage'));
  END IF;
END;
$$;
