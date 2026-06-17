-- Hardening voor de live rerank-cache: AI-redeneringen zijn interne data en
-- mogen niet via algemene tenant-select door portalgebruikers leesbaar zijn.
drop policy if exists rerank_cache_select_own_org on public.match_rerank_cache;
drop policy if exists rerank_cache_select_internal_org on public.match_rerank_cache;

create policy rerank_cache_select_internal_org on public.match_rerank_cache
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());
