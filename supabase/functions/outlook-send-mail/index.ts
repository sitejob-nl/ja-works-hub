import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { auditOutlookAction, buildReplyTo, graphJson, json, loadProviderForAccount, mailboxBasePath } from "../_shared/outlook-accounts.ts";
import { appendAccountSignatureIfMissing, sanitizeEmailHtml } from "../_shared/outlook-signature.ts";
import { isOutboundPaused, logConceptCommunication } from "../_shared/outbound-pause.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024 - 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function cleanEmail(value: unknown): string | null {
  const email = String(value ?? "").trim();
  const hasUnsafeChar = [...email].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127 || /\s|[<>]/.test(char);
  });
  if (!email || hasUnsafeChar) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return null;
  return email;
}

function recipients(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .map(cleanEmail)
    .filter((value): value is string => Boolean(value))
    .map((address) => ({ emailAddress: { address } }));
}

function base64ByteLength(base64: string) {
  const clean = base64.replace(/^data:[^,]+,/, "").replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const toRecipients = recipients(body.to);
  const ccRecipients = recipients(body.cc);
  const bccRecipients = recipients(body.bcc);
  const subject = String(body.subject ?? "").trim();
  const html = sanitizeEmailHtml(String(body.html ?? body.htmlBody ?? ""));
  if (toRecipients.length === 0) return json({ error: "to_required" }, 400, corsHeaders);
  if (!subject) return json({ error: "subject_required" }, 400, corsHeaders);
  if (!html.trim()) return json({ error: "html_required" }, 400, corsHeaders);

  const attachments = [];
  for (const attachment of Array.isArray(body.attachments) ? body.attachments : []) {
    const contentBase64 = String(attachment.content_base64 ?? "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
    const size = base64ByteLength(contentBase64);
    if (!attachment.name || !contentBase64) return json({ error: "attachment_invalid" }, 400, corsHeaders);
    if (size > MAX_ATTACHMENT_BYTES) return json({ error: "attachment_too_large" }, 400, corsHeaders);
    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: String(attachment.name).slice(0, 180),
      contentType: attachment.content_type || "application/octet-stream",
      contentBytes: contentBase64,
      size,
    });
  }
  if (attachments.reduce((sum, a) => sum + a.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    return json({ error: "attachments_total_too_large" }, 400, corsHeaders);
  }

  const admin = createAdminClient();

  // Kill-switch: dit is de interactieve hoofd-mailroute (EmailCompose e.d.). Respecteer de
  // org-pauze hier óók, anders lekt handmatige mail er langs. Geblokkeerd → als concept loggen.
  if (await isOutboundPaused(admin, auth.organizationId, "email")) {
    await logConceptCommunication(admin, {
      orgId: auth.organizationId,
      channel: "email",
      subject,
      body: html,
      emailTo: toRecipients.map((r) => r.emailAddress.address),
      emailCc: ccRecipients.map((r) => r.emailAddress.address),
      candidateId: body.candidate_id ?? null,
      companyId: body.company_id ?? null,
      companyContactId: body.company_contact_id ?? null,
      matchId: body.match_id ?? null,
      sentBy: auth.userId,
    });
    return json({ paused: true, message: "Uitgaande e-mail staat op pauze — bericht is als concept opgeslagen, niet verzonden." }, 200, corsHeaders);
  }

  try {
    const provider = await loadProviderForAccount(admin, auth.organizationId, {
      accountId: body.account_id,
      userId: auth.userId,
      role: auth.role,
      require: "mail_send",
      allowSystemDefault: !body.account_id,
    });
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", auth.userId)
      .maybeSingle();
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", auth.organizationId)
      .maybeSingle();
    const from = provider.account.mailbox_email || provider.account.from_email;
    const finalHtml = appendAccountSignatureIfMissing(html, provider.account, {
      senderName: profile?.full_name?.trim() || "Het JA Werkt team",
      senderEmail: profile?.email ?? null,
      mailboxEmail: from,
      organizationName: org?.name ?? null,
    });

    const replyTo = buildReplyTo(provider.account);
    await graphJson(admin, provider, `${mailboxBasePath(provider.account)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: finalHtml },
          toRecipients,
          ccRecipients,
          bccRecipients,
          ...(replyTo.length ? { replyTo } : {}),
          attachments,
        },
        saveToSentItems: true,
      }),
    });

    await admin.from("communications").insert({
      organization_id: auth.organizationId,
      candidate_id: body.candidate_id ?? null,
      company_id: body.company_id ?? null,
      company_contact_id: body.company_contact_id ?? null,
      match_id: body.match_id ?? null,
      channel: "email",
      direction: "outbound",
      subject,
      body: finalHtml,
      email_to: toRecipients.map((r) => r.emailAddress.address),
      email_cc: ccRecipients.map((r) => r.emailAddress.address),
      email_from: from,
      sent_at: new Date().toISOString(),
      sent_by: auth.userId,
    } as any).then(() => {});

    await auditOutlookAction(admin, {
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "create",
      accountId: provider.account.id,
      values: {
        action: "send_mail",
        to: toRecipients.map((r) => r.emailAddress.address),
        subject,
        from,
      },
    });

    return json({ ok: true, account_id: provider.account.id, from }, 200, corsHeaders);
  } catch (error) {
    const err = error as any;
    return json({ error: err.message || "outlook_send_failed", retry_after: err.retryAfter }, err.status || 400, corsHeaders);
  }
});
