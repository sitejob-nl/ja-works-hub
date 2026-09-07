/** Money is kept in integer eurocents; provider estimates remain US dollars. */
export const formatAiCreditEuro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

export const formatAiProviderUsd = (dollars: number | null) => dollars == null
  ? 'Onbekend'
  : dollars.toLocaleString('nl-NL', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Reject partial parses ("50abc"), scientific notation and fractions of cents. */
export function parseAiCreditCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const [euros, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const cents = Number(euros) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 2_147_483_647) return null;
  return negative ? -cents : cents;
}

export const aiFeatureLabel = (feature: string) => ({
  cv_analysis: 'Kandidaatdossier analyseren',
  cv_rewrite: 'CV herschrijven',
  vacancy_generate: 'Vacaturetekst schrijven',
  vacancy_skills: 'Vacaturevaardigheden herkennen',
  match_rerank: 'Matches beoordelen',
  recruiter_priorities: 'Recruiterprioriteiten bepalen',
  timesheet_validation: 'Uren controleren',
  validate_timesheets: 'Uren controleren',
  timesheet_vision: 'Urenfoto uitlezen',
  translation: 'Vertalen',
}[feature] ?? feature.replace(/[_-]/g, ' '));

export const aiRequestStatusLabel = (status: string) => ({
  reserved: 'In behandeling',
  succeeded: 'Afgerond',
  failed: 'Mislukt',
  unknown: 'Uitkomst onbekend',
  blocked: 'Geblokkeerd',
}[status] ?? status);

export const aiLedgerKindLabel = (kind: string) => ({
  opening: 'Openingssaldo',
  monthly_grant: 'Maandelijkse aanvulling',
  manual_topup: 'Handmatige bijboeking / correctie',
  usage_charge: 'AI-verbruik',
  legacy_charge: 'Verbruik via eerdere verwerking',
}[kind] ?? kind);

export function formatAiCreditDate(value: string, withTime = false) {
  return new Date(value).toLocaleString('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } as const : {}),
  });
}
