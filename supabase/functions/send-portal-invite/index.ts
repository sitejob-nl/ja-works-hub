import { requireRolePermission, createAdminClient } from "../_shared/auth.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";
import { type BrandTheme, brandButton, escapeHtml, renderBrandedEmail, resolveBrandTheme } from "../_shared/email-layout.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function buildInviteEmailHtml(data: {
  firstName: string;
  activationUrl: string;
  theme: BrandTheme;
}): string {
  const { theme } = data;
  const content = `<h2 style="margin:0 0 16px;color:${theme.navyHex};font-size:18px;">Welkom bij ${escapeHtml(theme.orgName)}</h2>
          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">Hoi ${escapeHtml(data.firstName)},</p>
          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">
            Je bent succesvol geplaatst en hebt nu toegang tot het medewerkersportaal. Via dit portaal kun je:
          </p>
          <ul style="margin:0 0 24px;padding:0 0 0 20px;color:${theme.textHex};font-size:14px;line-height:1.8;">
            <li>Je uren bekijken en bevestigen</li>
            <li>Plaatsingen en werkroosters inzien</li>
            <li>Documenten (ID, contract, loonstroken) ophalen</li>
            <li>Ziekmeldingen doorgeven</li>
            <li>Huisvesting en voertuiginfo bekijken</li>
            <li>Je profiel beheren</li>
          </ul>

          <p style="margin:0 0 4px;color:${theme.textHex};font-size:14px;">Activeer je account door een wachtwoord in te stellen:</p>
          ${brandButton("Account activeren", data.activationUrl, theme)}

          <p style="margin:16px 0 0;color:#64748b;font-size:12px;">Deze link is 7 dagen geldig. Lukt het niet? Stuur een berichtje naar je intercedent.</p>
          <p style="margin:20px 0 0;color:${theme.textHex};font-size:14px;">Met vriendelijke groet,<br><strong>${escapeHtml(theme.orgName)}</strong></p>`;
  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: "Activeer je medewerkersportaal",
    footerNote: "Automatische uitnodiging. Reageer niet op deze mail.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    // Only internal staff may dispatch portal invites. requireInternalProfile
    // rejects anonymous, service-role and portal (medewerker/opdrachtgever) callers.
    const auth = await requireRolePermission(req, "candidates.edit", corsHeaders);
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
        organization:organization_id(name, logo_url, settings)
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
    const brandTheme = resolveBrandTheme(org);
    const activationUrl = await buildOrganizationPublicUrl(
      service,
      invite.organization_id,
      `/portaal/activeren/${invite.token}`,
    );

    const subject = `Welkom — activeer je medewerkersportaal`;
    const html = buildInviteEmailHtml({ firstName, activationUrl, theme: brandTheme });

    const sendResult = await sendViaOutlookAccount({
      orgId: invite.organization_id,
      to: invite.email,
      subject,
      htmlBody: html,
      candidateId: invite.candidate_id,
      sentBy: auth.userId,
      senderName: null,
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
