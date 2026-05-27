UPDATE public.company_contacts
SET role = 'administratie'
WHERE role = 'admin';

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS placement_id uuid REFERENCES public.placements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_communications_placement_id
  ON public.communications(placement_id)
  WHERE placement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_communications_org_placement_sent
  ON public.communications(organization_id, placement_id, sent_at DESC)
  WHERE placement_id IS NOT NULL;
