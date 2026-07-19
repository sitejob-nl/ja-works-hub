// Gedeelde, merk-consistente e-mail-layout (BB1, meeting 17-06 brandbook JA! Werkt).
//
// Eén wrapper voor álle transactionele mails: witte kaart, logo bovenaan, dunne oranje
// accentbalk, navy koppen, grijze footer met tagline. Multi-tenant: leest org-logo + accentkleur
// uit organizations.settings (accent_color staat als HSL-triplet "H S% L%" voor de CSS-variabelen);
// valt terug op de JA! Werkt-huisstijl als default.
//
// Pure string-helper, geen externe HTML-deps — bruikbaar vanuit elke edge function.

// JA! Werkt-huisstijl (brandbook): Verbindend Orange / Zakelijk Blue / Puur Grey.
export const JA_WERKT_BRAND = {
  accentHex: "#F97415",   // Verbindend Orange (== org accent_color hsl(25 95% 53%))
  navyHex: "#0C4D78",     // Zakelijk Blue (koppen + logo-woordmerk)
  textHex: "#334155",     // body-tekst
  mutedHex: "#94A3B8",    // secundaire tekst / footer
  pageBgHex: "#F4F4F5",   // mail-achtergrond rond de kaart
  // Geen standaard-tagline: JA Werkt wil die niet onder elke mail. Een org kan er zelf
  // één zetten via settings.email_tagline; leeg betekent dat de regel wegvalt.
  tagline: "",
} as const;

export type BrandTheme = {
  orgName: string;
  logoUrl: string | null;
  accentHex: string;
  navyHex: string;
  textHex: string;
  mutedHex: string;
  pageBgHex: string;
  tagline: string;
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// "25 95% 53%" (zoals opgeslagen voor de CSS --accent variabele) → "#f97415".
// Geeft null terug bij een niet-herkende waarde, zodat de caller naar de brand-default kan vallen.
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

type OrgBrandingRow = {
  name?: string | null;
  logo_url?: string | null;
  settings?: { accent_color?: string | null; email_tagline?: string | null } | null;
};

// Bouw een thema uit een organisatie-rij; mist een waarde → JA! Werkt-default.
export function resolveBrandTheme(org?: OrgBrandingRow | null): BrandTheme {
  const accentFromSettings = hslTripletToHex(org?.settings?.accent_color ?? null);
  return {
    orgName: org?.name?.trim() || "JA Werkt",
    logoUrl: org?.logo_url?.trim() || null,
    accentHex: accentFromSettings || JA_WERKT_BRAND.accentHex,
    navyHex: JA_WERKT_BRAND.navyHex,
    textHex: JA_WERKT_BRAND.textHex,
    mutedHex: JA_WERKT_BRAND.mutedHex,
    pageBgHex: JA_WERKT_BRAND.pageBgHex,
    tagline:
      typeof org?.settings?.email_tagline === "string"
        ? org.settings.email_tagline.trim()
        : JA_WERKT_BRAND.tagline,
  };
}

// Laad het thema voor één org (admin/service client). Faalt nooit hard → brand-default.
// deno-lint-ignore no-explicit-any
export async function loadBrandTheme(client: any, orgId: string): Promise<BrandTheme> {
  try {
    const { data } = await client
      .from("organizations")
      .select("name, logo_url, settings")
      .eq("id", orgId)
      .maybeSingle();
    return resolveBrandTheme(data);
  } catch {
    return resolveBrandTheme(null);
  }
}

// Merk-knop (CTA). Bulletproof-button-patroon (inline, werkt in Outlook).
export function brandButton(label: string, url: string, theme: BrandTheme): string {
  const safeUrl = /^https?:\/\//i.test(String(url)) ? String(url) : "#";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:6px;background:${theme.accentHex};">
    <a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

export type BrandedEmailOptions = {
  theme: BrandTheme;
  contentHtml: string;        // body-inhoud (zelf samengesteld, al ge-escaped waar nodig)
  preheader?: string;         // verborgen previewtekst in de inbox
  footerNote?: string;        // bv. "Dit is een automatisch gegenereerd bericht."
};

function logoBlock(theme: BrandTheme): string {
  if (theme.logoUrl) {
    return `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.orgName)}" height="40" style="display:block;border:0;outline:none;text-decoration:none;height:40px;max-height:40px;width:auto;">`;
  }
  // Geen logo bekend → woordmerk in huisstijl als tekst.
  return `<span style="font-size:22px;font-weight:800;color:${theme.navyHex};letter-spacing:-0.5px;">${escapeHtml(theme.orgName)}</span>`;
}

// Volledige, merk-consistente HTML-mail. De caller levert alleen de body-inhoud.
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const { theme } = opts;
  const preheader = opts.preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}</span>`
    : "";
  const footerNote = opts.footerNote
    ? `<p style="margin:10px 0 0;color:${theme.mutedHex};font-size:11px;">${escapeHtml(opts.footerNote)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(theme.orgName)}</title></head>
<body style="margin:0;padding:0;background:${theme.pageBgHex};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.pageBgHex};padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
        <tr><td style="padding:24px 32px 16px;">${logoBlock(theme)}</td></tr>
        <tr><td style="height:4px;line-height:4px;font-size:0;background:${theme.accentHex};">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px;color:${theme.textHex};font-size:14px;line-height:1.6;">${opts.contentHtml}</td></tr>
        <tr><td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:${theme.navyHex};font-size:13px;font-weight:700;">${escapeHtml(theme.orgName)}</p>
          ${theme.tagline
            ? `<p style="margin:2px 0 0;color:${theme.mutedHex};font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(theme.tagline)}</p>`
            : ""}
          ${footerNote}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
