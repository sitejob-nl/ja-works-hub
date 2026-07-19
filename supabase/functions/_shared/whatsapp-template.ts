// Template-verzending voor proactieve WhatsApp-berichten (Meta 24u-regel).
//
// Meta bezorgt buiten het 24-uurs servicevenster — dat opent bij elk INKOMEND bericht
// van de ontvanger — uitsluitend goedgekeurde templates. Een plaatsingsbevestiging is
// per definitie proactief: de kandidaat heeft meestal niets gestuurd, dus vrije tekst
// komt niet aan (Meta-fout 131047). Deze module bepaalt of het venster open staat en
// bouwt anders een template-payload.
//
// Spiegelt src/lib/whatsapp-template.ts (frontend, interesse-bericht met quick replies);
// hier zonder knoppen, met positionele body-variabelen.
//
// GEEN Deno- of externe imports (zelfde afspraak als matching-core.ts): de pure helpers
// worden vanuit Vitest getest, en een esm.sh-import laat `tsc` op de frontend stuklopen.
// De Supabase-client komt daarom als structureel `any` binnen.

type QueryClient = any;

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppTemplateRow {
  id: string;
  template_name: string;
  language: string;
  category: string;
  status: string;
  components: unknown;
}

const asComponents = (components: unknown): any[] => (Array.isArray(components) ? components : []);

export function extractTemplateBodyText(components: unknown): string {
  const body = asComponents(components).find((c: any) => String(c?.type).toUpperCase() === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

/** Oplopende, unieke variabelenummers uit een template-body ({{1}}, {{2}}, …). */
export function templateVariableNumbers(text: string): number[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => Number(m.replace(/\{\{|\}\}/g, ""))))].sort((a, b) => a - b);
}

/** Meta weigert newlines, tabs en 4+ opeenvolgende spaties in body-parameters. */
export function sanitizeTemplateParam(value: unknown): string {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 0 ? flat : "-";
}

/**
 * Bouwt de template-payload voor whatsapp-send. `values` is positioneel: index 0 vult
 * {{1}}, index 1 vult {{2}}, enzovoort. Ontbrekende waarden worden '-' — Meta weigert
 * een payload waarin het aantal parameters afwijkt van de goedgekeurde template.
 */
export function buildTemplatePayload(
  template: Pick<WhatsAppTemplateRow, "template_name" | "language" | "components">,
  values: unknown[],
): { name: string; language: string; components: any[] } {
  const components: any[] = [];
  const varNumbers = templateVariableNumbers(extractTemplateBodyText(template.components));

  if (varNumbers.length > 0) {
    components.push({
      type: "body",
      parameters: varNumbers.map((n) => ({
        type: "text",
        text: sanitizeTemplateParam(values[n - 1]),
      })),
    });
  }

  return {
    name: template.template_name,
    language: template.language || "nl",
    components,
  };
}

/** Voorbeeld van de verzonden tekst (voor preview en logging). */
export function renderTemplatePreview(components: unknown, values: unknown[]): string {
  const body = extractTemplateBodyText(components);
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n) => sanitizeTemplateParam(values[Number(n) - 1]));
}

/**
 * Staat het 24-uurs servicevenster open? Dat is zo wanneer er in de laatste 24 uur een
 * INKOMEND WhatsApp-bericht van deze kandidaat/contactpersoon is binnengekomen.
 * Bij twijfel (geen id, of een db-fout) → false, zodat we de veilige template-route kiezen.
 */
export async function isWithinServiceWindow(
  service: QueryClient,
  input: { orgId: string; candidateId?: string | null; companyContactId?: string | null },
): Promise<boolean> {
  const since = new Date(Date.now() - SERVICE_WINDOW_MS).toISOString();
  let query = (service as any)
    .from("communications")
    .select("id")
    .eq("organization_id", input.orgId)
    .eq("channel", "whatsapp")
    .eq("direction", "inbound")
    .gte("created_at", since)
    .limit(1);

  if (input.candidateId) query = query.eq("candidate_id", input.candidateId);
  else if (input.companyContactId) query = query.eq("company_contact_id", input.companyContactId);
  else return false;

  const { data, error } = await query;
  if (error) {
    console.warn("isWithinServiceWindow: lookup faalde, val terug op template-route", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Haalt een goedgekeurde template op bij naam. Niet gevonden of niet APPROVED → null. */
export async function fetchApprovedTemplate(
  service: QueryClient,
  orgId: string,
  templateName: string | null | undefined,
): Promise<WhatsAppTemplateRow | null> {
  if (!templateName) return null;
  const { data, error } = await (service as any)
    .from("whatsapp_templates")
    .select("id, template_name, language, category, status, components")
    .eq("organization_id", orgId)
    .eq("template_name", templateName)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return String(data.status).toUpperCase() === "APPROVED" ? (data as WhatsAppTemplateRow) : null;
}
