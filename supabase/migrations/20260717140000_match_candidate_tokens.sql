-- Kandidaat-voorstelmail (A2): tokens voor de publieke interesse-links in de mail
-- naar de MEDEWERKER. Spiegelt match_proposal_tokens (opdrachtgever-variant), maar
-- bewust een APARTE tabel: een kandidaat-token mag nooit de klant-reactiepagina
-- (/match/reageer) openen — gescheiden audiences, gescheiden tokens.
--
-- RLS aan + geen policies = deny-all (bewust): validatie loopt uitsluitend via de
-- service-role in de edge functions send-candidate-proposal / candidate-interest,
-- zoals match_response_attempts. Advisor-INFO rls_enabled_no_policy is verwacht.

create extension if not exists pgcrypto;

create table if not exists public.match_candidate_tokens (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_email text,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + '14 days'::interval),
  used_at timestamptz,
  response text,
  created_at timestamptz default now()
);

create index if not exists idx_match_candidate_tokens_match_id
  on public.match_candidate_tokens (match_id);
create index if not exists idx_match_candidate_tokens_org
  on public.match_candidate_tokens (organization_id);

alter table public.match_candidate_tokens enable row level security;

comment on table public.match_candidate_tokens is
  'Single-use tokens voor de publieke kandidaat-interesse-links (/baan/interesse/:token) uit de kandidaat-voorstelmail. Service-role-only (deny-all RLS, bewust).';
