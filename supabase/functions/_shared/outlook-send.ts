import { createAdminClient } from "./auth.ts";
import {
  auditOutlookAction,
  graphJson,
  loadProviderForAccount,
  mailboxBasePath,
  type OutlookCapability,
} from "./outlook-accounts.ts";
import { appendAccountSignatureIfMissing } from "./outlook-signature.ts";

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
  if (toRecipients.length === 0) return { success: false, method: "none", error: "Geen ontvanger opgegeven" };

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
