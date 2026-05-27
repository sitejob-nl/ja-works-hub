CREATE TABLE IF NOT EXISTS public.organization_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain text NOT NULL,
  apex_domain text NOT NULL,
  domain_type text NOT NULL CHECK (domain_type IN ('exact', 'wildcard')),
  primary_hostname text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'misconfigured', 'error', 'removed')),
  vercel_project_domain jsonb NOT NULL DEFAULT '{}'::jsonb,
  dns_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  verified_at timestamptz,
  removed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_domains_domain_lowercase CHECK (domain = lower(domain)),
  CONSTRAINT organization_domains_primary_hostname_lowercase CHECK (primary_hostname = lower(primary_hostname)),
  CONSTRAINT organization_domains_wildcard_shape CHECK (
    (domain_type = 'wildcard' AND domain LIKE '*.%') OR
    (domain_type = 'exact' AND domain NOT LIKE '*.%')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_domain_unique
  ON public.organization_domains (domain)
  WHERE removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_single_primary
  ON public.organization_domains (organization_id)
  WHERE is_primary = true AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS organization_domains_org_idx
  ON public.organization_domains (organization_id, status, is_primary);

CREATE INDEX IF NOT EXISTS organization_domains_domain_idx
  ON public.organization_domains (domain);

CREATE INDEX IF NOT EXISTS organization_domains_wildcard_suffix_idx
  ON public.organization_domains (apex_domain)
  WHERE domain_type = 'wildcard' AND removed_at IS NULL;

ALTER TABLE public.organization_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_domains_tenant_select ON public.organization_domains;
CREATE POLICY organization_domains_tenant_select
ON public.organization_domains
FOR SELECT
TO authenticated
USING (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS organization_domains_admin_insert ON public.organization_domains;
CREATE POLICY organization_domains_admin_insert
ON public.organization_domains
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND public.get_user_role() = 'admin'
);

DROP POLICY IF EXISTS organization_domains_admin_update ON public.organization_domains;
CREATE POLICY organization_domains_admin_update
ON public.organization_domains
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.get_user_role() = 'admin'
)
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND public.get_user_role() = 'admin'
);

DROP POLICY IF EXISTS organization_domains_admin_delete ON public.organization_domains;
CREATE POLICY organization_domains_admin_delete
ON public.organization_domains
FOR DELETE
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.get_user_role() = 'admin'
);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_domains_updated_at ON public.organization_domains;
CREATE TRIGGER trg_organization_domains_updated_at
BEFORE UPDATE ON public.organization_domains
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.normalize_domain_host(p_host text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(regexp_replace(trim(coalesce(p_host, '')), '^https?://', ''), '/.*$', ''));
$$;

CREATE OR REPLACE FUNCTION public.resolve_organization_domain(p_host text)
RETURNS TABLE (
  organization_id uuid,
  domain text,
  domain_type text,
  primary_hostname text,
  is_primary boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT public.normalize_domain_host(p_host) AS host
  )
  SELECT
    od.organization_id,
    od.domain,
    od.domain_type,
    od.primary_hostname,
    od.is_primary
  FROM public.organization_domains od
  CROSS JOIN normalized n
  WHERE od.status = 'verified'
    AND od.removed_at IS NULL
    AND (
      od.domain = n.host
      OR (
        od.domain_type = 'wildcard'
        AND n.host <> od.apex_domain
        AND n.host LIKE ('%.' || od.apex_domain)
      )
    )
  ORDER BY
    CASE WHEN od.domain = n.host THEN 0 ELSE 1 END,
    od.is_primary DESC,
    length(od.apex_domain) DESC,
    od.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_organization_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_organization_domain(text) TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_domains TO authenticated;
