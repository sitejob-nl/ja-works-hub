import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Send an email via the organization's Microsoft Outlook connection.
 * Falls back gracefully if no Microsoft connection exists.
 *
 * Usage from any edge function:
 *   import { sendViaOutlook } from "../_shared/outlook-send.ts";
 *   const result = await sendViaOutlook({ orgId, to, subject, htmlBody });
 */

interface SendViaOutlookParams {
  orgId: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  htmlBody: string;
  /** Optional: candidate ID for logging in communications */
  candidateId?: string;
  /** Optional: company ID for logging in communications */
  companyId?: string;
  /** Optional: who triggered the send */
  sentBy?: string;
}

interface SendResult {
  success: boolean;
  method: "outlook" | "none";
  error?: string;
}

export async function sendViaOutlook(params: SendViaOutlookParams): Promise<SendResult> {
  const { orgId, to, cc, subject, htmlBody, candidateId, companyId, sentBy } = params;

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Get Microsoft token for org
  const { data: msToken, error: msError } = await serviceClient.rpc("get_microsoft_token", {
    p_org_id: orgId,
  });

  if (msError || !msToken || msToken.length === 0 || !msToken[0].access_token) {
    console.warn(`No Microsoft connection for org ${orgId}, email not sent`);
    return { success: false, method: "none", error: "Microsoft 365 niet geconfigureerd voor deze organisatie" };
  }

  let accessToken = msToken[0].access_token;

  // Check token expiry, refresh if needed
  const expiresAt = new Date(msToken[0].token_expires_at).getTime();
  const now = Date.now();
  if (expiresAt - now <= 60_000) {
    // Refresh token
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

    const refreshRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: msToken[0].refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        scope: "openid profile User.Read email Mail.Send offline_access",
      }),
    });

    if (!refreshRes.ok) {
      console.error("Token refresh failed:", await refreshRes.text());
      return { success: false, method: "outlook", error: "Token refresh mislukt" };
    }

    const tokenData = await refreshRes.json();
    accessToken = tokenData.access_token;

    // Store new tokens
    const { data: encAccess } = await serviceClient.rpc("encrypt_sensitive", { plaintext: tokenData.access_token });
    const { data: encRefresh } = await serviceClient.rpc("encrypt_sensitive", { plaintext: tokenData.refresh_token });

    await serviceClient
      .from("microsoft_config")
      .update({
        access_token: encAccess,
        refresh_token: encRefresh,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .is("user_id", null);
  }

  // Build recipients
  const toRecipients = (Array.isArray(to) ? to : [to]).map(email => ({
    emailAddress: { address: email.trim() },
  }));

  const ccRecipients = cc?.map(email => ({
    emailAddress: { address: email.trim() },
  }));

  // Send via Graph API
  const graphRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients,
        ...(ccRecipients && ccRecipients.length > 0 ? { ccRecipients } : {}),
      },
    }),
  });

  if (!graphRes.ok && graphRes.status !== 202) {
    const errText = await graphRes.text();
    console.error("Graph sendMail failed:", errText);
    return { success: false, method: "outlook", error: `Graph API error: ${graphRes.status}` };
  }

  // Log in communications
  const toEmails = Array.isArray(to) ? to : [to];
  await serviceClient.from("communications").insert({
    organization_id: orgId,
    recipient_id: candidateId || null,
    recipient_type: candidateId ? "candidate" : null,
    company_id: companyId || null,
    channel: "email",
    direction: "outbound",
    subject,
    body: htmlBody,
    email_to: toEmails,
    email_from: msToken[0].microsoft_email || null,
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_by: sentBy || null,
  } as any);

  return { success: true, method: "outlook" };
}
