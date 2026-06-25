import { describe, expect, it } from 'vitest';
// Grounding-filter is server-side en gedeeld; we testen 'm hier rechtstreeks (pure functie).
import { resolveHardSkills } from '../../supabase/functions/_shared/cv-write.ts';

// Achtergrond: Gemini tagde op een pure (Engelstalige) chauffeurs-CV ten onrechte
// "MIG/MAG lassen" — een term uit de org-vaardighedenlijst die nergens in het dossier staat.
// Het geverifieerde pad laat het model per hard skill een letterlijk bewijsfragment citeren;
// resolveHardSkills behoudt alleen vaardigheden waarvan dat fragment echt in het dossier voorkomt.
describe('cv grounding — resolveHardSkills', () => {
  const dossier =
    'Jose Manuel Truck driver, C, CE. Handled daily logistics and route planning. Lorry Driver.';

  it('dropt een hard skill waarvan het bewijs niet in het dossier staat (hallucinatie)', () => {
    const { terms, dropped } = resolveHardSkills(
      [
        { vaardigheid: 'chauffeur', bron: 'cv', bewijs: 'Truck driver' },
        { vaardigheid: 'logistiek', bron: 'cv', bewijs: 'daily logistics' },
        { vaardigheid: 'MIG/MAG lassen', bron: 'cv', bewijs: 'MIG/MAG lassen' },
      ],
      dossier,
    );
    expect(terms).toEqual(['chauffeur', 'logistiek']);
    expect(dropped).toEqual(['MIG/MAG lassen']);
  });

  it('verifieert taal-onafhankelijk: NL-term met bewijs uit Engelstalig dossier blijft staan', () => {
    const { terms } = resolveHardSkills(
      [{ vaardigheid: 'heftruck', bron: 'cv', bewijs: 'forklift operator' }],
      'Worked 3 years as a forklift operator in a warehouse.',
    );
    expect(terms).toEqual(['heftruck']);
  });

  it('dropt een vaardigheid met leeg of te kort bewijs', () => {
    const { terms, dropped } = resolveHardSkills(
      [
        { vaardigheid: 'VCA', bron: 'cv', bewijs: '' },
        { vaardigheid: 'TIG lassen', bron: 'cv', bewijs: 'x' },
      ],
      dossier,
    );
    expect(terms).toEqual([]);
    expect(dropped).toEqual(['VCA', 'TIG lassen']);
  });

  it('back-compat: plain strings (legacy / VPS) blijven ongefilterd', () => {
    const { terms, dropped } = resolveHardSkills(['chauffeur', 'logistiek'], dossier);
    expect(terms).toEqual(['chauffeur', 'logistiek']);
    expect(dropped).toEqual([]);
  });

  it('zonder dossiertekst kan niet geverifieerd worden → alles behouden (geen regressie)', () => {
    const { terms, dropped } = resolveHardSkills(
      [
        { vaardigheid: 'chauffeur', bron: 'cv', bewijs: 'Truck driver' },
        { vaardigheid: 'MIG/MAG lassen', bron: 'cv', bewijs: 'iets' },
      ],
      undefined,
    );
    expect(terms).toEqual(['chauffeur', 'MIG/MAG lassen']);
    expect(dropped).toEqual([]);
  });

  it('dedupliceert en negeert lege/ongeldige items', () => {
    const { terms } = resolveHardSkills(
      [
        { vaardigheid: 'chauffeur', bron: 'cv', bewijs: 'Truck driver' },
        { vaardigheid: 'chauffeur', bron: 'cv', bewijs: 'Lorry Driver' },
        { vaardigheid: '', bron: 'cv', bewijs: 'Truck driver' },
        null,
      ],
      dossier,
    );
    expect(terms).toEqual(['chauffeur']);
  });
});
