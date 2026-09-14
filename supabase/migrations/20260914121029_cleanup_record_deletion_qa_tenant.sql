-- One-off cleanup of this release's empty synthetic isolation tenant.
-- Its automatically seeded default folder prevents normal tenant deletion.
-- Future isolation QA uses ROLLBACK instead. No application policy is changed.
DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations
  WHERE name = 'QA-cleanup-roles-0e63bbea' AND slug = 'qa-cleanup-roles-0e63bbea';
  IF v_org IS NULL THEN RETURN; END IF;
  ASSERT NOT EXISTS(SELECT 1 FROM public.profiles WHERE organization_id = v_org);
  ASSERT NOT EXISTS(SELECT 1 FROM public.companies WHERE organization_id = v_org);
  ASSERT NOT EXISTS(SELECT 1 FROM public.candidates WHERE organization_id = v_org);
  ASSERT NOT EXISTS(SELECT 1 FROM public.documents WHERE organization_id = v_org);
  -- The table lock and trigger change last only for this atomic statement.
  ALTER TABLE public.company_document_folders DISABLE TRIGGER company_document_folders_protect_default;
  DELETE FROM public.organizations WHERE id = v_org;
  ALTER TABLE public.company_document_folders ENABLE TRIGGER company_document_folders_protect_default;
END $$;
