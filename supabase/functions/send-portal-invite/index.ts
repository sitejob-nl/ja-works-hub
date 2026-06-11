import { requireInternalProfile, createAdminClient } from "../_shared/auth.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildInviteEmailHtml(data: {
  firstName: string;
  orgName: string;
  activationUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Welkom bij ${escapeHtml(data.orgName)}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Hoi ${escapeHtml(data.firstName)},</p>
          <p style="margin:0 0 16px;color:#334155;font-size:14px;">
            Je bent succesvol geplaatst en hebt nu toegang tot het medewerkersportaal. Via dit portaal kun je:
          </p>
          <ul style="margin:0 0 24px;padding:0 0 0 20px;color:#334155;font-size:14px;line-height:1.8;">
            <li>Je uren bekijken en bevestigen</li>
            <li>Plaatsingen en werkroosters inzien</li>
            <li>Documenten (ID, contract, loonstroken) ophalen</li>
            <li>Ziekmeldingen doorgeven</li>
            <li>Huisvesting en voertuiginfo bekijken</li>
            <li>Je profiel beheren</li>
          </ul>

          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Activeer je account door een wachtwoord in te stellen:</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center" style="padding:12px 0;">
              <a href="${escapeHtml(data.activationUrl)}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:15px;font-weight:600;">
                Account activeren
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;color:#64748b;font-size:12px;">Deze link is 7 dagen geldig. Lukt het niet? Stuur een berichtje naar je intercedent.</p>
          <p style="margin:24px 0 0;color:#334155;font-size:14px;">Met vriendelijke groet,<br><strong>${escapeHtml(data.orgName)}</strong></p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Automatische uitnodiging. Reageer niet op deze mail.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    // Only internal staff may dispatch portal invites. requireInternalProfile
    // rejects anonymous, service-role and portal (medewerker/opdrachtgever) callers.
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const service = createAdminClient();

    const body = await req.json();
    const { invite_id } = body as { invite_id: string };
    if (!invite_id) return json({ error: "invite_id required" }, 400);

    const { data: invite } = await service
      .from("portal_invites")
      .select(`
        id, token, email, organization_id, candidate_id, used_at, expires_at,
        candidate:candidate_id(first_name, last_name),
        organization:organization_id(name, settings)
      `)
      .eq("id", invite_id)
      .maybeSingle();

    // Same response for missing and cross-tenant so the endpoint can't be used to
    // probe invite ids of other organisations.
    if (!invite || invite.organization_id !== auth.organizationId) {
      return json({ error: "Invite not found" }, 404);
    }
    if (invite.used_at) return json({ error: "Invite al gebruikt" }, 400);
    if (new Date(invite.expires_at) < new Date()) return json({ error: "Invite verlopen" }, 400);
    if (!invite.email) return json({ error: "Geen e-mailadres op invite" }, 400);

    const cand: any = invite.candidate;
    const org: any = invite.organization;
    const firstName = cand?.first_name ?? "medewerker";
    const orgName = org?.name ?? "je organisatie";
    const activationUrl = await buildOrganizationPublicUrl(
      service,
      invite.organization_id,
      `/portaal/activeren/${invite.token}`,
    );

    const subject = `Welkom — activeer je medewerkersportaal`;
    const html = buildInviteEmailHtml({ firstName, orgName, activationUrl });

    const sendResult = await sendViaOutlookAccount({
      orgId: invite.organization_id,
      to: invite.email,
      subject,
      htmlBody: html,
      candidateId: invite.candidate_id,
      sentBy: auth.userId,
    });

    if (!sendResult.success) {
      return json({ sent: false, error: sendResult.error, activation_url: activationUrl });
    }

    await service.from("communications").insert({
      organization_id: invite.organization_id,
      candidate_id: invite.candidate_id,
      channel: "email",
      direction: "outbound",
      subject,
      body: `Portal-uitnodiging naar ${invite.email}`,
      sent_at: new Date().toISOString(),
      sent_by: auth.userId,
      email_to: [invite.email],
    });

    return json({ sent: true, to: invite.email, activation_url: activationUrl });
  } catch (err: any) {
    console.error("send-portal-invite error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
