// send-regulations — stuurt de reglementen die bij een toewijzing horen naar de medewerker.
//
// Aanleiding (doorloop 27-07): wie een auto krijgt, moet automatisch de regels voor autogebruik
// toegestuurd krijgen, en het moet aantoonbaar zijn dát hij ze gelezen heeft. Dat geldt net zo
// goed voor een kamertoewijzing, en het moet werken buiten de plaatsingswizard om — een auto
// wordt ook los toegewezen.
//
// Welke reglementen: alle actieve met `auto_send` in de meegegeven categorie. Wat er verstuurd
// wordt is dus volledig instelbaar in Instellingen → HR, niet hier vastgelegd.
//
// De kill-switch (organizations.settings.outbound_paused) zit in sendViaOutlookAccount; een
// geblokkeerde mail wordt daar als concept gelogd in plaats van stil weggegooid.
//
// Auth: elke actieve interne gebruiker. Toewijzen zelf is al RLS-gegate; dit endpoint mailt
// alleen het bijbehorende reglement naar de kandidaat van die toewijzing.

import { requireInternalProfile, createAdminClient } from "../_shared/auth.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";
import { type BrandTheme, brandButton, escapeHtml, renderBrandedEmail, resolveBrandTheme } from "../_shared/email-layout.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CATEGORIES = ["voertuig", "huisvesting"] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_COPY: Record<Category, { intro: string; subject: string }> = {
  voertuig: {
    intro: "Je hebt een bedrijfsauto toegewezen gekregen. Hieronder staan de regels voor het gebruik ervan.",
    subject: "Regels voor het gebruik van je bedrijfsauto",
  },
  huisvesting: {
    intro: "Je hebt een kamer toegewezen gekregen. Hieronder staan de huisregels.",
    subject: "Huisregels voor je woonruimte",
  },
};

