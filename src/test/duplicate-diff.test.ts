import { describe, expect, it } from 'vitest';
import {
  analyzeGroup,
  diffFields,
  namesCompatible,
  normalizePhone,
  normalizeText,
  suggestSurvivor,
  type DupCandidate,
} from '@/lib/duplicate-diff';

const row = (over: Partial<DupCandidate> & { candidate_id: string }): DupCandidate => ({
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  date_of_birth: null,
  status: null,
  created_at: '2026-01-01T00:00:00Z',
  has_employee: false,
  ...over,
});

describe('normalisatie', () => {
  it('haalt accenten, hoofdletters en leestekens weg', () => {
    expect(normalizeText('José-María')).toBe('jose maria');
    expect(normalizeText('  Daniel  ')).toBe('daniel');
    expect(normalizeText(null)).toBe('');
  });

  it('vergelijkt telefoonnummers op de laatste negen cijfers', () => {
    expect(normalizePhone('+31 6 12345678')).toBe(normalizePhone('0612345678'));
    expect(normalizePhone('06-1234 5678')).toBe('612345678');
  });
});

describe('namesCompatible', () => {
  it('accepteert een extra voornaam', () => {
    expect(namesCompatible([
      row({ candidate_id: 'a', first_name: 'Adrian', last_name: 'Bucsa' }),
      row({ candidate_id: 'b', first_name: 'Adrian Ilie', last_name: 'Bucsa' }),
    ])).toBe(true);
  });

  it('accepteert alleen een verschil in accent of spatie', () => {
    expect(namesCompatible([
      row({ candidate_id: 'a', first_name: 'Daniel ', last_name: 'Cárdenas' }),
      row({ candidate_id: 'b', first_name: 'Daniel', last_name: 'Cardenas' }),
    ])).toBe(true);
  });

  it('wijst twee verschillende mensen af', () => {
    expect(namesCompatible([
      row({ candidate_id: 'a', first_name: 'Ervin', last_name: 'Burai' }),
      row({ candidate_id: 'b', first_name: 'Ioulai', last_name: 'DIVID' }),
    ])).toBe(false);
  });

  it('wijst af zodra één profiel geen bruikbare naam heeft', () => {
    expect(namesCompatible([
      row({ candidate_id: 'a', first_name: 'Petrica', last_name: 'Badea' }),
      row({ candidate_id: 'b', first_name: null, last_name: null }),
    ])).toBe(false);
  });
});

describe('diffFields', () => {
  it('noemt een veld dat maar aan één kant is ingevuld geen verschil', () => {
    // De merge vult dat gat zelf met coalesce; er valt niets te kiezen.
    const diffs = diffFields([
      row({ candidate_id: 'a', first_name: 'Ana', last_name: 'Pop', email: 'ana@example.com' }),
      row({ candidate_id: 'b', first_name: 'Ana', last_name: 'Pop', email: null }),
    ]);
    expect(diffs).toEqual([]);
  });

  it('meldt een veld dat aan beide kanten anders is ingevuld', () => {
    const diffs = diffFields([
      row({ candidate_id: 'a', first_name: 'Ana', last_name: 'Pop', address_city: 'Helmond' }),
      row({ candidate_id: 'b', first_name: 'Ana', last_name: 'Pop', address_city: 'Eindhoven' }),
    ]);
    expect(diffs.map((d) => d.key)).toEqual(['address_city']);
    expect(diffs[0].values.map((v) => v.display)).toEqual(['Helmond', 'Eindhoven']);
  });

  it('negeert verschil in hoofdletters en accenten', () => {
    const diffs = diffFields([
      row({ candidate_id: 'a', address_city: 'Den Bosch' }),
      row({ candidate_id: 'b', address_city: 'den bosch' }),
    ]);
    expect(diffs).toEqual([]);
  });

  it('vergelijkt lijsten volgorde-onafhankelijk', () => {
    const diffs = diffFields([
      row({ candidate_id: 'a', skills: ['lassen', 'heftruck'] }),
      row({ candidate_id: 'b', skills: ['Heftruck', 'Lassen'] }),
    ]);
    expect(diffs).toEqual([]);
  });
});

