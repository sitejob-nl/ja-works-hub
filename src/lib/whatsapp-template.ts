// Helpers voor template-verzending van het match-interesse-bericht (Meta 24u-regel).
//
// Buiten het 24-uurs servicevenster bezorgt Meta alleen goedgekeurde TEMPLATE-berichten;
// vrije (interactive) berichten komen dan niet aan. Deze module bouwt de template-payload
// voor whatsapp-send met per-kandidaat quick-reply-payloads (match_ja:<id>/match_nee:<id>),
// zodat de webhook de match automatisch kan verschuiven — zelfde lus als de vrije knoppen.

export interface WhatsAppTemplateRow {
  id: string;
  template_name: string;
  language: string;
  category: string;
  status: string;
  components: any[] | null;
}

const asComponents = (components: unknown): any[] => (Array.isArray(components) ? components : []);

export function extractTemplateBodyText(components: unknown): string {
  const body = asComponents(components).find((c: any) => String(c?.type).toUpperCase() === 'BODY');
  return body?.text ?? '';
}

/** Posities (Meta-index over álle knoppen) van de QUICK_REPLY-knoppen in de template. */
export function quickReplyIndexes(components: unknown): number[] {
  const buttons = asComponents(components).find((c: any) => String(c?.type).toUpperCase() === 'BUTTONS');
  const list = Array.isArray(buttons?.buttons) ? buttons.buttons : [];
  const indexes: number[] = [];
  list.forEach((b: any, i: number) => {
    if (String(b?.type).toUpperCase() === 'QUICK_REPLY') indexes.push(i);
  });
  return indexes;
}

/** Geschikt als interesse-template: goedgekeurd + minimaal 2 quick-reply-knoppen (ja/nee). */
export function isInterestTemplate(t: WhatsAppTemplateRow): boolean {
  return t.status === 'APPROVED' && quickReplyIndexes(t.components).length >= 2;
}

// Meta verbiedt newlines/tabs/4+ spaties in body-parameters — plat maken.
export function sanitizeTemplateParam(value: string): string {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > 0 ? flat : '-';
}

const extractVariableNumbers = (text: string): number[] => {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => Number(m.replace(/\{\{|\}\}/g, ''))))].sort((a, b) => a - b);
};

/** Vult de template-body-variabelen positioneel: {{1}} = voornaam, {{2}} = vacaturetitel,
 *  {{3}} = pitch; eventuele extra variabelen krijgen '-'. */
export function buildInterestTemplatePayload(
  template: WhatsAppTemplateRow,
  input: { firstName: string; vacancyTitle: string; pitch?: string; matchId: string },
): { name: string; language: string; components?: any[] } {
  const components: any[] = [];

  const bodyText = extractTemplateBodyText(template.components);
  const varNumbers = extractVariableNumbers(bodyText);
  if (varNumbers.length > 0) {
    const positional = [input.firstName, input.vacancyTitle, input.pitch ?? ''];
    components.push({
      type: 'body',
      parameters: varNumbers.map((n) => ({
        type: 'text',
        text: sanitizeTemplateParam(positional[n - 1] ?? '-'),
      })),
    });
  }

  // Eerste twee quick-replies = ja/nee, met de match-id in de payload.
  const [yesIndex, noIndex] = quickReplyIndexes(template.components);
  components.push(
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: String(yesIndex ?? 0),
      parameters: [{ type: 'payload', payload: `match_ja:${input.matchId}` }],
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: String(noIndex ?? 1),
      parameters: [{ type: 'payload', payload: `match_nee:${input.matchId}` }],
    },
  );

  return {
    name: template.template_name,
    language: template.language,
    components,
  };
}

/** Voorbeeldtekst van de template-body met ingevulde variabelen (voor de dialog). */
export function previewInterestTemplate(
  template: WhatsAppTemplateRow,
  input: { firstName: string; vacancyTitle: string; pitch?: string },
): string {
  const bodyText = extractTemplateBodyText(template.components);
  const positional = [input.firstName, input.vacancyTitle, input.pitch ?? ''];
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => sanitizeTemplateParam(positional[Number(n) - 1] ?? '-'));
}