// Graph weigert bijlagen boven ~3MB (zie outlook-send.ts). Een groter reglement sturen we niet
// mee als bestand; de ontvanger krijgt 'm dan alsnog via de link te zien.
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  // In stukken, anders loopt String.fromCharCode(...) bij grote bestanden tegen de argumentlimiet.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function buildEmailHtml(data: {
  firstName: string;
  theme: BrandTheme;
  category: Category;
  regulationTitle: string;
  version: number;
  bodyText: string;
  acceptUrl: string | null;
  hasAttachment: boolean;
}): string {
  const { theme, acceptUrl } = data;
  const toelichting = data.bodyText.trim()
    ? `<p style="margin:16px 0 0;color:${theme.textHex};font-size:14px;white-space:pre-wrap;">${escapeHtml(data.bodyText.trim())}</p>`
    : "";
  const attachmentNote = data.hasAttachment
    ? `<p style="margin:12px 0 0;color:${theme.mutedHex};font-size:12px;">Het document zit als bijlage bij deze mail.</p>`
    : "";
  const cta = acceptUrl
    ? `${brandButton("Lezen en bevestigen", acceptUrl, theme)}
       <p style="margin:16px 0 0;color:${theme.mutedHex};font-size:12px;">
         Je bent pas klaar als je het document hebt doorgenomen en op bevestigen hebt geklikt.
         Deze link is 60 dagen geldig en werkt één keer.
       </p>`
    : `<p style="margin:16px 0 0;color:${theme.mutedHex};font-size:12px;">Je hoeft hier niets voor te doen; bewaar dit bericht.</p>`;

  const content = `
    <h1 style="margin:0;color:${theme.navyHex};font-size:20px;">Hoi ${escapeHtml(data.firstName)},</h1>
    <p style="margin:12px 0 0;color:${theme.textHex};font-size:14px;">${escapeHtml(CATEGORY_COPY[data.category].intro)}</p>
    <p style="margin:16px 0 0;color:${theme.textHex};font-size:14px;">
      <strong>${escapeHtml(data.regulationTitle)}</strong> (versie ${data.version})
    </p>
    ${toelichting}
    ${attachmentNote}
    ${cta}
    <p style="margin:20px 0 0;color:${theme.textHex};font-size:14px;">Met vriendelijke groet,<br><strong>${escapeHtml(theme.orgName)}</strong></p>`;

  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: CATEGORY_COPY[data.category].subject,
    footerNote: "Automatisch verstuurd bij je toewijzing. Reageer niet op deze mail.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const candidateId = typeof body.candidate_id === "string" ? body.candidate_id : null;
    const category = CATEGORIES.includes(body.category as Category) ? body.category as Category : null;
    const contextId = typeof body.context_id === "string" ? body.context_id : null;
    if (!candidateId) return json({ error: "candidate_id required" }, 400);
    if (!category) return json({ error: "category must be voertuig or huisvesting" }, 400);

    const admin = createAdminClient();
    const orgId = auth.organizationId;

    // Kandidaat binnen de eigen org — meteen de autorisatiecheck op het doelwit.
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, first_name, last_name, email")
      .eq("id", candidateId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!candidate) return json({ error: "Kandidaat niet gevonden" }, 404);

    const { data: regulations } = await admin
      .from("regulations")
      .select("id, title, version, content, file_url, requires_acknowledgement")
      .eq("organization_id", orgId)
      .eq("category", category)
      .eq("is_active", true)
      .eq("auto_send", true);

    const list = regulations ?? [];
    // Niets ingesteld is een geldige toestand, geen fout: de toewijzing gaat gewoon door.
    if (list.length === 0) return json({ sent: 0, skipped: 0, reason: "geen_reglementen" });
    if (!candidate.email) return json({ sent: 0, skipped: list.length, reason: "geen_emailadres" });

    const { data: org } = await admin
      .from("organizations").select("name, logo_url, settings").eq("id", orgId).maybeSingle();
    const theme = resolveBrandTheme(org);
    const firstName = candidate.first_name ?? "collega";

    const results: Array<Record<string, unknown>> = [];

    for (const reg of list) {
      let acceptUrl: string | null = null;
      if (reg.requires_acknowledgement) {
        const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
        const { error: tokenErr } = await admin.from("regulation_send_tokens").insert({
          organization_id: orgId,
          regulation_id: reg.id,
          candidate_id: candidateId,
          context_type: category,
          context_id: contextId,
          token_hash: await sha256Hex(token),
        });
        if (tokenErr) {
          results.push({ regulation_id: reg.id, sent: false, error: "token_mislukt" });
          continue;
        }
        acceptUrl = await buildOrganizationPublicUrl(admin, orgId, `/reglement/${token}`);
      }

      // PDF meesturen als bijlage wanneer die er is en binnen de Graph-limiet past.
      let attachments: Array<{ name: string; content_base64: string; content_type: string }> | undefined;
      if (reg.file_url) {
        const { data: fileBlob, error: dlErr } = await admin.storage.from("documents").download(reg.file_url);
        if (!dlErr && fileBlob) {
          const bytes = new Uint8Array(await fileBlob.arrayBuffer());
          if (bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
            const name = `${reg.title.replace(/[^\w\s.-]/g, "").trim() || "reglement"}.pdf`;
            attachments = [{ name, content_base64: bytesToBase64(bytes), content_type: "application/pdf" }];
          }
        }
      }

      const sendResult = await sendViaOutlookAccount({
        orgId,
        to: candidate.email,
        subject: CATEGORY_COPY[category].subject,
        htmlBody: buildEmailHtml({
          firstName,
          theme,
          category,
          regulationTitle: reg.title,
          version: reg.version,
          bodyText: reg.content ?? "",
          acceptUrl,
          hasAttachment: !!attachments,
        }),
        attachments,
        candidateId,
        sentBy: auth.userId,
        // null → de merk-footer is de afzender-identiteit, geen dubbele O365-handtekening.
        senderName: null,
        logCommunication: true,
      });

      results.push({
        regulation_id: reg.id,
        title: reg.title,
        sent: sendResult.success,
        paused: !!sendResult.communicationPaused,
        requires_acknowledgement: reg.requires_acknowledgement,
        error: sendResult.success ? undefined : sendResult.error,
      });
    }

    return json({
      sent: results.filter((r) => r.sent).length,
      failed: results.filter((r) => !r.sent).length,
      results,
    });
  } catch (err) {
    console.error("send-regulations error:", err);
    return json({ error: "Interne fout bij versturen reglementen" }, 500);
  }
});
