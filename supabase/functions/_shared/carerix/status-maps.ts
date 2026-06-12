// Status mappings: Carerix value (lowercased) → JA Werkt enum value.

const candidateStatusMap = new Map<string, string>([
  ['nieuw', 'nieuw'],
  ['new', 'nieuw'],
  ['in behandeling', 'in_behandeling'],
  ['in progress', 'in_behandeling'],
  ['beschikbaar', 'beschikbaar'],
  ['available', 'beschikbaar'],
  // JA Werkt Carerix-tenant statussen (toStatusNode.value, scan 2026-06-12):
  // "Nieuw" 1423× / "Werkzoekend" 475× / "Geplaatst" 86× / "Niet bemiddelbaar" 11×
  ['werkzoekend', 'werkzoekend'],
  ['niet bemiddelbaar', 'niet_beschikbaar'],
  ['geplaatst', 'geplaatst'],
  ['placed', 'geplaatst'],
  ['inactief', 'inactief'],
  ['inactive', 'inactief'],
  ['niet beschikbaar', 'niet_beschikbaar'],
  ['afgewezen', 'afgewezen'],
  ['rejected', 'afgewezen'],
  ['uitgeschreven', 'uitgeschreven'],
  ['archived', 'inactief'],
]);

const vacancyStatusMap = new Map<string, string>([
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

const placementStatusMap = new Map<string, string>([
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

const documentTypeMap = new Map<string, string>([
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

const cvKeywords = ['cv', 'curriculum vitae', 'resume', 'cvtag'];

export function mapStatus(
  map: Map<string, string>,
  raw: string | undefined | null,
  fallback: string,
): string {
  if (!raw) return fallback;
  return map.get(raw.toLowerCase().trim()) ?? fallback;
}

export const statusMaps = {
  candidate: candidateStatusMap,
  vacancy: vacancyStatusMap,
  placement: placementStatusMap,
};

export function mapDocumentType(raw: string | undefined | null): string {
  if (!raw) return 'overig';
  return documentTypeMap.get(raw.toLowerCase().trim()) ?? 'overig';
}

export function isCvType(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return cvKeywords.some((kw) => lower.includes(kw));
}

export function mapGender(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'm' || lower === 'male' || lower === 'man') return 'man';
  if (lower === 'v' || lower === 'f' || lower === 'female' || lower === 'vrouw') return 'vrouw';
  return 'anders';
}
