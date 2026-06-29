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
