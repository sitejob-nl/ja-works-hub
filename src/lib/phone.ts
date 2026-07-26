export type CandidatePhoneFields = {
  phone: string;
  phone_nl: string;
};

const cleanPhone = (value: string | null | undefined) =>
  (value ?? '').trim().replace(/\s+/g, ' ');

export function normalizeDutchMobilePhone(value: string | null | undefined): string {
  const raw = cleanPhone(value);
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (/^06\d{8}$/.test(digits)) return `+31${digits.slice(1)}`;
  if (/^316\d{8}$/.test(digits)) return `+${digits}`;
  if (/^00316\d{8}$/.test(digits)) return `+31${digits.slice(4)}`;
  if (/^6\d{8}$/.test(digits)) return `+31${digits}`;

  return '';
}

/**
 * Nummer omzetten naar het formaat dat `wa.me/` verwacht: alleen cijfers, mét landcode.
 *
 * Alleen de niet-cijfers strippen is niet genoeg — `06-12345678` wordt dan `0612345678`,
 * en dat leest WhatsApp als een onbekend nummer (landcode 06...). Een Nederlands nummer
 * zonder landcode moet dus eerst de nul kwijt en er `31` voor krijgen.
 *
 * Kan de landcode niet met zekerheid worden bepaald, dan geeft dit `null` terug: liever
 * geen WhatsApp-knop dan een knop naar een willekeurig ander nummer.
 */
export function toWhatsAppNumber(value: string | null | undefined): string | null {
  const raw = cleanPhone(value);
  if (!raw) return null;

  // Nederlands mobiel in welke schrijfwijze dan ook (06…, +316…, 00316…, 6…).
  const dutchMobile = normalizeDutchMobilePhone(raw);
  if (dutchMobile) return dutchMobile.replace(/\D/g, '');

  const hasPlus = raw.trimStart().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Internationaal genoteerd: +CC… of 00CC…
  if (hasPlus) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('00')) {
    const withoutPrefix = digits.slice(2);
    return withoutPrefix.length >= 8 ? withoutPrefix : null;
  }

  // Nationaal genoteerd met één voorloopnul: Nederlands vast of niet-mobiel nummer.
  if (digits.startsWith('0')) {
    const subscriber = digits.slice(1);
    return subscriber.length === 9 ? `31${subscriber}` : null;
  }

  // Kale cijfers die al met de Nederlandse landcode beginnen.
  if (digits.startsWith('31') && digits.length === 11) return digits;

  return null;
}

export function normalizeCandidatePhone(value: string | null | undefined): CandidatePhoneFields {
  const raw = cleanPhone(value);
  if (!raw) return { phone: '', phone_nl: '' };

  const phoneNl = normalizeDutchMobilePhone(raw);
  if (phoneNl) return { phone: '', phone_nl: phoneNl };

  return { phone: raw, phone_nl: '' };
}

export function mergeCandidatePhoneFields(input: {
  phone?: string | null;
  phone_nl?: string | null;
}): CandidatePhoneFields {
  const phoneNl = normalizeDutchMobilePhone(input.phone_nl);
  if (phoneNl) return { phone: cleanPhone(input.phone), phone_nl: phoneNl };

  const normalizedNlInput = normalizeCandidatePhone(input.phone_nl);
  if (normalizedNlInput.phone && !cleanPhone(input.phone)) {
    return { phone: normalizedNlInput.phone, phone_nl: '' };
  }

  const normalized = normalizeCandidatePhone(input.phone);
  if (normalized.phone_nl) return normalized;

  return {
    phone: cleanPhone(input.phone),
    phone_nl: cleanPhone(input.phone_nl),
  };
}
