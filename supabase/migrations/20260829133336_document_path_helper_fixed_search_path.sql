-- Advisor 0011: `document_path_matches_candidate` had geen vaste search_path. De
-- functie raakt geen tabellen, dus er valt weinig te kapen, maar een vaste
-- search_path hoort bij elke functie hier en houdt het advisor-rapport schoon.
create or replace function public.document_path_matches_candidate(
  p_path text,
  p_org uuid,
  p_candidate uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_path is not null
     and p_org is not null
     and p_candidate is not null
     and (
       p_path like p_org::text || '/' || p_candidate::text || '/%'
       or p_path like p_org::text || '/candidates/' || p_candidate::text || '/%'
       or p_path like p_org::text || '/candidate-signups/' || p_candidate::text || '/%'
     );
$fn$;
