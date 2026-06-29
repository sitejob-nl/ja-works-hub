// Kill-switch voor uitgaande communicatie (review 03-06).
//
// Eén globale org-pauze zodat er tijdens ontwikkelen/testen geen ongewenste
// e-mails of WhatsApp-berichten naar kandidaten gaan. Geblokkeerde berichten
// worden NIET stil weggegooid maar als 'concept' in communications gelogd
// (message_type = 'concept'), zodat ze terugvindbaar/herstelbaar zijn.
//
// Vlag leeft in organizations.settings.outbound_paused:
//   true                          -> alles gepauzeerd
//   { email: true }               -> alleen e-mail
//   { whatsapp: true }            -> alleen WhatsApp
//   { email: true, whatsapp: true }
//
// E-mail heeft één chokepoint (sendViaOutlookAccount); WhatsApp wordt per
// send-functie bewaakt op de zwaarste paden (whatsapp-send, bulk-campaign).

// Minimale client-vorm zodat zowel de Outlook-admin client als de WhatsApp
// service-client (esm.sh) hier passen zonder cross-module type-koppeling.
type Admin = { from: (table: string) => any };
export type OutboundChannel = "email" | "whatsapp";

/** True wanneer uitgaande communicatie voor dit kanaal op pauze staat. */
export async function isOutboundPaused(
  admin: Admin,
  orgId: string,
  channel: OutboundChannel,
): Promise<boolean> {
  if (!orgId) return false;
  const { data } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  const flag = (data?.settings as any)?.outbound_paused;
  if (flag === true) return true;
  return !!(flag && typeof flag === "object" && flag[channel] === true);
}

interface ConceptRow {
  orgId: string;
  channel: OutboundChannel;
  subject?: string | null;
  body?: string | null;
  emailTo?: string[] | null;
  emailCc?: string[] | null;
  emailAttachments?: Array<Record<string, unknown>> | null;
  emailFrom?: string | null;
  candidateId?: string | null;
  companyId?: string | null;
  companyContactId?: string | null;
  matchId?: string | null;
  placementId?: string | null;
  sentBy?: string | null;
}

/**
 * Logt een geblokkeerd bericht als concept i.p.v. te verzenden. Faalt nooit
 * hard (best-effort), zodat de kill-switch zelf nooit een flow laat crashen.
 */
export async function logConceptCommunication(admin: Admin, row: ConceptRow): Promise<void> {
  // communications heeft CHECK (candidate_id IS NOT NULL OR company_id IS NOT NULL).
  // Een bericht zonder dossier (bv. damage-report naar een garage) kunnen we niet als
  // concept koppelen — sla 'm dan over met een duidelijke waarschuwing i.p.v. de insert
  // stil op de constraint te laten klappen.
  if (!row.candidateId && !row.companyId) {
    console.warn(
      `[outbound-pause] ${row.channel}-bericht geblokkeerd maar zonder candidate/company-id → niet als concept gelogd (naar: ${(row.emailTo ?? []).join(", ") || "?"})`,
    );
    return;
  }
  try {
    await admin.from("communications").insert({
      organization_id: row.orgId,
      candidate_id: row.candidateId ?? null,
      company_id: row.companyId ?? null,
      company_contact_id: row.companyContactId ?? null,
      match_id: row.matchId ?? null,
      placement_id: row.placementId ?? null,
      channel: row.channel,
      direction: "outbound",
      message_type: "concept",
      subject: row.subject ?? null,
      body: row.body ?? null,
      email_to: row.emailTo ?? null,
      email_cc: row.emailCc ?? null,
      email_attachments: row.emailAttachments ?? null,
      email_from: row.emailFrom ?? null,
      sent_by: row.sentBy ?? null,
    } as any);
  } catch (err) {
    console.error("[outbound-pause] concept-log mislukt:", (err as any)?.message ?? err);
  }
}
