-- Backfill legacy import-batches in fuel_card_imports zodat ze via de UI
-- te beheren (verwijderen) zijn. file_hash is dummy-string per batch.
-- import_batch_id is text in fuel_card_transactions; cast naar uuid voor PK.

INSERT INTO public.fuel_card_imports (
  id,
  organization_id,
  file_hash,
  file_name,
  transaction_count,
  total_liters,
  total_amount_eur,
  period_start,
  period_end,
  created_at
)
SELECT
  import_batch_id::uuid,
  organization_id,
  'legacy-' || import_batch_id,
  '(eerdere import)',
  count(*)::int,
  COALESCE(sum(liters), 0)::numeric(10, 2),
  COALESCE(sum(amount_eur), 0)::numeric(12, 2),
  min(transaction_date),
  max(transaction_date),
  min(created_at)
FROM public.fuel_card_transactions
WHERE import_batch_id IS NOT NULL
GROUP BY import_batch_id, organization_id
ON CONFLICT DO NOTHING;
