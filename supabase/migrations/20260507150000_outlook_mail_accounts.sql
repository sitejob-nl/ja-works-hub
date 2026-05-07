-- ============================================================================
-- Outlook mailbox/account layer (additive rollout)
--
-- Adds a BestOps-style account layer for organization credentials, shared
-- mailboxes/calendars, and personal Outlook accounts. The legacy
-- microsoft_config table/RPCs remain intact for one deploy rollback window.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'outlook' CHECK (provider = 'outlook'),
  scope text NOT NULL CHECK (scope IN ('organization', 'personal')),
  owner_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  auth_account_id uuid NULL,
  display_name text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  reply_to_email text NULL,
  mailbox_mode text NOT NULL DEFAULT 'user' CHECK (mailbox_mode IN ('user', 'shared')),
  mailbox_email text NULL,
  mailbox_name text NULL,
  calendar_path_kind text NOT NULL DEFAULT 'mailbox_primary' CHECK (calendar_path_kind IN ('mailbox_primary', 'graph_calendar_id')),
  calendar_owner_email text NULL,
  calendar_id text NULL,
  mail_read_enabled boolean NOT NULL DEFAULT false,
  mail_send_enabled boolean NOT NULL DEFAULT false,
  mail_delete_enabled boolean NOT NULL DEFAULT false,
  calendar_read_enabled boolean NOT NULL DEFAULT false,
  calendar_write_enabled boolean NOT NULL DEFAULT false,
  is_default_for_organization boolean NOT NULL DEFAULT false,
  is_default_for_user boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'connected', 'needs_test', 'needs_reconnect', 'failed', 'disabled', 'disconnected')),
  last_error text NULL,
  last_connected_at timestamptz NULL,
  refreshing_at timestamptz NULL,
  legacy_microsoft_config_id uuid NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (organization_id, id)
);

ALTER TABLE public.mail_accounts
  ADD CONSTRAINT mail_accounts_auth_same_org_fkey
  FOREIGN KEY (organization_id, auth_account_id)
  REFERENCES public.mail_accounts(organization_id, id)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE UNIQUE INDEX IF NOT EXISTS mail_accounts_legacy_microsoft_config_uidx
  ON public.mail_accounts(legacy_microsoft_config_id)
  WHERE legacy_microsoft_config_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mail_accounts_one_org_default_uidx
  ON public.mail_accounts(organization_id)
  WHERE provider = 'outlook'
    AND scope = 'organization'
    AND is_default_for_organization = true
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mail_accounts_one_user_default_uidx
  ON public.mail_accounts(organization_id, owner_user_id)
  WHERE provider = 'outlook'
    AND scope = 'personal'
    AND is_default_for_user = true
    AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mail_account_secrets (
  mail_account_id uuid PRIMARY KEY REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  secret_kind text NOT NULL DEFAULT 'oauth',
  secret_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mail_account_user_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mail_account_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  can_read_mail boolean NOT NULL DEFAULT false,
  can_send_mail boolean NOT NULL DEFAULT false,
  can_delete_mail boolean NOT NULL DEFAULT false,
  can_read_calendar boolean NOT NULL DEFAULT false,
  can_write_calendar boolean NOT NULL DEFAULT false,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mail_account_id, user_id),
  FOREIGN KEY (organization_id, mail_account_id)
    REFERENCES public.mail_accounts(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.outlook_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  nonce_hash text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('organization', 'personal')),
  return_to text NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
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

DROP TRIGGER IF EXISTS trg_mail_accounts_updated_at ON public.mail_accounts;
CREATE TRIGGER trg_mail_accounts_updated_at
BEFORE UPDATE ON public.mail_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_mail_account_secrets_updated_at ON public.mail_account_secrets;
CREATE TRIGGER trg_mail_account_secrets_updated_at
BEFORE UPDATE ON public.mail_account_secrets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_mail_account_user_access_updated_at ON public.mail_account_user_access;
CREATE TRIGGER trg_mail_account_user_access_updated_at
BEFORE UPDATE ON public.mail_account_user_access
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_mail_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  credential public.mail_accounts%ROWTYPE;
BEGIN
  NEW.from_email = lower(trim(coalesce(NEW.from_email, '')));
  NEW.mailbox_email = nullif(lower(trim(coalesce(NEW.mailbox_email, ''))), '');
  NEW.calendar_owner_email = nullif(lower(trim(coalesce(NEW.calendar_owner_email, ''))), '');

  IF NEW.scope = 'personal' THEN
    IF NEW.owner_user_id IS NULL THEN
      RAISE EXCEPTION 'Personal Outlook accounts require owner_user_id';
    END IF;
    IF NEW.auth_account_id IS NOT NULL OR NEW.mailbox_mode <> 'user' THEN
      RAISE EXCEPTION 'Personal Outlook accounts cannot be shared or credential-linked';
    END IF;
  ELSE
    IF NEW.owner_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Organization Outlook accounts cannot have owner_user_id';
    END IF;
  END IF;

  IF NEW.mailbox_mode = 'shared' THEN
    IF NEW.scope <> 'organization' OR NEW.auth_account_id IS NULL OR NEW.mailbox_email IS NULL THEN
      RAISE EXCEPTION 'Shared Outlook accounts require organization scope, auth_account_id and mailbox_email';
    END IF;

    SELECT * INTO credential
    FROM public.mail_accounts
    WHERE id = NEW.auth_account_id
      AND organization_id = NEW.organization_id
      AND provider = 'outlook'
      AND scope = 'organization'
      AND mailbox_mode = 'user'
      AND auth_account_id IS NULL
      AND deleted_at IS NULL
      AND status NOT IN ('disabled', 'disconnected')
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shared Outlook auth_account_id must reference an active same-organization credential account';
    END IF;
  ELSIF NEW.auth_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only shared Outlook accounts can reference auth_account_id';
  END IF;

  IF NEW.calendar_path_kind = 'graph_calendar_id' AND NEW.calendar_id IS NULL THEN
    RAISE EXCEPTION 'graph_calendar_id locator requires calendar_id';
  END IF;

  IF NEW.from_email = '' THEN
    NEW.from_email = coalesce(NEW.mailbox_email, '');
  END IF;
  IF NEW.display_name = '' THEN
    NEW.display_name = coalesce(NEW.mailbox_name, NEW.mailbox_email, NEW.from_email, 'Outlook');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mail_account ON public.mail_accounts;
