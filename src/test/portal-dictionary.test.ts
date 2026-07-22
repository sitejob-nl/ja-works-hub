import { describe, it, expect } from 'vitest';
import { PORTAL_DICTIONARY_EN } from '@/lib/portal-dictionary';

/** Zelfde normalisatie als TranslationContext toepast vóór het opzoeken. */
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('portaal-woordenboek', () => {
  it('heeft sleutels die exact matchen op de genormaliseerde DOM-tekst', () => {
    // Een sleutel met dubbele spaties of randspaties wordt nooit gevonden, want de
    // vertaler zoekt op de genormaliseerde tekst. Die fout is anders onzichtbaar.
    const kapot = Object.keys(PORTAL_DICTIONARY_EN).filter((k) => k !== normalize(k));
    expect(kapot).toEqual([]);
  });

  it('heeft voor elke sleutel een niet-lege vertaling', () => {
    const leeg = Object.entries(PORTAL_DICTIONARY_EN)
      .filter(([, v]) => !v || !v.trim())
      .map(([k]) => k);
    expect(leeg).toEqual([]);
  });

  it('bevat de kernnavigatie van het portaal', () => {
    expect(PORTAL_DICTIONARY_EN['Uren']).toBe('Hours');
    expect(PORTAL_DICTIONARY_EN['Huisvesting']).toBe('Housing');
    expect(PORTAL_DICTIONARY_EN['Mijn uren deze week']).toBe('My hours this week');
  });
});
