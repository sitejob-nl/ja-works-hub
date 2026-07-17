import { describe, it, expect } from 'vitest';
import { VACANCY_ANSWER_FIELDS, buildVacancyPrefill } from '@/lib/vacancy-generator';

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
