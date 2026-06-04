-- SEC: merge_candidate_records is SECURITY DEFINER zonder auth.uid()-guard en voert
-- destructieve merges/deletes uit op de meegegeven candidate-UUID's. Het mag NOOIT
-- anoniem aanroepbaar zijn (UUID's lekken via publieke token-flows). De dedup-migratie
-- 20260604120000 revokete anon alleen op find_duplicate_candidates, niet op deze write-RPC.
revoke execute on function public.merge_candidate_records(uuid, uuid, uuid) from anon, public;
grant execute on function public.merge_candidate_records(uuid, uuid, uuid) to authenticated, service_role;
