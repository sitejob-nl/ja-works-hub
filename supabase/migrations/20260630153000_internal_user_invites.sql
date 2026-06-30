-- Interne gebruikersuitnodigingen voor organisatie-admins.
-- Supabase Auth invite-mail wordt bewust niet gebruikt; verzending loopt via Outlook.

CREATE TABLE IF NOT EXISTS public.internal_user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role public.user_role NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  sent_at timestamptz,
  sent_channel text,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  used_at timestamptz,
  accepted_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_user_invites_internal_role CHECK (
    role IN ('admin'::public.user_role, 'intercedent'::public.user_role, 'backoffice'::public.user_role, 'finance'::public.user_role)
  ),
  CONSTRAINT internal_user_invites_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT internal_user_invites_sent_channel_check CHECK (sent_channel IS NULL OR sent_channel IN ('email', 'manual'))
);

CREATE INDEX IF NOT EXISTS internal_user_invites_org_created_idx
  ON public.internal_user_invites (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS internal_user_invites_org_email_idx
  ON public.internal_user_invites (organization_id, email);

CREATE INDEX IF NOT EXISTS internal_user_invites_token_idx
  ON public.internal_user_invites (token);

DROP TRIGGER IF EXISTS handle_internal_user_invites_updated_at ON public.internal_user_invites;
CREATE TRIGGER handle_internal_user_invites_updated_at
  BEFORE UPDATE ON public.internal_user_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.internal_user_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_user_invites_admin_select ON public.internal_user_invites;
CREATE POLICY internal_user_invites_admin_select
  ON public.internal_user_invites
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'::public.user_role
  );

DROP POLICY IF EXISTS internal_user_invites_admin_insert ON public.internal_user_invites;
CREATE POLICY internal_user_invites_admin_insert
  ON public.internal_user_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'::public.user_role
  );

DROP POLICY IF EXISTS internal_user_invites_admin_update ON public.internal_user_invites;
CREATE POLICY internal_user_invites_admin_update
  ON public.internal_user_invites
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'::public.user_role
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'::public.user_role
  );
