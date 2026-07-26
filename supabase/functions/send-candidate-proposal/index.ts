// Kandidaat-voorstelmail (A2): mailt de MEDEWERKER een baanvoorstel, gevoed uit de
// AI-gegenereerde vacaturetekst (vacancy_seo_content), met interesse-knoppen die via
// een single-use token de match automatisch verschuiven (ja → afspraak_voorgesteld,
// nee → afgewezen; zelfde transitie als de WhatsApp-ja/nee-knoppen).
//
// Dual-mode zoals send-match-proposal:
//   preview=true → server-rendered { subject, html, to } met ?preview=1-links, niets verstuurd
//   send         → token + echte links, verzending via Outlook (outbound-pause-guard),
//                  géén statuswijziging bij verzenden (de kandidaat-reactie verschuift 'm)
//
// KRITIEK: de opdrachtgever wordt NIET genoemd in deze mail — de kandidaat ziet de
// vacaturetitel + pitch; de klantnaam volgt pas in het echte gesprek (zelfde
// anonimiteitsregel als de publieke vacaturetekst).

import { requireRolePermission, createAdminClient, jsonResponse } from "../_shared/auth.ts";
import { escapeHtml, loadBrandTheme, renderBrandedEmail, type BrandTheme } from "../_shared/email-layout.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";
import { ensureMatchCandidateToken } from "../_shared/match-interest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return jsonResponse(body, status, corsHeaders);
}

// Markdown-lite → e-mail-HTML: koppen, bullets, bold, alinea's. Bewust minimaal —
// de bron is onze eigen gegenereerde tekst (geen arbitraire user-markdown).
function markdownLiteToHtml(md: string, theme: BrandTheme): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const blocks = md.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^[-*•]\s+/.test(l))) {
      const items = lines.map((l) => `<li style="margin:0 0 6px;">${inline(l.replace(/^[-*•]\s+/, ""))}</li>`).join("");
      html.push(`<ul style="margin:0 0 16px;padding-left:20px;color:${theme.textHex};font-size:14px;line-height:1.6;">${items}</ul>`);
      continue;
    }
    const first = lines[0];
    const heading = first.match(/^(#{1,3})\s+(.*)$/);
    if (heading && lines.length === 1) {
      const size = heading[1].length === 1 ? 18 : 15;
      html.push(`<h3 style="margin:20px 0 8px;color:${theme.navyHex};font-size:${size}px;">${inline(heading[2])}</h3>`);
      continue;
    }
    html.push(`<p style="margin:0 0 14px;color:${theme.textHex};font-size:14px;line-height:1.6;">${lines.map(inline).join("<br>")}</p>`);
  }
  return html.join("\n");
}

