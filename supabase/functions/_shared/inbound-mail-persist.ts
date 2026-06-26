// COM1 — auto-persistentie van inkomende e-mail naar `communications`.
//
// AVG / match-gated: we leggen ALLEEN mail vast die van of over een bekende
// kandidaat of opdrachtgever(contact) is. Onbekende afzenders (nieuwsbrieven,
// spam, onbekende relaties) worden NIET opgeslagen. Dat is privacy-minimaal én
// technisch verplicht — de CHECK `chk_comm_target` op `communications` eist een
// candidate_id of company_id. Spiegelt de match-logica van de handmatige triage
// in src/components/email/EmailInbox.tsx (kandidaat > contact > bedrijf).
//
// Idempotent: dedup op `email_message_id`, dus herhaald ophalen van dezelfde map
// maakt geen dubbele rijen.

// deno-lint-ignore no-explicit-any
type Admin = any;

export type InboundMailMessage = {
  id: string;
  subject?: string | null;
  from?: { name?: string | null; address?: string | null } | null;
  to?: Array<{ address?: string | null }>;
  cc?: Array<{ address?: string | null }>;
  received_at?: string | null;
  preview?: string | null;
};

export async function persistMatchedInboundMail(
  admin: Admin,
  organizationId: string,
  mailboxEmail: string | null | undefined,
  messages: InboundMailMessage[],
): Promise<void> {
  const own = (mailboxEmail ?? "").trim().toLowerCase();

  // Alleen inkomend: afzender bestaat, is niet de mailbox zelf (zo vallen
  // verzonden/concept-items af) en heeft een id + ontvangstdatum.
  const inbound = messages.filter((m) => {
    const addr = m.from?.address?.trim().toLowerCase();
    return Boolean(m.id && m.received_at && addr && addr !== own);
  });
  if (inbound.length === 0) return;

  const emails = [...new Set(inbound.map((m) => m.from!.address!.trim().toLowerCase()))];

  const [cands, contacts, comps] = await Promise.all([
    admin.from("candidates").select("id, email").eq("organization_id", organizationId).in("email", emails),
    admin.from("company_contacts").select("id, company_id, email").eq("organization_id", organizationId).in("email", emails),
    admin.from("companies").select("id, email, invoice_email").eq("organization_id", organizationId),
  ]);

  const candByEmail = new Map<string, string>();
  for (const r of (cands.data ?? [])) if (r.email) candByEmail.set(String(r.email).toLowerCase(), r.id);

  const contactByEmail = new Map<string, { id: string; company_id: string | null }>();
  for (const r of (contacts.data ?? [])) if (r.email) contactByEmail.set(String(r.email).toLowerCase(), { id: r.id, company_id: r.company_id ?? null });

  const compByEmail = new Map<string, string>();
  for (const r of (comps.data ?? [])) {
    if (r.email) compByEmail.set(String(r.email).toLowerCase(), r.id);
    if (r.invoice_email) compByEmail.set(String(r.invoice_email).toLowerCase(), r.id);
  }

  type Match = { msg: InboundMailMessage; candidate_id: string | null; company_id: string | null; company_contact_id: string | null };
  const matched: Match[] = [];
  for (const m of inbound) {
    const addr = m.from!.address!.trim().toLowerCase();
    const candidate_id = candByEmail.get(addr) ?? null;
    let company_id: string | null = null;
    let company_contact_id: string | null = null;
    if (!candidate_id) {
      const c = contactByEmail.get(addr);
      if (c) { company_contact_id = c.id; company_id = c.company_id; }
      else { company_id = compByEmail.get(addr) ?? null; }
    }
    if (candidate_id || company_id) matched.push({ msg: m, candidate_id, company_id, company_contact_id });
  }
  if (matched.length === 0) return;

  // Dedup op email_message_id (idempotent bij herhaald ophalen).
  const ids = matched.map((x) => x.msg.id);
  const { data: existing } = await admin
    .from("communications").select("email_message_id")
    .eq("organization_id", organizationId).in("email_message_id", ids);
  const seen = new Set((existing ?? []).map((r: { email_message_id: string }) => r.email_message_id));

  const rows = matched
    .filter((x) => !seen.has(x.msg.id))
    .map(({ msg, candidate_id, company_id, company_contact_id }) => ({
      organization_id: organizationId,
      candidate_id,
      company_id,
      company_contact_id,
      channel: "email",
      direction: "inbound",
      subject: msg.subject || "(Geen onderwerp)",
      body: msg.preview || null,
      email_from: msg.from?.address ?? null,
      email_to: (msg.to ?? []).map((r) => r.address).filter(Boolean),
      email_cc: (msg.cc ?? []).map((r) => r.address).filter(Boolean),
      email_message_id: msg.id,
      sent_at: msg.received_at,
      message_type: "email_inbound",
    }));
  if (rows.length === 0) return;

  await admin.from("communications").insert(rows as unknown[]);
}
