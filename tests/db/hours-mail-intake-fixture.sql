-- Synthetic shim for isolated mail-intake QA, never for production.
--
-- Mirrors only what the intake migration reads: the two client mail addresses,
-- the contact table it recognises a sender by, and the connected mailbox a
-- followed folder points at. Shapes follow production metadata of 2026-09-16.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS invoice_email text;

CREATE TABLE IF NOT EXISTS public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  email text,
  first_name text,
  last_name text
);

CREATE TABLE IF NOT EXISTS public.mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  provider text NOT NULL DEFAULT 'outlook',
  scope text NOT NULL DEFAULT 'organization',
  mailbox_mode text NOT NULL DEFAULT 'user',
  display_name text NOT NULL DEFAULT 'Synthetic mailbox',
  from_email text NOT NULL DEFAULT 'synthetic@example.invalid',
  mailbox_email text,
  mail_read_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'connected',
  owner_user_id uuid,
  deleted_at timestamptz
);

-- Who may read which mailbox. This table is leading for mailbox access: the
-- admin role gives no implicit read right on a company mailbox.
CREATE TABLE IF NOT EXISTS public.mail_account_user_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  mail_account_id uuid NOT NULL REFERENCES public.mail_accounts(id),
  user_id uuid NOT NULL,
  can_read_mail boolean NOT NULL DEFAULT false,
  can_send_mail boolean NOT NULL DEFAULT false,
  can_delete_mail boolean NOT NULL DEFAULT false,
  can_read_calendar boolean NOT NULL DEFAULT false,
  can_write_calendar boolean NOT NULL DEFAULT false,
  UNIQUE (mail_account_id, user_id)
);
ALTER TABLE public.mail_account_user_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_account_user_access FROM public, anon, authenticated, service_role;

-- Same posture as the rest of the QA shim: the backend owns every write.
ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_contacts, public.mail_accounts
  FROM public, anon, authenticated, service_role;
