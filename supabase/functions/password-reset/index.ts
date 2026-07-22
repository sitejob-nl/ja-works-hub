// Publieke wachtwoord-vergeten-flow voor alle drie de login-zones (hoofdapp, medewerkers-
// portaal, klantportaal).
//
// action "request": genereert een GoTrue recovery-token (admin.generateLink) en mailt een
//   herstel-link in de huisstijl via het org-mailaccount. Antwoordt ALTIJD { ok: true } —
//   het endpoint mag niet lekken of een e-mailadres bestaat.
// action "update": zet het nieuwe wachtwoord voor de recovery-sessie (Bearer-token uit
//   verifyOtp op /wachtwoord-herstellen). admin.updateUserById omzeilt de GoTrue-policy,
//   dus assertPasswordAcceptable is hier verplicht.

import { createAdminClient } from "../_shared/auth.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildOrganizationPublicUrl, defaultPublicBaseUrl } from "../_shared/public-url.ts";
import {
  type BrandTheme,
  brandButton,
  escapeHtml,
  loadBrandTheme,
  renderBrandedEmail,
  resolveBrandTheme,
} from "../_shared/email-layout.ts";
import { assertPasswordAcceptable } from "../_shared/password-policy.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Strenger dan match-response: reset-mails zijn zeldzaam en dit endpoint stuurt e-mail.
const MAX_PER_IP_PER_HOUR = 10;
const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_GLOBAL_PER_HOUR = 300;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

type Zone = "app" | "portaal" | "klantportaal";
type Lang = "nl" | "en";

const ZONE_NEXT: Record<Zone, string> = {
  app: "/login",
  portaal: "/portaal/login",
  klantportaal: "/klantportaal/login",
};

const MAIL_COPY: Record<Lang, {
  subject: string;
  title: string;
  hi: (name: string) => string;
  body: (orgName: string) => string;
  button: string;
  validity: string;
  notYou: string;
  preheader: string;
  footer: string;
}> = {
  nl: {
    subject: "Wachtwoord opnieuw instellen",
    title: "Wachtwoord opnieuw instellen",
    hi: (name) => `Hoi ${name},`,
    body: (orgName) =>
      `Je hebt gevraagd om je wachtwoord voor ${orgName} opnieuw in te stellen. Klik op de knop hieronder om een nieuw wachtwoord te kiezen:`,
    button: "Nieuw wachtwoord instellen",
    validity: "Deze link is 1 uur geldig en kan één keer worden gebruikt.",
    notYou: "Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren; je wachtwoord blijft ongewijzigd.",
    preheader: "Stel je wachtwoord opnieuw in",
    footer: "Automatisch bericht. Reageer niet op deze mail.",
  },
  en: {
    subject: "Reset your password",
    title: "Reset your password",
    hi: (name) => `Hi ${name},`,
    body: (orgName) =>
      `You requested a password reset for ${orgName}. Click the button below to choose a new password:`,
    button: "Set a new password",
    validity: "This link is valid for 1 hour and can be used once.",
    notYou: "Didn't request this? You can ignore this email; your password stays unchanged.",
    preheader: "Reset your password",
    footer: "Automated message. Please do not reply.",
  },
};

function buildResetEmailHtml(data: {
  firstName: string;
  resetUrl: string;
  theme: BrandTheme;
  lang: Lang;
}): string {
  const { theme } = data;
  const t = MAIL_COPY[data.lang];
  const content = `<h2 style="margin:0 0 16px;color:${theme.navyHex};font-size:18px;">${t.title}</h2>
          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">${t.hi(escapeHtml(data.firstName))}</p>
          <p style="margin:0 0 20px;color:${theme.textHex};font-size:14px;">${t.body(escapeHtml(theme.orgName))}</p>
          ${brandButton(t.button, data.resetUrl, theme)}
          <p style="margin:16px 0 0;color:#64748b;font-size:12px;">${t.validity}</p>
          <p style="margin:8px 0 0;color:#64748b;font-size:12px;">${t.notYou}</p>`;
  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: t.preheader,
    footerNote: t.footer,
  });
}

