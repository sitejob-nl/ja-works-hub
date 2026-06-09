import type { MatchBreakdown } from '@/lib/matching';

export const scoreBadgeClass: Record<MatchBreakdown['label'], string> = {
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-yellow-100 text-yellow-700 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
};
export const componentLabel: Record<string, string> = {
  skills: 'Vaardigheden',
  certifications: 'Certificaten',
  functionGroup: 'Functiegroep',
  distance: 'Afstand',
  availability: 'Beschikbaarheid',
  reliability: 'Betrouwbaarheid',
  language: 'Taal',
  experience: 'Ervaring',
  languageBonus: 'Taalbonus',
  accommodationBonus: 'Accommodatiebonus',
  licenseBonus: 'Rijbewijsbonus',
};

export const toScorePercent = (score: unknown) => {
  if (typeof score !== 'number') return null;
  return Math.max(0, Math.min(100, score <= 1 ? score * 100 : score));
};

export const getCriticalUnknowns = (breakdown?: Partial<MatchBreakdown> | null) =>
  (breakdown?.missing ?? []).slice(0, 3);

export const getPrimaryMatchIssue = (breakdown?: Partial<MatchBreakdown> | null) => {
  const hardBlock = breakdown?.hardBlocks?.[0];
  if (hardBlock) return { tone: 'red' as const, label: hardBlock };
  const missing = breakdown?.missing?.[0];
  if (missing) return { tone: 'amber' as const, label: missing };
  const positive = breakdown?.positives?.[0];
  if (positive) return { tone: 'green' as const, label: positive };
  return null;
};

export const getDecisionConfidence = (breakdown?: Partial<MatchBreakdown> | null) => {
  if (!breakdown) return { label: 'Nog geen score', className: 'bg-muted text-muted-foreground border-0' };
  if ((breakdown.hardBlocks ?? []).length > 0) return { label: 'Niet direct voorstelbaar', className: 'bg-red-100 text-red-700 border-0' };
  if ((breakdown.missing ?? []).length > 0) return { label: 'Eerst controleren', className: 'bg-amber-100 text-amber-800 border-0' };
  if (breakdown.label === 'groen') return { label: 'Direct voorstelbaar', className: 'bg-stat-green/10 text-stat-green border-0' };
  return { label: 'Recruitercheck nodig', className: 'bg-blue-100 text-blue-700 border-0' };
};

export const getMatchNextActionLabel = (status?: string | null, breakdown?: Partial<MatchBreakdown> | null) => {
  if ((breakdown?.hardBlocks ?? []).length > 0) return 'Blokkade controleren';
  if ((breakdown?.missing ?? []).length > 0 && status !== 'voorgesteld_bij_klant') return 'Open punt uitvragen';
  switch (status) {
    case 'nieuwe_match':
      return 'Kandidaat screenen';
    case 'gescreend':
      return 'Voorstellen voorbereiden';
    case 'voorgesteld':
      return 'Voorstel versturen';
    case 'voorgesteld_bij_klant':
      return 'Klant opvolgen';
    case 'in_gesprek':
      return 'Feedback vastleggen';
    case 'geaccepteerd':
      return 'Plaatsing maken';
    case 'afgewezen':
      return 'Afgerond';
    case 'geplaatst':
      return 'Geplaatst';
    default:
      return 'Volgende actie bepalen';
  }
};
