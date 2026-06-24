import { describe, it, expect } from 'vitest';
import { deriveCallQuestions } from '@/lib/callQuestions';
import type { MatchBreakdown } from '@/lib/matching';

const base: MatchBreakdown = {
  matchPercent: 60,
  label: 'oranje',
  hardBlocks: [],
  positives: [],
  missing: [],
  skillMatches: [],
  certificationMatches: [],
  distance: {},
  componentScores: {},
  reasoning: '',
};

describe('deriveCallQuestions', () => {
  it('geeft niets bij ontbrekende breakdown', () => {
    expect(deriveCallQuestions(null)).toEqual([]);
    expect(deriveCallQuestions(undefined)).toEqual([]);
    expect(deriveCallQuestions(base)).toEqual([]);
  });

  it('maakt een vaardigheden-vraag met de ontbrekende skills', () => {
    const q = deriveCallQuestions({ ...base, missing: ['Ontbrekende vaardigheden: MIG/MAG lassen, TIG lassen'] });
    expect(q).toHaveLength(1);
    expect(q[0]).toContain('MIG/MAG lassen, TIG lassen');
    expect(q[0].toLowerCase()).toContain('ervaring');
  });

  it('maakt een certificaat-vraag', () => {
    const q = deriveCallQuestions({ ...base, missing: ['Ontbrekende certificaten: VCA'] });
    expect(q[0]).toContain('VCA');
    expect(q[0].toLowerCase()).toContain('certificaat');
  });

  it('herkent rijbewijs, afstand en beschikbaarheid', () => {
    const q = deriveCallQuestions({
      ...base,
      missing: [
        'Rijbewijs gevraagd (niet geregistreerd bij kandidaat)',
        'Afstand nog controleren (geen coördinaten)',
        'Beschikbaarheid nog controleren',
      ],
    });
    expect(q).toHaveLength(3);
    expect(q.join(' ').toLowerCase()).toContain('rijbewijs');
    expect(q.join(' ').toLowerCase()).toContain('reisafstand');
    expect(q.join(' ').toLowerCase()).toContain('beschikbaarheid');
  });

  it('dedupliceert en neemt hardBlocks mee', () => {
    const q = deriveCallQuestions({
      ...base,
      missing: ['Ontbrekende certificaten: VCA', 'Ontbrekende certificaten: VCA'],
      hardBlocks: ['Mist certificaat: VCA'],
    });
    // 1 cert-vraag (gededupliceerd) + 1 hardBlock-vraag
    expect(q).toHaveLength(2);
    expect(q.some((x) => x.includes('harde eis'))).toBe(true);
  });
});
