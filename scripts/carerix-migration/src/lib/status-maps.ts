// Carerix status values → JA Werkt enum values
// Keys are lowercase for case-insensitive matching

export const candidateStatusMap = new Map<string, string>([
  ['nieuw', 'nieuw'],
  ['new', 'nieuw'],
  ['in behandeling', 'in_behandeling'],
  ['in progress', 'in_behandeling'],
  ['beschikbaar', 'beschikbaar'],
  ['available', 'beschikbaar'],
  ['geplaatst', 'geplaatst'],
  ['placed', 'geplaatst'],
  ['inactief', 'inactief'],
  ['inactive', 'inactief'],
  ['niet beschikbaar', 'inactief'],
  ['afgewezen', 'afgewezen'],
  ['rejected', 'afgewezen'],
  ['uitgeschreven', 'inactief'],
  ['archived', 'inactief'],
]);

export const vacancyStatusMap = new Map<string, string>([
  ['open', 'open'],
  ['actief', 'open'],
  ['active', 'open'],
  ['on hold', 'on_hold'],
  ['wachtend', 'on_hold'],
  ['vervuld', 'vervuld'],
  ['filled', 'vervuld'],
  ['gesloten', 'gesloten'],
  ['closed', 'gesloten'],
  ['gearchiveerd', 'gesloten'],
  ['archived', 'gesloten'],
]);

export const placementStatusMap = new Map<string, string>([
  ['gepland', 'gepland'],
  ['planned', 'gepland'],
  ['actief', 'actief'],
  ['active', 'actief'],
  ['lopend', 'actief'],
  ['running', 'actief'],
  ['afgerond', 'afgerond'],
  ['completed', 'afgerond'],
  ['beeindigd', 'afgerond'],
  ['ended', 'afgerond'],
  ['voortijdig beeindigd', 'voortijdig_beeindigd'],
  ['cancelled', 'voortijdig_beeindigd'],
  ['voortijdig beëindigd', 'voortijdig_beeindigd'],
]);

export const documentTypeMap = new Map<string, string>([
  ['cv', 'overig'],
  ['curriculum vitae', 'overig'],
  ['resume', 'overig'],
  ['id', 'id_bewijs'],
  ['paspoort', 'id_bewijs'],
  ['passport', 'id_bewijs'],
  ['identiteitsbewijs', 'id_bewijs'],
  ['identity', 'id_bewijs'],
  ['rijbewijs', 'rijbewijs'],
  ['drivers license', 'rijbewijs'],
  ["driver's license", 'rijbewijs'],
  ['certificaat', 'certificaat'],
  ['certificate', 'certificaat'],
  ['diploma', 'certificaat'],
  ['contract', 'contract'],
  ['arbeidsovereenkomst', 'contract'],
  ['bankbewijs', 'bankbewijs'],
  ['bank statement', 'bankbewijs'],
  ['loonstrook', 'loonstrook'],
  ['payslip', 'loonstrook'],
  ['reglement', 'reglement'],
]);

// Check if an attachment type represents a CV
const cvKeywords = ['cv', 'curriculum vitae', 'resume', 'cvtag'];

export function isCvType(typeValue: string): boolean {
  const lower = typeValue.toLowerCase();
  return cvKeywords.some(kw => lower.includes(kw));
}

export function mapStatus(
  statusMap: Map<string, string>,
  carerixValue: string | undefined | null,
  defaultValue: string,
): string {
  if (!carerixValue) return defaultValue;
  return statusMap.get(carerixValue.toLowerCase().trim()) || defaultValue;
}

export function mapDocumentType(typeValue: string | undefined | null): string {
  if (!typeValue) return 'overig';
  return documentTypeMap.get(typeValue.toLowerCase().trim()) || 'overig';
}
