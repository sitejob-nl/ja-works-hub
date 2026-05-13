-- Carerix document-byte validation view.
-- Kept separate from the broader next-phase migration so production can get
-- the Carerix acceptance dependency without unrelated schema changes.

CREATE OR REPLACE VIEW public.v_carerix_document_validation
WITH (security_invoker = true)
AS
SELECT
  d.id AS document_id,
  d.organization_id,
  d.candidate_id,
  c.first_name,
  c.last_name,
  d.name,
  d.type,
  d.status,
  d.file_path,
  d.notes,
  d.created_at,
  em.external_id AS carerix_id,
  (
    d.name ILIKE '%cv%'
    OR d.name ILIKE '%curriculum%'
    OR d.name ILIKE '%resume%'
  ) AS is_cv,
  CASE
    WHEN d.file_path IS NOT NULL THEN 'downloaded'
    WHEN d.notes LIKE '%[carerix-bytes-failed:%' THEN 'failed'
    ELSE 'pending'
  END AS download_status,
  CASE
    WHEN d.notes LIKE '%[carerix-bytes-failed:%'
      THEN substring(d.notes FROM '\[carerix-bytes-failed:([^\]]+)\]')
    ELSE NULL
  END AS failure_reason
FROM public.documents d
JOIN public.candidates c ON c.id = d.candidate_id
LEFT JOIN public.external_mappings em
  ON em.entity_id = d.id
  AND em.entity_type = 'document'
  AND em.external_system = 'carerix'
  AND em.organization_id = d.organization_id
WHERE d.source = 'carerix';