async function handleRequest(req: Request, body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const zone: Zone = body.zone === "portaal" || body.zone === "klantportaal" ? body.zone : "app";
  // Meldingen bestaan alleen in NL en EN; PL/RO krijgen Engels (bruikbaarder dan Nederlands).
  const lang: Lang = !body.language || body.language === "nl" ? "nl" : "en";

  // Generiek ok — ook op invalide input — zodat het endpoint niets over accounts prijsgeeft.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: true });

  const service = createAdminClient();

  // Rate-limit per IP, per e-mailadres en globaal (service-only throttle-tabel).
  const ipHash = await sha256Hex(clientIp(req));
  const emailHash = await sha256Hex(email);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [{ count: ipCount }, { count: emailCount }, { count: globalCount }] = await Promise.all([
    service.from("password_reset_attempts").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", since),
    service.from("password_reset_attempts").select("id", { count: "exact", head: true })
      .eq("email_hash", emailHash).gte("created_at", since),
    service.from("password_reset_attempts").select("id", { count: "exact", head: true })
      .gte("created_at", since),
  ]);
  if (
    (ipCount ?? 0) >= MAX_PER_IP_PER_HOUR ||
    (emailCount ?? 0) >= MAX_PER_EMAIL_PER_HOUR ||
    (globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR
  ) {
    return json({ error: "Te veel verzoeken. Probeer het later opnieuw." }, 429);
  }
  await service.from("password_reset_attempts").insert({ ip_hash: ipHash, email_hash: emailHash, action: "request" });

  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    // Onbekend e-mailadres (of GoTrue-fout): zelfde antwoord als succes.
    if (linkError && !/not\s*found/i.test(linkError.message ?? "")) {
      console.error("password-reset generateLink error:", linkError.message);
    }
    return json({ ok: true });
  }

  const userId = linkData.user?.id;
  const { data: profile } = userId
    ? await service.from("profiles").select("organization_id, full_name").eq("id", userId).maybeSingle()
    : { data: null };

  const orgId: string | null = profile?.organization_id ?? null;
  const firstName = String(profile?.full_name ?? "").trim().split(/\s+/)[0] || (lang === "en" ? "there" : "daar");

  const nextPath = ZONE_NEXT[zone];
  const resetPath = `/wachtwoord-herstellen?token_hash=${encodeURIComponent(hashedToken)}&next=${encodeURIComponent(nextPath)}`;
  const resetUrl = orgId
    ? await buildOrganizationPublicUrl(service, orgId, resetPath)
    : `${defaultPublicBaseUrl()}${resetPath}`;
  const theme = orgId ? await loadBrandTheme(service, orgId) : resolveBrandTheme(null);

  if (!orgId) {
    // Zonder profiel/org is er geen mailaccount om vanaf te sturen (bv. superadmin).
    console.error("password-reset: geen organisatie voor gebruiker, mail niet verstuurd");
    return json({ ok: true });
  }

  const html = buildResetEmailHtml({ firstName, resetUrl, theme, lang });
  const sendResult = await sendViaOutlookAccount({
    orgId,
    to: email,
    subject: MAIL_COPY[lang].subject,
    htmlBody: html,
    senderName: null,
    logCommunication: false, // auth-mail hoort niet in de communicatie-tijdlijn
    bypassOutboundPause: true, // reset-mail moet ook werken als de org-mail gepauzeerd is
  });
  if (!sendResult.success) {
    console.error("password-reset: mail versturen mislukt:", sendResult.error);
  }

  return json({ ok: true });
}

async function handleUpdate(req: Request, body: Record<string, unknown>): Promise<Response> {
  // Meldingen bestaan alleen in NL en EN; PL/RO krijgen Engels (bruikbaarder dan Nederlands).
  const lang: Lang = !body.language || body.language === "nl" ? "nl" : "en";
  const password = body.password;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Niet ingelogd" }, 401);

  const service = createAdminClient();
  const { data: userData, error: userError } = await service.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: lang === "en" ? "Session expired. Request a new link." : "Sessie verlopen. Vraag een nieuwe link aan." }, 401);
  }

  const pwError = await assertPasswordAcceptable(password, lang);
  if (pwError) return json({ error: pwError }, 400);

  const { error: updateError } = await service.auth.admin.updateUserById(userData.user.id, {
    password: password as string,
  });
  if (updateError) {
    console.error("password-reset updateUserById error:", updateError.message);
    return json({ error: lang === "en" ? "Could not update password" : "Wachtwoord bijwerken mislukt" }, 500);
  }

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "update") return await handleUpdate(req, body);
    return await handleRequest(req, body);
  } catch (err) {
    console.error("password-reset error:", err);
    return json({ error: "Er ging iets mis" }, 500);
  }
});
