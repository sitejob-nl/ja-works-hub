// Client-side spiegel van de server-side merk-mailframe (_shared/email-layout.ts).
// Wordt alleen gebruikt om in de UI een VOORBEELD van de huisstijl-mail te tonen
// (E-mailtemplates → mailflow openen). De echte mails worden server-side gerenderd.

const JA_WERKT = {
  accentHex: "#F97415",
  navyHex: "#0C4D78",
  textHex: "#334155",
  mutedHex: "#94A3B8",
  pageBgHex: "#F4F4F5",
  tagline: "professionals at work",
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// "25 95% 53%" (CSS --accent triplet) → "#f97415"; null bij onbekend → caller valt naar brand-default.
export function hslTripletToHex(triplet?: string | null): string | null {
  if (!triplet) return null;
  const m = String(triplet).trim().match(/^(-?\d*\.?\d+)\s+(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%$/);
  if (!m) return null;
  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = clamp(Number(m[2]), 0, 100) / 100;
  const l = clamp(Number(m[3]), 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v: number) => Math.round((v + mm) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export type PreviewBrand = {
  orgName: string;
  logoUrl: string | null;
  accentHex: string;
};

type OrgRow = { name?: string | null; logo_url?: string | null; settings?: { accent_color?: string | null } | null };

export function resolvePreviewBrand(org?: OrgRow | null): PreviewBrand {
  return {
    orgName: org?.name?.trim() || "JA Werkt",
    logoUrl: org?.logo_url?.trim() || null,
    accentHex: hslTripletToHex(org?.settings?.accent_color ?? null) || JA_WERKT.accentHex,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function logoBlock(brand: PreviewBrand): string {
  if (brand.logoUrl) {
    return `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.orgName)}" height="40" style="display:block;border:0;height:40px;max-height:40px;width:auto;">`;
  }
  return `<span style="font-size:22px;font-weight:800;color:${JA_WERKT.navyHex};letter-spacing:-0.5px;">${escapeHtml(brand.orgName)}</span>`;
}

// Volledige HTML-mail in de huisstijl-frame (wit + oranje accentbalk + navy koppen + grijze footer).
// contentHtml is de body-inhoud (mag inline HTML bevatten).
export function renderBrandedEmailPreview(brand: PreviewBrand, contentHtml: string): string {
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:${JA_WERKT.pageBgHex};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${JA_WERKT.pageBgHex};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
        <tr><td style="padding:24px 32px 16px;">${logoBlock(brand)}</td></tr>
        <tr><td style="height:4px;line-height:4px;font-size:0;background:${brand.accentHex};">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px;color:${JA_WERKT.textHex};font-size:14px;line-height:1.6;">${contentHtml}</td></tr>
        <tr><td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:${JA_WERKT.navyHex};font-size:13px;font-weight:700;">${escapeHtml(brand.orgName)}</p>
          <p style="margin:2px 0 0;color:${JA_WERKT.mutedHex};font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">${JA_WERKT.tagline}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Representatieve voorbeeld-inhoud per mailflow (toont de look-and-feel, niet de exacte productiemail).
function ctaButton(label: string, accentHex: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:6px;background:${accentHex};"><a href="#" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`;
}

export function sampleContentForFlow(flowId: string, brand: PreviewBrand): string {
  const navy = JA_WERKT.navyHex;
  const h = (t: string) => `<h2 style="margin:0 0 12px;color:${navy};font-size:18px;">${escapeHtml(t)}</h2>`;
  const p = (t: string) => `<p style="margin:0 0 14px;">${escapeHtml(t)}</p>`;
  const sign = `<p style="margin:18px 0 0;">Met vriendelijke groet,<br><strong>${escapeHtml(brand.orgName)}</strong></p>`;

  switch (flowId) {
    case "match-proposal":
      return h("Kandidaatvoorstel") +
        p("Wij hebben een geschikte kandidaat gevonden voor uw vacature. Hieronder vindt u een kort profiel.") +
        `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin:0 0 16px;"><tr><td style="padding:14px 18px;"><span style="color:${navy};font-size:12px;text-transform:uppercase;">Kandidaat</span><br><strong style="color:${navy};">Jan de Vries</strong></td></tr></table>` +
        ctaButton("Bekijk CV en reageer op dit voorstel", brand.accentHex) + sign;
    case "placement-client":
      return h("Plaatsingsbevestiging") + p("Hierbij bevestigen wij de plaatsing van een nieuwe medewerker bij uw bedrijf.") + sign;
    case "placement-employee":
      return h("Gefeliciteerd met je nieuwe plaatsing!") + p("Goed nieuws! Je plaatsing is bevestigd. Hieronder vind je de belangrijkste details.") + sign;
    case "timesheet-approval":
      return h("Urenbevestiging") + p("Je uren over de afgelopen periode zijn goedgekeurd. Hieronder het overzicht.") + sign;
    case "employee-portal-invite":
      return h("Welkom bij " + brand.orgName) + p("Je hebt nu toegang tot het medewerkersportaal. Activeer je account met onderstaande knop.") + ctaButton("Account activeren", brand.accentHex) + sign;
    case "client-portal-invite":
      return h("Toegang tot uw klantportaal") + p("U heeft toegang gekregen tot het opdrachtgeverportaal. Activeer uw account met onderstaande knop.") + ctaButton("Account activeren", brand.accentHex) + sign;
    case "ai-analysis":
      return h("Kandidaatprofiel") + p("Bijgaand een profiel van de kandidaat, inclusief samenvatting en aandachtspunten.") + sign;
    case "campaigns":
      return h("Nieuwe kansen voor jou") + p("Er staan weer mooie functies open. Misschien zit jouw volgende baan ertussen.") + ctaButton("Bekijk vacatures", brand.accentHex) + sign;
    case "birthday-loyalty":
      return h("Gefeliciteerd!") + p("Namens het hele team van harte gefeliciteerd met je verjaardag. We wensen je een fijne dag!") + sign;
    case "damage-report":
      return h("Schade- of pechmelding") + p("Er is een schade- of pechmelding geregistreerd. Hieronder de details van het voertuig en de melding.") + sign;
    case "sick-report":
      return h("Ziekmelding") + p("Er is een ziekmelding doorgegeven. Hieronder de details en vervolgstappen.") + sign;
    case "legal-signing":
      return h("Document ter ondertekening") + p("Er staat een document voor je klaar om te ondertekenen.") + ctaButton("Bekijk en onderteken", brand.accentHex) + sign;
    case "manual-email":
      return h("Onderwerp van je bericht") + p("Dit is een voorbeeld van een handmatige e-mail in de huisstijl. De inhoud kies je zelf of via een template.") + sign;
    case "whatsapp":
      return h("WhatsApp-bericht") + p("WhatsApp-berichten lopen via Meta en gebruiken WhatsApp-templates — niet deze e-mailhuisstijl. Beheer ze in WhatsApp-templatebeheer.");
    default:
      return h(brand.orgName) + p("Voorbeeld van een bericht in de huisstijl.") + sign;
  }
}