CREATE TRIGGER trg_validate_mail_account
BEFORE INSERT OR UPDATE ON public.mail_accounts
FOR EACH ROW EXECUTE FUNCTION public.validate_mail_account();

CREATE OR REPLACE FUNCTION public.validate_mail_account_secret()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  account public.mail_accounts%ROWTYPE;
BEGIN
  SELECT * INTO account
  FROM public.mail_accounts
  WHERE id = NEW.mail_account_id
    AND provider = 'outlook'
    AND mailbox_mode = 'user'
    AND auth_account_id IS NULL
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outlook secrets can only be stored for credential accounts';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mail_account_secret ON public.mail_account_secrets;
CREATE TRIGGER trg_validate_mail_account_secret
BEFORE INSERT OR UPDATE ON public.mail_account_secrets
FOR EACH ROW EXECUTE FUNCTION public.validate_mail_account_secret();

CREATE OR REPLACE FUNCTION public.claim_mail_account_refresh(
  p_mail_account_id uuid,
  p_lock_timeout_seconds integer DEFAULT 90
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.mail_accounts
  SET refreshing_at = now()
  WHERE id = p_mail_account_id
    AND deleted_at IS NULL
    AND (
      refreshing_at IS NULL
      OR refreshing_at < now() - make_interval(secs => p_lock_timeout_seconds)
    );

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_mail_account_refresh(p_mail_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.mail_accounts
  SET refreshing_at = NULL
  WHERE id = p_mail_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_mail_account_refresh(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_mail_account_refresh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mail_account_refresh(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_mail_account_refresh(uuid) TO service_role;

ALTER TABLE public.mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_account_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_account_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlook_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mail_accounts tenant select" ON public.mail_accounts;
CREATE POLICY "mail_accounts tenant select"
ON public.mail_accounts
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "mail_account_user_access tenant select" ON public.mail_account_user_access;
CREATE POLICY "mail_account_user_access tenant select"
ON public.mail_account_user_access
FOR SELECT
TO authenticated
USING (organization_id = public.get_user_org_id());

-- Backfill existing encrypted Microsoft tokens into the new additive model.
WITH existing AS (
  SELECT
    m.*,
    CASE WHEN m.user_id IS NULL THEN 'organization' ELSE 'personal' END AS next_scope
  FROM public.microsoft_config m
  WHERE m.is_active = true
    AND m.microsoft_email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.mail_accounts a WHERE a.legacy_microsoft_config_id = m.id
    )
),
inserted AS (
  INSERT INTO public.mail_accounts (
    organization_id,
    provider,
    scope,
    owner_user_id,
    display_name,
    from_email,
    mailbox_mode,
    mailbox_email,
    mailbox_name,
    calendar_owner_email,
    mail_read_enabled,
    mail_send_enabled,
    mail_delete_enabled,
    calendar_read_enabled,
    calendar_write_enabled,
    is_default_for_organization,
    is_default_for_user,
    status,
    last_connected_at,
    legacy_microsoft_config_id
  )
  SELECT
    organization_id,
    'outlook',
    next_scope,
    user_id,
    coalesce(microsoft_email, 'Outlook'),
    coalesce(microsoft_email, ''),
    'user',
    microsoft_email,
    microsoft_email,
    microsoft_email,
    true,
    true,
    false,
    true,
    true,
    user_id IS NULL,
    user_id IS NOT NULL,
    CASE WHEN access_token IS NOT NULL AND refresh_token IS NOT NULL THEN 'connected' ELSE 'needs_reconnect' END,
    updated_at,
    id
  FROM existing
  RETURNING id, legacy_microsoft_config_id
)
INSERT INTO public.mail_account_secrets (mail_account_id, secret_encrypted, secret_kind)
SELECT
  i.id,
  jsonb_build_object(
    'kind', 'oauth_vault_v1',
    'access_token', m.access_token,
    'refresh_token', m.refresh_token,
    'expires_at', m.token_expires_at,
    'scope', 'openid profile email offline_access User.Read Mail.ReadWrite.Shared Mail.Send Mail.Send.Shared Calendars.ReadWrite.Shared',
    'microsoft_user_id', m.microsoft_user_id,
    'microsoft_tenant_id', m.microsoft_tenant_id,
    'microsoft_email', m.microsoft_email
  )::text,
  'oauth'
FROM inserted i
JOIN public.microsoft_config m ON m.id = i.legacy_microsoft_config_id
WHERE m.access_token IS NOT NULL
  AND m.refresh_token IS NOT NULL
ON CONFLICT (mail_account_id) DO NOTHING;

COMMIT;
