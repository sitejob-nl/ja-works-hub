// Opmaak van de plaatsingsbevestiging. Apart van index.ts zodat het testbaar is
// zonder de Deno.serve-entrypoint te draaien.
import type { BrandTheme } from "./email-layout.ts";

export function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Merge zonder HTML-escaping — levert platte tekst op (bewerkbaar in de wizard). */
export function mergeTemplateText(content: string, vars: Record<string, string | null | undefined>): string {
  return content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (token, key: string) => {
    if (!(key in vars)) return token;
    return String(vars[key] ?? "");
  });
}

export type TemplateBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "table"; rows: Array<{ label: string; value: string }> };

/**
 * Splitst platte templatetekst in alinea's en gegevensblokken.
 *
 * Regels als "Functie: Lasser" komen in de templates van nature voor; die renderen we
 * als nette gegevenstabel in plaats van als platte regel. Een losse "Let op: ..."-regel
 * mag daar niet in trappen, dus een tabel ontstaat pas vanaf twee opeenvolgende
 * label-regels. Lege waarden ("Uurtarief: " als er geen tarief is) vallen weg — beter
 * dan een half lege regel in een mail naar de klant.
 */
export function parseTemplateBlocks(text: string): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let paragraph: string[] = [];
  let rows: Array<{ label: string; value: string }> = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const flushRows = () => {
    if (rows.length === 0) return;
    if (rows.length === 1) {
      // Eén losse label-regel is gewoon een zin — geen tabel van maken.
      paragraph.push(`${rows[0].label}: ${rows[0].value}`.trimEnd());
      rows = [];
      return;
    }
    const filled = rows.filter((r) => r.value !== "" && r.value !== "—");
    rows = [];
    if (filled.length === 0) return;
    flushParagraph();
    blocks.push({ kind: "table", rows: filled });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^([\p{L}][^:]{0,40}):[ \t]*(.*)$/u.exec(line);
    if (match) {
      flushParagraph();
      rows.push({ label: match[1].trim(), value: match[2].trim() });
      continue;
    }
    flushRows();
    if (line === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushRows();
  flushParagraph();
  return blocks;
}

/** Rendert platte templatetekst als merk-HTML: alinea's + gegevenstabel. */
export function renderTemplateBody(text: string, theme: BrandTheme): string {
  return parseTemplateBlocks(text)
    .map((block) => {
      if (block.kind === "paragraph") {
        return `<p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;line-height:1.6;">${
          block.lines.map((l) => escapeHtml(l)).join("<br>")
        }</p>`;
      }
      const rows = block.rows
        .map((row, i) => {
          const border = i === block.rows.length - 1 ? "" : "border-bottom:1px solid #e2e8f0;";
          return `<tr><td style="padding:14px 20px;${border}">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(row.label)}</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(row.value)}</strong>
            </td></tr>`;
        })
        .join("");
      return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin:0 0 24px;">${rows}</table>`;
    })
    .join("\n");
}

/**
 * Inhoud van een vrije org-template (contract_templates) in de merk-frame.
 * `heading` is bewust een échte mailtitel — niet de interne templatenaam, die bevat
 * beheerders-jargon ("tekst door SiteJob opgesteld") dat de klant nooit hoort te zien.
 */
export function templateToEmailContent(
  bodyText: string,
  heading: string,
  subheading: string | null,
  theme: BrandTheme,
): string {
  const sub = subheading
    ? `<p style="margin:0 0 24px;color:#64748b;font-size:14px;">${escapeHtml(subheading)}</p>`
    : "";
  return `<h2 style="margin:0 0 8px;color:${theme.navyHex};font-size:18px;">${escapeHtml(heading)}</h2>
          ${sub}
          ${renderTemplateBody(bodyText, theme)}`;
}

/**
 * Algemene voorwaarden onderaan de klantmail. `content` is de al gemergede tekst:
 * eerder ging de ruwe template mee, waardoor de klant letterlijk "{{organization_name}}"
 * in de mail kreeg.
 */
export function generalTermsSection(content: string): string {
  if (!content.trim()) return "";
  return `
          <div style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;padding:14px 20px;margin:24px 0;">
            <p style="margin:0 0 8px;color:#334155;font-size:14px;font-weight:600;">Algemene voorwaarden</p>
            <p style="margin:0;color:#334155;font-size:12px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(content)}</p>
          </div>`;
}
