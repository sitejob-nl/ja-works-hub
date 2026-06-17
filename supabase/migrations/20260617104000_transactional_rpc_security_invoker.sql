-- De transactionele RPC's hebben geen elevated privileges nodig: de bestaande
-- RLS-policies laten interne gebruikers dezelfde writes al uitvoeren. SECURITY
-- INVOKER houdt de transactie atomair zonder extra privilege-oppervlak.
alter function public.create_placement_transaction(
  uuid, uuid, uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, uuid, boolean, boolean, text
) security invoker;

alter function public.create_invoice_transaction(
  uuid, uuid, date, date, text, numeric, numeric, numeric, numeric, date, jsonb
) security invoker;
