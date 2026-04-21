-- Default scopes use :read / :manage suffix, not /fields/@all entries
-- (that's the Permissie matrix format, not the OAuth2 scope format).

ALTER TABLE public.carerix_config
  ALTER COLUMN scope SET DEFAULT 'urn:cx/core:data/companies:read urn:cx/core:data/contacts:read urn:cx/core:data/candidates:read urn:cx/activities:data/notes:read urn:cx/activities:data/tasks:read urn:cx/core:data/placements:read urn:cx/core:data/vacancies:read urn:cx/core:data/matches:read';

-- Upgrade any existing row using the older placeholder or the wrong matrix-style value.
UPDATE public.carerix_config
  SET scope = 'urn:cx/core:data/companies:read urn:cx/core:data/contacts:read urn:cx/core:data/candidates:read urn:cx/activities:data/notes:read urn:cx/activities:data/tasks:read urn:cx/core:data/placements:read urn:cx/core:data/vacancies:read urn:cx/core:data/matches:read'
  WHERE scope LIKE '%/fields/@all%' OR scope = 'urn:cx/cx5Wrapper:data:manage';
