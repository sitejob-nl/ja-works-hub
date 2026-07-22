-- enforce_candidate_portal_update() is een triggerfunctie en hoort niet als RPC bereikbaar te
-- zijn. Rechtstreeks aanroepen zou sowieso falen (geen triggercontext), maar de advisor meldt
-- 'm terecht als SECURITY DEFINER-functie die via /rest/v1/rpc open staat.
revoke all on function public.enforce_candidate_portal_update() from public;
revoke all on function public.enforce_candidate_portal_update() from anon;
revoke all on function public.enforce_candidate_portal_update() from authenticated;
