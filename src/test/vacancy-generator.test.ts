import { describe, it, expect } from 'vitest';
import { VACANCY_ANSWER_FIELDS, buildVacancyPrefill, mapTermsToCatalog } from '@/lib/vacancy-generator';

describe('buildVacancyPrefill', () => {
  it('vult functietitel, plaats en werkzaamheden uit de vacature', () => {
    const out = buildVacancyPrefill(
      { title: 'CNC Frezer', location: 'Eindhoven', description: 'Metaal frezen op maat' },
      null,
    );
    expect(out.functietitel).toBe('CNC Frezer');
    expect(out.plaats).toBe('Eindhoven');
    expect(out.werkzaamheden).toBe('Metaal frezen op maat');
  });

  it('gebruikt hourly_rate voor salaris, anders de salarisrange', () => {
    expect(buildVacancyPrefill({ hourly_rate: 18.5 }).salaris_uur).toBe('€18,5 per uur');
    expect(buildVacancyPrefill({ salary_min: 17, salary_max: 20 }).salaris_uur).toBe('€17 – €20');
    expect(buildVacancyPrefill({}).salaris_uur).toBe('');
  });

  it('combineert skills + certificaten in harde_eisen en zet rijbewijs bij certificaten', () => {
    const out = buildVacancyPrefill({
      required_skills: ['lassen', 'tekening lezen'],
      required_certifications: ['VCA'],
      requires_drivers_license: true,
    });
    expect(out.harde_eisen).toBe('lassen, tekening lezen, VCA');
    expect(out.certificaten_rijbewijzen).toBe('VCA, rijbewijs vereist');
  });

  it('houdt opdrachtgevercontext intern beschikbaar maar laat publieke gaten leeg', () => {
    const out = buildVacancyPrefill(
      { title: 'Lasser' },
      { name: 'Acme Metaal BV', website: 'acme.nl', kvk_number: '12345678', cao: 'Metaal en Techniek' },
    );
    expect(out.opdrachtgever_naam).toBe('Acme Metaal BV');
    expect(out.opdrachtgever_web_kvk).toBe('acme.nl · KvK 12345678');
    expect(out.toeslagen_vergoedingen).toBe('Cao: Metaal en Techniek');
    // Gaten die de recruiter zelf moet invullen blijven leeg:
    expect(out.werkweek).toBe('');
    expect(out.taaleisen).toBe('');
    expect(out.zware_kanten).toBe('');
  });

  it('levert voor elk van de 16 masterprompt-velden een sleutel', () => {
    const out = buildVacancyPrefill({ title: 'X' });
    for (const field of VACANCY_ANSWER_FIELDS) {
      expect(out).toHaveProperty(field.key);
    }
    expect(VACANCY_ANSWER_FIELDS).toHaveLength(16);
  });
});

describe('mapTermsToCatalog', () => {
  const catalog = [
    'MIG-MAG lassen', 'Heftruck', 'VCA', 'CE rijbewijs', 'Technisch tekening lezen',
    'Ploegendiensten', 'Werken in ploegendienst', 'Metaalbewerking', 'CO2 lassen',
    'Communicatie Nederlands en Engels', 'Excel',
  ];

  it('matcht woordvarianten via token-prefix (technische → Technisch, ploegendienst → Ploegendiensten)', () => {
    const out = mapTermsToCatalog(
      ['Technische tekening kunnen lezen', '2-ploegendienst metaal'],
      catalog,
    );
    expect(out).toContain('Technisch tekening lezen');
    expect(out).toContain('Ploegendiensten');
    expect(out).toContain('Werken in ploegendienst'); // werken/in zijn stopwoorden
    expect(out).toContain('Metaalbewerking'); // metaal → prefix van metaalbewerking
  });

  it('matcht hele-zin-substring (VCA in "VCA-certificaat")', () => {
    expect(mapTermsToCatalog(['VCA-certificaat verplicht'], catalog)).toContain('VCA');
  });

  it('geeft nooit termen terug die niet in de catalogus staan', () => {
    const out = mapTermsToCatalog(['Ervaring met CNC-frezen', 'Fanuc besturing'], catalog);
    for (const s of out) expect(catalog).toContain(s);
    expect(out).not.toContain('CNC-frezen');
  });

  it('mapt "Rijbewijs B" niet op "CE rijbewijs" (alle tokens vereist)', () => {
    expect(mapTermsToCatalog(['Rijbewijs B'], catalog)).not.toContain('CE rijbewijs');
  });

  it('vereist álle betekenisvolle tokens (CO2 lassen matcht niet op alleen "lassen")', () => {
    expect(mapTermsToCatalog(['Ervaring met lassen'], catalog)).not.toContain('CO2 lassen');
    expect(mapTermsToCatalog(['CO2 lassen van dunne plaat'], catalog)).toContain('CO2 lassen');
  });

  it('is leeg bij lege input', () => {
    expect(mapTermsToCatalog([], catalog)).toEqual([]);
    expect(mapTermsToCatalog(['', '  '], catalog)).toEqual([]);
  });
});
