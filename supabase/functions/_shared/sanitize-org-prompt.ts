// Sanitization van per-organisatie prompt-addenda.
//
// De org-admin geeft vrije tekst die we als context aan de LLM doorgeven.
// We vertrouwen de admin (RLS waarborgt dat alleen admins van een org dit
// kunnen zetten), maar we beschermen wél tegen:
//
// 1. Control tokens van LLM-providers die de structuur kunnen breken
//    (Llama [INST], Anthropic-style XML, ChatML <|im_start|>, etc.)
// 2. Pogingen om de hardcoded schema-instructies te overrulen
// 3. Excessief lange input (DoS / cost-attack)
// 4. Null bytes / non-printable control chars
//
// Dit is GEEN bescherming tegen een kwaadaardige admin van eigen org —
// dat is hun eigen LLM-call binnen hun eigen org-context. We voorkomen
// alleen dat ze per ongeluk de structurele integriteit van het Cloud-pad
// kapotmaken (bv. door content uit een Reddit-post te plakken).

export const ORG_PROMPT_MAX_LENGTH = 2000;

// Patronen die WAARSCHIJNLIJK control-tokens of role-spoofing zijn.
// Lijst is conservatief — als de admin echt iets vergelijkbaars wil zeggen,
// kan hij het in normale woorden formuleren.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // ChatML / Anthropic-style control tokens
  { pattern: /<\|[^|]*\|>/g, replacement: "" },
  // Llama instruction wrapping
  { pattern: /\[\/?INST\]/gi, replacement: "" },
  { pattern: /<<\/?SYS>>/gi, replacement: "" },
  // XML role-tags die op message-rollen lijken
  { pattern: /<\/?(system|assistant|human|user)\b[^>]*>/gi, replacement: "" },
  // Anthropic-document-tags (kunnen content-injection bewerken)
  { pattern: /<\/?(document|documents|source)\b[^>]*>/gi, replacement: "" },
  // Pogingen om het tool-schema te bypassen
  { pattern: /\btool[\s_-]*choice\b/gi, replacement: "[gefilterd]" },
  { pattern: /\btool[\s_-]*use\b/gi, replacement: "[gefilterd]" },
  { pattern: /\binput[\s_-]*schema\b/gi, replacement: "[gefilterd]" },
  // Klassieke prompt-injection signalen (defensive defaults)
  { pattern: /ignore (all |any |the )?(previous|prior|above)\s+instructions/gi, replacement: "[gefilterd]" },
  { pattern: /forget (all |any |the )?(previous|prior|above)\s+instructions/gi, replacement: "[gefilterd]" },
  { pattern: /disregard (all |any |the )?(previous|prior|above)\s+instructions/gi, replacement: "[gefilterd]" },
];

// Strip null bytes en non-printable control chars.
// Behoud: \t (0x09), \n (0x0A), \r (0x0D)
function stripControlChars(input: string): { text: string; removed: number } {
  let output = "";
  let removed = 0;
  for (const char of input) {
    const code = char.charCodeAt(0);
    const isDisallowedControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
    if (isDisallowedControl) {
      removed += 1;
      continue;
    }
    output += char;
  }
  return { text: output, removed };
}

export interface SanitizeResult {
  text: string;
  removed: number; // hoeveel matches we hebben weggeknipt
  truncated: boolean;
}

export function sanitizeOrgPrompt(input: string | null | undefined): SanitizeResult {
  if (!input) return { text: "", removed: 0, truncated: false };

  let text = String(input);
  let removed = 0;

  // 1. Strip null bytes en non-printable control chars
  const stripped = stripControlChars(text);
  text = stripped.text;
  removed += stripped.removed;

  // 2. Strip forbidden patterns
  for (const { pattern, replacement } of FORBIDDEN_PATTERNS) {
    text = text.replace(pattern, () => {
      removed += 1;
      return replacement;
    });
  }

  // 3. Trim
  text = text.trim();

  // 4. Cap lengte
  let truncated = false;
  if (text.length > ORG_PROMPT_MAX_LENGTH) {
    text = text.slice(0, ORG_PROMPT_MAX_LENGTH);
    truncated = true;
  }

  return { text, removed, truncated };
}
