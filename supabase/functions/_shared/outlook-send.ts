import { createAdminClient } from "./auth.ts";
import {
  auditOutlookAction,
  buildReplyTo,
  graphJson,
  loadProviderForAccount,
  mailboxBasePath,
  type OutlookCapability,
} from "./outlook-accounts.ts";
import { appendAccountSignatureIfMissing } from "./outlook-signature.ts";
import { isOutboundPaused, logConceptCommunication } from "./outbound-pause.ts";

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024 - 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function base64ByteLength(base64: string) {
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

export interface OutlookAttachment {
  name: string;
  content_type?: string | null;
  content_base64: string;
}

interface GraphAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  contentBytes: string;
  size: number;
}

interface SendViaOutlookAccountParams {
  orgId: string;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  attachments?: OutlookAttachment[];
  accountId?: string | null;
  candidateId?: string;
  companyId?: string;
  companyContactId?: string;
  matchId?: string;
  /** Koppelt de gelogde communicatie aan een plaatsing, zodat de mail zichtbaar
   * wordt op het Communicatie-tabblad van die plaatsing. */
  placementId?: string;
  sentBy?: string;
  senderName?: string | null;
  logCommunication?: boolean;
  require?: OutlookCapability;
  /** Sla de outbound-pauze (kill-switch) over. Alléén voor gebruiker-geïnitieerde,
   * kritieke auth-mail (bv. wachtwoord-reset) — nooit voor campagnes of automations. */
  bypassOutboundPause?: boolean;
}

export interface SendResult {
  success: boolean;
  method: "outlook" | "none";
  error?: string;
  accountId?: string;
  from?: string | null;
  communicationPaused?: boolean;
}

function recipientList(value: string | string[]) {
  return (Array.isArray(value) ? value : [value])
    .map((email) => String(email ?? "").trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

async function resolveSenderContext(admin: ReturnType<typeof createAdminClient>, orgId: string, sentBy?: string, senderName?: string | null) {
  if (senderName === null) return null;

  const [{ data: profile }, { data: org }] = await Promise.all([
    sentBy
      ? admin.from("profiles").select("full_name, email").eq("id", sentBy).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);

  return {
    senderName: typeof senderName === "string" && senderName.trim()
      ? senderName.trim()
      : profile?.full_name?.trim() || "Het JA Werkt team",
    senderEmail: profile?.email ?? null,
    organizationName: org?.name ?? null,
  };
}

export async function sendViaOutlookAccount(params: SendViaOutlookAccountParams): Promise<SendResult> {
  const admin = createAdminClient();
  const toRecipients = recipientList(params.to);
  const ccRecipients = params.cc?.length ? recipientList(params.cc) : [];
  const bccRecipients = params.bcc?.length ? recipientList(params.bcc) : [];
  if (toRecipients.length === 0) return { success: false, method: "none", error: "Geen ontvanger opgegeven" };

  // Bijlagen (bv. CV-PDF bij een voorstel) als Graph fileAttachments. Limieten == outlook-send-mail.
  const graphAttachments: GraphAttachment[] = [];
  for (const att of params.attachments ?? []) {
    const contentBase64 = String(att.content_base64 ?? "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
    const size = base64ByteLength(contentBase64);
    if (!att.name || !contentBase64) return { success: false, method: "none", error: "Ongeldige bijlage" };
    if (size > MAX_ATTACHMENT_BYTES) return { success: false, method: "none", error: "Bijlage te groot (max 3MB)" };
    graphAttachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: String(att.name).slice(0, 180),
      contentType: att.content_type || "application/octet-stream",
      contentBytes: contentBase64,
      size,
    });
  }
  if (graphAttachments.reduce((sum, a) => sum + (a.size as number), 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { success: false, method: "none", error: "Bijlagen samen te groot (max 10MB)" };
  }
  const communicationAttachments = graphAttachments.map((att) => ({
    name: att.name,
    content_type: att.contentType,
    size: att.size,
  }));

  // Kill-switch: bij gepauzeerde uitgaande e-mail niets versturen, wel als concept loggen.
  if (params.bypassOutboundPause !== true && await isOutboundPaused(admin, params.orgId, "email")) {
    if (params.logCommunication !== false) {
      await logConceptCommunication(admin, {
        orgId: params.orgId,
        channel: "email",
        subject: params.subject,
        body: params.htmlBody,
        emailTo: toRecipients.map((r) => r.emailAddress.address),
        emailCc: ccRecipients.map((r) => r.emailAddress.address),
        emailAttachments: communicationAttachments.length ? communicationAttachments : null,
        candidateId: params.candidateId ?? null,
        companyId: params.companyId ?? null,
        companyContactId: params.companyContactId ?? null,
        matchId: params.matchId ?? null,
        placementId: params.placementId ?? null,
        sentBy: params.sentBy ?? null,
      });
    }
    return {
      success: false,
      method: "none",
      error: "Uitgaande e-mail staat op pauze (kill-switch actief). Bericht is als concept opgeslagen.",
      communicationPaused: true,
    };
  }

  try {
    const provider = await loadProviderForAccount(admin, params.orgId, {
      accountId: params.accountId,
      userId: params.sentBy ?? null,
      require: params.require ?? "mail_send",
      allowSystemDefault: !params.accountId,
      bypassJaGrants: true,
    });

    const senderContext = await resolveSenderContext(admin, params.orgId, params.sentBy, params.senderName);
    const from = provider.account.mailbox_email || provider.account.from_email;
    const finalBody = senderContext === null
      ? params.htmlBody
      : appendAccountSignatureIfMissing(params.htmlBody, provider.account, {
        ...senderContext,
        mailboxEmail: from,
      });

    const replyTo = buildReplyTo(provider.account);
    await graphJson(admin, provider, `${mailboxBasePath(provider.account)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: { contentType: "HTML", content: finalBody },
          toRecipients,
          ...(ccRecipients.length ? { ccRecipients } : {}),
          ...(bccRecipients.length ? { bccRecipients } : {}),
          ...(replyTo.length ? { replyTo } : {}),
          ...(graphAttachments.length ? { attachments: graphAttachments } : {}),
        },
        saveToSentItems: true,
      }),
    });

    if (params.logCommunication !== false) {
      await admin.from("communications").insert({
        organization_id: params.orgId,
        candidate_id: params.candidateId ?? null,
        company_id: params.companyId ?? null,
        company_contact_id: params.companyContactId ?? null,
        match_id: params.matchId ?? null,
        placement_id: params.placementId ?? null,
        channel: "email",
        direction: "outbound",
        subject: params.subject,
        body: finalBody,
        email_to: toRecipients.map((r) => r.emailAddress.address),
        email_cc: ccRecipients.map((r) => r.emailAddress.address),
        email_attachments: communicationAttachments.length ? communicationAttachments : null,
        email_from: from,
        sent_at: new Date().toISOString(),
        sent_by: params.sentBy ?? null,
      } as any).then(() => {});
    }

    await auditOutlookAction(admin, {
      organizationId: params.orgId,
      userId: params.sentBy ?? null,
      action: "create",
      accountId: provider.account.id,
      values: {
        action: "send_mail",
        to: toRecipients.map((r) => r.emailAddress.address),
        subject: params.subject,
        from,
      },
    });

    return { success: true, method: "outlook", accountId: provider.account.id, from };
  } catch (error) {
    const err = error as any;
    const missingDefault = err?.code === "outlook_account_not_found";
    return {
      success: false,
      method: missingDefault ? "none" : "outlook",
      error: missingDefault ? "Geen standaard Outlook-afzender ingesteld" : err?.message || "Outlook verzenden mislukt",
    };
  }
}
