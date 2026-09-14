// Schrijfwijze van de Nederlandse kentekenseries (geen RDW-registratiecontrole).
// https://www.rdw.nl/de-kentekenplaat/overzicht-van-kentekenseries
const SERIES = [
  /^([A-Z]{2})(\d{2})(\d{2})$/, /^(\d{2})(\d{2})([A-Z]{2})$/,
  /^(\d{2})([A-Z]{2})(\d{2})$/, /^([A-Z]{2})(\d{2})([A-Z]{2})$/,
  /^([A-Z]{2})([A-Z]{2})(\d{2})$/, /^(\d{2})([A-Z]{2})([A-Z]{2})$/,
  /^(\d{2})([A-Z]{3})(\d)$/, /^(\d)([A-Z]{3})(\d{2})$/,
  /^([A-Z]{2})(\d{3})([A-Z])$/, /^([A-Z])(\d{3})([A-Z]{2})$/,
  /^([A-Z]{3})(\d{2})([A-Z])$/, /^([A-Z])(\d{2})([A-Z]{3})$/,
  /^(\d)([A-Z]{2})(\d{3})$/, /^(\d{3})([A-Z]{2})(\d)$/,
];

/** Negeert alleen spaties en streepjes; andere tekens nooit stil wegpoetsen. */
export function formatLicensePlate(value: string): string | null {
  const compact = value.toUpperCase().replace(/[\s-]/g, '');
  for (const series of SERIES) {
    const match = compact.match(series);
    if (match) return match.slice(1).join('-');
  }
  return null;
}

export const LICENSE_PLATE_HINT = 'Vul een Nederlands kenteken in, bijvoorbeeld 2-TLH-29. Spaties en streepjes worden automatisch aangepast.';

export function requireLicensePlate(value: string): string {
  const formatted = formatLicensePlate(value);
  if (!formatted) throw new Error(LICENSE_PLATE_HINT);
  return formatted;
}
