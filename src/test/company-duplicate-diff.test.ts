import { describe, expect, it } from 'vitest';
import {
  analyzeGroup,
  diffFields,
  namesCompatible,
  normalizeDigits,
  normalizeIban,
  normalizeText,
  suggestSurvivor,
  type DupCompany,
} from '@/lib/company-duplicate-diff';

const row = (over: Partial<DupCompany> & { company_id: string }): DupCompany => ({
  name: null,
  kvk_number: null,
  address_street: null,
  address_postal: null,
  address_city: null,
  phone: null,
  email: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('normalisatie', () => {
  it('haalt accenten, hoofdletters en leestekens weg', () => {
    expect(normalizeText('Café Vloerwerken B.V.')).toBe('cafe vloerwerken b v');
    expect(normalizeText(null)).toBe('');
  });

  it('houdt alleen de cijfers over voor KVK/telefoon', () => {
    expect(normalizeDigits('12.345.678')).toBe('12345678');
    expect(normalizeDigits('+31 40 123 45 67')).toBe('31401234567');
  });

  it('normaliseert IBAN op hoofdletters zonder spaties', () => {
    expect(normalizeIban('nl91 abna 0417 1643 00')).toBe('NL91ABNA0417164300');
  });
});

describe('namesCompatible', () => {
  it('accepteert een rechtsvorm-toevoeging', () => {
    expect(namesCompatible([
      row({ company_id: 'a', name: 'Jansen Bouw' }),
      row({ company_id: 'b', name: 'Jansen Bouw B.V.' }),
    ])).toBe(true);
  });

  it('wijst twee verschillende bedrijven af', () => {
    expect(namesCompatible([
      row({ company_id: 'a', name: 'De Vries Transport' }),
      row({ company_id: 'b', name: 'Bakker Logistiek' }),
    ])).toBe(false);
  });

  it('wijst af zodra één profiel geen bruikbare naam heeft', () => {
    expect(namesCompatible([
      row({ company_id: 'a', name: 'Jansen Bouw' }),
      row({ company_id: 'b', name: null }),
    ])).toBe(false);
  });
});

describe('diffFields', () => {
  it('noemt een veld dat maar aan één kant is ingevuld geen verschil', () => {
    const diffs = diffFields([
      row({ company_id: 'a', name: 'Jansen Bouw', email: 'info@jansenbouw.nl' }),
      row({ company_id: 'b', name: 'Jansen Bouw', email: null }),
    ]);
    expect(diffs).toEqual([]);
  });

  it('meldt een veld dat aan beide kanten anders is ingevuld', () => {
    const diffs = diffFields([
      row({ company_id: 'a', name: 'Jansen Bouw', address_city: 'Helmond' }),
      row({ company_id: 'b', name: 'Jansen Bouw', address_city: 'Eindhoven' }),
    ]);
    expect(diffs.map((d) => d.key)).toEqual(['address_city']);
    expect(diffs[0].values.map((v) => v.display)).toEqual(['Helmond', 'Eindhoven']);
  });

  it('negeert verschil in hoofdletters, punten en spaties in het KVK-nummer', () => {
    const diffs = diffFields([
      row({ company_id: 'a', kvk_number: '12345678' }),
      row({ company_id: 'b', kvk_number: '12.345.678' }),
    ]);
    expect(diffs).toEqual([]);
  });
});

describe('analyzeGroup', () => {
  it('merkt een groep zonder botsingen aan als samen te voegen', () => {
    const result = analyzeGroup([
      row({ company_id: 'a', name: 'Jansen Bouw', email: 'a@jansenbouw.nl' }),
      row({ company_id: 'b', name: 'Jansen Bouw B.V.' }),
    ], 'Zelfde bedrijfsnaam');
    expect(result.verdict).toBe('mergeable');
    expect(result.blockingDiffs).toEqual([]);
  });

  it('stuurt een botsend KVK-nummer naar handmatig', () => {
    const result = analyzeGroup([
      row({ company_id: 'a', name: 'Jansen Bouw', kvk_number: '12345678' }),
      row({ company_id: 'b', name: 'Jansen Bouw', kvk_number: '87654321' }),
    ], 'Zelfde bedrijfsnaam');
    expect(result.verdict).toBe('review');
    expect(result.blockingDiffs.map((d) => d.key)).toEqual(['kvk_number']);
  });

  it('stuurt een botsende IBAN naar handmatig', () => {
    const result = analyzeGroup([
      row({ company_id: 'a', name: 'Jansen Bouw', iban: 'NL91ABNA0417164300' }),
      row({ company_id: 'b', name: 'Jansen Bouw', iban: 'NL02RABO0123456789' }),
    ], 'Zelfde adres');
    expect(result.verdict).toBe('review');
    expect(result.blockingDiffs.map((d) => d.key)).toEqual(['iban']);
  });

  it('markeert een gedeeld adres met onverenigbare namen als geen duplicaat', () => {
    const result = analyzeGroup([
      row({ company_id: 'a', name: 'De Vries Transport' }),
      row({ company_id: 'b', name: 'Bakker Logistiek' }),
    ], 'Zelfde adres');
    expect(result.verdict).toBe('not-duplicate');
  });

  it('een KVK-match blijft samen te voegen ondanks een gewijzigde handelsnaam', () => {
    const result = analyzeGroup([
      row({ company_id: 'a', name: 'Jansen Bouw', kvk_number: '12345678' }),
      row({ company_id: 'b', name: 'Jansen Groep Holding', kvk_number: '12345678' }),
    ], 'Zelfde KVK-nummer');
    expect(result.verdict).toBe('mergeable');
  });
});

describe('suggestSurvivor', () => {
  it('kiest het actieve profiel', () => {
    const survivor = suggestSurvivor([
      row({ company_id: 'inactief', name: 'Jansen Bouw', is_active: false, email: 'a@b.nl', phone: '0401234567' }),
      row({ company_id: 'actief', name: 'Jansen Bouw', is_active: true }),
    ]);
    expect(survivor).toBe('actief');
  });

  it('kiest anders het meest gevulde profiel', () => {
    const survivor = suggestSurvivor([
      row({ company_id: 'kaal', name: 'Jansen Bouw' }),
      row({ company_id: 'vol', name: 'Jansen Bouw', email: 'a@b.nl', phone: '0401234567', address_city: 'Helmond' }),
    ]);
    expect(survivor).toBe('vol');
  });

  it('kiest bij gelijke stand het nieuwste profiel', () => {
    const survivor = suggestSurvivor([
      row({ company_id: 'oud', name: 'Jansen Bouw', created_at: '2026-01-01T00:00:00Z' }),
      row({ company_id: 'nieuw', name: 'Jansen Bouw', created_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(survivor).toBe('nieuw');
  });
});
