-- Replace the placeholder cx5Wrapper scope with the real Carerix IAM scope set.
-- @all variants unlock full field visibility; without them only basic fields come back.

ALTER TABLE public.carerix_config
  ALTER COLUMN scope SET DEFAULT 'urn:cx/core:data/companies urn:cx/core:data/companies/fields/@all urn:cx/core:data/contacts urn:cx/core:data/contacts/fields/@all urn:cx/core:data/candidates urn:cx/core:data/candidates/fields/@all urn:cx/activities:data/notes urn:cx/activities:data/tasks';

-- Bump any existing row that still holds the bogus placeholder.
UPDATE public.carerix_config
  SET scope = 'urn:cx/core:data/companies urn:cx/core:data/companies/fields/@all urn:cx/core:data/contacts urn:cx/core:data/contacts/fields/@all urn:cx/core:data/candidates urn:cx/core:data/candidates/fields/@all urn:cx/activities:data/notes urn:cx/activities:data/tasks'
  WHERE scope = 'urn:cx/cx5Wrapper:data:manage';
