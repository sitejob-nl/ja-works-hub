// Pseudonimiseert CV-tekst vóór verzending naar externe LLM-VPS.
// Doel: minimaliseren van persoonsgegevens-doorgifte (AVG art. 5).
//
// Vervangt:
//   - kandidaat-volledige naam → [KANDIDAAT]
//   - emailadressen → [EMAIL]
//   - NL telefoonnummers (06, 0XX, +31) → [TELEFOON]
//   - BSN (9 cijfers met 11-proef) → [BSN]
//   - IBAN (NLxx + 14-30 alfanum) → [IBAN]
//
// Returnt zowel de gestripte tekst als een meta-object met counts.

export interface PseudonymizeResult {
  text: string;
  meta: {
    name: number;
    email: number;
    phone: number;
    bsn: number;
    iban: number;
  };
}

const NAME_TOKENS_MIN_LEN = 2;

function bsnIsValid(digits: string): boolean {
  if (digits.length !== 9) return false;
  const nums = digits.split('').map(Number);
  // 11-proef: som(d1*9 + d2*8 + ... + d8*2 - d9*1) % 11 === 0
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += nums[i] * (9 - i);
  sum -= nums[8];
  return sum % 11 === 0;
}

export function pseudonymizeCv(
  rawText: string,
  candidate: { first_name?: string | null; last_name?: string | null }
): PseudonymizeResult {
  let text = rawText;
  const meta = { name: 0, email: 0, phone: 0, bsn: 0, iban: 0 };

  // 1. Volledige naam (case-insensitive) — eerst de combinatie, dan losse onderdelen
  const tokens: string[] = [];
  if (candidate.first_name && candidate.last_name) {
    tokens.push(`${candidate.first_name} ${candidate.last_name}`);
  }
  for (const part of [candidate.first_name, candidate.last_name]) {
    if (!part) continue;
    for (const word of part.split(/\s+/)) {
      if (word.length >= NAME_TOKENS_MIN_LEN) tokens.push(word);
    }
  }
  // Sorteer op lengte desc zodat "Jan van der Berg" vóór "Jan" gematcht wordt
  tokens.sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const escaped = token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    const before = text.length;
    text = text.replace(re, '[KANDIDAAT]');
    if (text.length !== before) meta.name += 1;
  }

  // 2. Email
  text = text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, () => {
    meta.email += 1;
    return '[EMAIL]';
  });

  // 3. Telefoon (NL)
  // +31 6 12345678 / +31612345678 / 06-12345678 / 06 12 34 56 78 / 0612345678 / (020) 1234567
  text = text.replace(
    /(?:\+31|0031|0)(?:[\s-]?\d){8,10}/g,
    (match) => {
      // Alleen vervang als minimaal 9 cijfers totaal (anders te kort voor NL nummer)
      const digits = match.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 11) return match;
      meta.phone += 1;
      return '[TELEFOON]';
    }
  );

  // 4. BSN (9 cijfers met 11-proef)
  text = text.replace(/\b\d{9}\b/g, (match) => {
    if (bsnIsValid(match)) {
      meta.bsn += 1;
      return '[BSN]';
    }
    return match;
  });

  // 5. IBAN (NL + 2 cijfers + 4 letters bank + 10 cijfers)
  text = text.replace(/\bNL\d{2}[A-Z]{4}\d{10}\b/gi, () => {
    meta.iban += 1;
    return '[IBAN]';
  });

  return { text, meta };
}
