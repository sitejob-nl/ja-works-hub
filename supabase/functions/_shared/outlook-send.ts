import { createAdminClient } from "./auth.ts";
import {
  auditOutlookAction,
  graphJson,
  loadProviderForAccount,
  mailboxBasePath,
  type OutlookCapability,
} from "./outlook-accounts.ts";

interface SendViaOutlookAccountParams {
  orgId: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  htmlBody: string;
  accountId?: string | null;
  candidateId?: string;
  companyId?: string;
  companyContactId?: string;
  sentBy?: string;
  senderName?: string | null;
  logCommunication?: boolean;
  require?: OutlookCapability;
}

interface SendResult {
  success: boolean;
  method: "outlook" | "none";
  error?: string;
  accountId?: string;
  from?: string | null;
}

const SIGNATURE_MARKER = "ja-werkt-signature";

export function buildSignatureBlock(senderName: string): string {
  return `<div data-signature="${SIGNATURE_MARKER}" style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;color:#334155;font-size:14px;line-height:1.5;">
  <p style="margin:0;">Met vriendelijke groet,</p>
  <p style="margin:4px 0 0;font-weight:600;">${escapeHtml(senderName)}</p>
  <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;">Verstuurd via JA Werkt</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function appendSignatureIfMissing(html: string, senderName: string): string {
  if (html.includes(`data-signature="${SIGNATURE_MARKER}"`)) return html;
  return html + buildSignatureBlock(senderName);
}

function recipientList(value: string | string[]) {
  return (Array.isArray(value) ? value : [value])
    .map((email) => String(email ?? "").trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

async function resolveSenderName(admin: ReturnType<typeof createAdminClient>, sentBy?: string, senderName?: string | null) {
  if (senderName === null) return null;
  if (typeof senderName === "string" && senderName.trim()) return senderName.trim();
  if (!sentBy) return "Het JA Werkt team";

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", sentBy)
    .maybeSingle();

  return profile?.full_name?.trim() || "Het JA Werkt team";
}

export async function sendViaOutlookAccount(params: SendViaOutlookAccountParams): Promise<SendResult> {
  const admin = createAdminClient();
  const toRecipients = recipientList(params.to);
  const ccRecipients = params.cc?.length ? recipientList(params.cc) : [];
  if (toRecipients.length === 0) return { success: false, method: "none", error: "Geen ontvanger opgegeven" };

  try {
    const provider = await loadProviderForAccount(admin, params.orgId, {
      accountId: params.accountId,
      userId: params.sentBy ?? null,
      require: params.require ?? "mail_send",
      allowSystemDefault: !params.accountId,
      bypassJaGrants: true,
    });

    const senderName = await resolveSenderName(admin, params.sentBy, params.senderName);
    const finalBody = senderName === null
      ? params.htmlBody
      : appendSignatureIfMissing(params.htmlBody, senderName);
    const from = provider.account.mailbox_email || provider.account.from_email;

    await graphJson(admin, provider, `${mailboxBasePath(provider.account)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          body: { contentType: "HTML", content: finalBody },
          toRecipients,
          ...(ccRecipients.length ? { ccRecipients } : {}),
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
        channel: "email",
        direction: "outbound",
        subject: params.subject,
        body: finalBody,
        email_to: toRecipients.map((r) => r.emailAddress.address),
        email_cc: ccRecipients.map((r) => r.emailAddress.address),
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