function buildCandidateProposalHtml(data: {
  theme: BrandTheme;
  orgEmail: string | null;
  orgPhone: string | null;
  firstName: string;
  vacancyTitle: string;
  introText: string;
  pitchHtml: string;
  yesUrl: string;
  noUrl: string;
}): string {
  const { theme } = data;
  const contactLine = [data.orgEmail, data.orgPhone]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ");

  const content = `<h2 style="margin:0 0 8px;color:${theme.navyHex};font-size:18px;">Nieuwe baan voor jou: ${escapeHtml(data.vacancyTitle)}</h2>
          <p style="margin:0 0 20px;color:${theme.textHex};font-size:14px;line-height:1.6;">Hoi ${escapeHtml(data.firstName)},<br>${escapeHtml(data.introText)}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              ${data.pitchHtml}
            </td></tr>
          </table>

          <p style="margin:0 0 12px;color:${theme.textHex};font-size:14px;line-height:1.6;"><strong>Heb je interesse?</strong> Laat het direct weten:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
            <td style="border-radius:6px;background:${theme.accentHex};">
              <a href="${escapeHtml(data.yesUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">Ja, ik heb interesse</a>
            </td>
            <td style="width:12px;"></td>
            <td style="border-radius:6px;background:#e2e8f0;">
              <a href="${escapeHtml(data.noUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;color:${theme.navyHex};font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">Nee, niet voor mij</a>
            </td>
          </tr></table>

          <p style="margin:8px 0 0;color:${theme.textHex};font-size:14px;">
            Vragen? Bel of mail ons gerust.<br>
            Met vriendelijke groet,<br><strong>${escapeHtml(theme.orgName)}</strong>
            ${contactLine ? `<br><span style="color:#64748b;font-size:12px;">${contactLine}</span>` : ""}
          </p>`;
  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: `Nieuwe baan voor jou: ${data.vacancyTitle}`,
    footerNote: "Je ontvangt dit bericht omdat je bij ons ingeschreven staat.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireRolePermission(req, "matching.proposal.send", corsHeaders);
    if (auth instanceof Response) return auth;
    const orgId = auth.organizationId;
    const userId = auth.userId;
    const service = createAdminClient();

    const body = await req.json().catch(() => ({}));
    const matchId = typeof body.match_id === "string" ? body.match_id : null;
    const preview = body.preview === true;
    if (!matchId) return json({ error: "match_id is required" }, 400);

    const { data: match, error: mErr } = await service
      .from("matches")
      .select(`id, status, organization_id,
        candidates:candidate_id(id, first_name, last_name, email),
        vacancies:vacancy_id(id, title, location, candidate_description)`)
      .eq("id", matchId)
      .eq("organization_id", orgId)
      .single();
    if (mErr || !match) return json({ error: "Match niet gevonden" }, 404);

    const candidate = (match as any).candidates;
    const vacancy = (match as any).vacancies;
    if (!candidate || !vacancy) return json({ error: "Match mist kandidaat of vacature" }, 400);

    // Pitch: de kandidaatomschrijving gaat vóór (die is vóór de kandidaat geschreven, in
    // gewone taal en zonder opmaakcodes). De SEO-teksten zijn voor de website geschreven en
    // dienen alleen als terugval voor vacatures waarvoor nog geen omschrijving bestaat.
    const { data: seo } = await service
      .from("vacancy_seo_content")
      .select("vacaturebank_variant, preview_text, body_markdown")
      .eq("vacancy_id", vacancy.id)
      .maybeSingle();
    const pitchSource = typeof body.pitch === "string" && body.pitch.trim()
      ? body.pitch.trim()
      : (vacancy.candidate_description || seo?.vacaturebank_variant || seo?.preview_text || seo?.body_markdown || "").trim();

    const [theme, orgRes] = await Promise.all([
      loadBrandTheme(service, orgId),
      service.from("organizations").select("email, phone").eq("id", orgId).maybeSingle(),
    ]);
    const org = (orgRes as any).data;

    const firstName = (candidate.first_name ?? "").trim() || "daar";
    const subject = typeof body.subject === "string" && body.subject.trim()
      ? body.subject.trim()
      : `Nieuwe baan voor jou: ${vacancy.title}`;
    const introText = typeof body.intro_text === "string" && body.intro_text.trim()
      ? body.intro_text.trim()
      : `We hebben een baan gevonden die goed bij je past${vacancy.location ? ` in ${vacancy.location}` : ""}. Lees hieronder wat het inhoudt.`;
    const pitchHtml = pitchSource
      ? markdownLiteToHtml(pitchSource, theme)
      : `<p style="margin:0;color:${theme.textHex};font-size:14px;line-height:1.6;"><strong>${escapeHtml(vacancy.title)}</strong>${vacancy.location ? escapeHtml(` — ${vacancy.location}`) : ""}</p>`;

    // Token (hergebruikt binnen geldigheid → preview en send delen dezelfde links).
    const recipient = typeof body.recipient_email === "string" && body.recipient_email.trim()
      ? body.recipient_email.trim()
      : (candidate.email ?? "").trim();
    const token = await ensureMatchCandidateToken(service, {
      orgId,
      matchId: match.id,
      candidateEmail: recipient || null,
    });
    const baseUrl = await buildOrganizationPublicUrl(service, orgId, `/baan/interesse/${token.token}`);
    const yesUrl = `${baseUrl}?a=ja`;
    const noUrl = `${baseUrl}?a=nee`;

    if (preview) {
      const html = buildCandidateProposalHtml({
        theme,
        orgEmail: org?.email ?? null,
        orgPhone: org?.phone ?? null,
        firstName,
        vacancyTitle: vacancy.title,
        introText,
        pitchHtml,
        yesUrl: `${yesUrl}&preview=1`,
        noUrl: `${noUrl}&preview=1`,
      });
      return json({
        preview: true,
        to: recipient || null,
        subject,
        intro_text: introText,
        pitch: pitchSource,
        html,
        has_generated_text: Boolean(seo?.vacaturebank_variant || seo?.preview_text || seo?.body_markdown),
      });
    }

    if (!recipient) return json({ error: "Kandidaat heeft geen e-mailadres" }, 400);

    const html = buildCandidateProposalHtml({
      theme,
      orgEmail: org?.email ?? null,
      orgPhone: org?.phone ?? null,
      firstName,
      vacancyTitle: vacancy.title,
      introText,
      pitchHtml,
      yesUrl,
      noUrl,
    });

    const outlookResult = await sendViaOutlookAccount({
      orgId,
      to: recipient,
      subject,
      htmlBody: html,
      accountId: typeof body.account_id === "string" ? body.account_id : undefined,
      sentBy: userId,
      candidateId: candidate.id,
      matchId: match.id,
    });
    if (!outlookResult.success) {
      return json({
        success: false,
        sent_via: outlookResult.method,
        outlook_error: outlookResult.error,
        communication_paused: outlookResult.communicationPaused === true,
      }, outlookResult.communicationPaused ? 409 : 502);
    }

    // Best-effort audit; geen statuswijziging — de kandidaat-reactie verschuift de match.
    try {
      await service.from("audit_log").insert({
        organization_id: orgId,
        user_id: userId,
        action: "create",
        table_name: "match_candidate_tokens",
        record_id: token.id,
        new_values: { match_id: match.id, sent_to: recipient, via: "send-candidate-proposal" },
      } as any);
    } catch (_e) { /* ignore */ }

    return json({ success: true, sent_via: "outlook" });
  } catch (err) {
    console.error("send-candidate-proposal error:", err);
    return json({ error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