describe('analyzeGroup', () => {
  it('merkt een groep zonder botsingen aan als samen te voegen', () => {
    const result = analyzeGroup([
      row({ candidate_id: 'a', first_name: 'Vitalie', last_name: 'Botnari', email: 'v@example.com' }),
      row({ candidate_id: 'b', first_name: 'Vitalie Botnari', last_name: 'Botnari' }),
    ]);
    expect(result.verdict).toBe('mergeable');
    expect(result.blockingDiffs).toEqual([]);
  });

  it('stuurt een botsende geboortedatum naar handmatig', () => {
    const result = analyzeGroup([
      row({ candidate_id: 'a', first_name: 'Ion', last_name: 'Pop', date_of_birth: '1980-01-01' }),
      row({ candidate_id: 'b', first_name: 'Ion', last_name: 'Pop', date_of_birth: '1981-05-09' }),
    ]);
    expect(result.verdict).toBe('review');
    expect(result.blockingDiffs.map((d) => d.key)).toEqual(['date_of_birth']);
  });

  it('stuurt twee dienstverbanden naar handmatig, ook zonder veldverschillen', () => {
    const result = analyzeGroup([
      row({ candidate_id: 'a', first_name: 'Ion', last_name: 'Pop', has_employee: true }),
      row({ candidate_id: 'b', first_name: 'Ion', last_name: 'Pop', has_employee: true }),
    ]);
    expect(result.verdict).toBe('review');
    expect(result.doubleEmployment).toBe(true);
  });

  it('markeert een gedeeld telefoonnummer als geen duplicaat', () => {
    const result = analyzeGroup([
      row({ candidate_id: 'a', first_name: 'Pawel', last_name: 'Morawiec' }),
      row({ candidate_id: 'b', first_name: 'Ioan', last_name: 'Cislariu' }),
      row({ candidate_id: 'c', first_name: 'Onbekend', last_name: 'Onbekend' }),
    ]);
    expect(result.verdict).toBe('not-duplicate');
  });

  it('een verschil in personeelsnummer blokkeert niet — dat is het symptoom van het duplicaat', () => {
    const result = analyzeGroup([
      row({ candidate_id: 'a', first_name: 'Ana', last_name: 'Pop', employee_number: 'CX-100' }),
      row({ candidate_id: 'b', first_name: 'Ana', last_name: 'Pop', employee_number: 'CX-742' }),
    ]);
    expect(result.verdict).toBe('mergeable');
    expect(result.diffs.map((d) => d.key)).toEqual(['employee_number']);
  });

  it('een verschil in e-mail blokkeert niet, maar staat wel in de vergelijking', () => {
    const result = analyzeGroup([
      row({ candidate_id: 'a', first_name: 'Ana', last_name: 'Pop', email: 'oud@example.com' }),
      row({ candidate_id: 'b', first_name: 'Ana', last_name: 'Pop', email: 'nieuw@example.com' }),
    ]);
    expect(result.verdict).toBe('mergeable');
    expect(result.diffs.map((d) => d.key)).toEqual(['email']);
  });
});

describe('suggestSurvivor', () => {
  it('kiest het profiel met een dienstverband', () => {
    const survivor = suggestSurvivor([
      row({ candidate_id: 'kaal', first_name: 'Ana', last_name: 'Pop', email: 'a@b.nl', address_city: 'Helmond' }),
      row({ candidate_id: 'dienst', first_name: 'Ana', last_name: 'Pop', has_employee: true }),
    ]);
    expect(survivor).toBe('dienst');
  });

  it('kiest anders het meest gevulde profiel', () => {
    const survivor = suggestSurvivor([
      row({ candidate_id: 'kaal', first_name: 'Ana', last_name: 'Pop' }),
      row({ candidate_id: 'vol', first_name: 'Ana', last_name: 'Pop', email: 'a@b.nl', address_city: 'Helmond', nationality: 'NL' }),
    ]);
    expect(survivor).toBe('vol');
  });

  it('kiest bij gelijke spoed het nieuwste profiel', () => {
    const survivor = suggestSurvivor([
      row({ candidate_id: 'oud', first_name: 'Ana', last_name: 'Pop', created_at: '2026-01-01T00:00:00Z' }),
      row({ candidate_id: 'nieuw', first_name: 'Ana', last_name: 'Pop', created_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(survivor).toBe('nieuw');
  });
});
