import { describe, expect, it } from 'vitest';
import {
  buildUpdatePatch,
  computeUpdateDiff,
  deriveDetails,
  deriveLabel,
  normalizeForCompare,
  selectionKey,
} from '../../supabase/functions/_shared/carerix/preview.ts';

describe('deriveLabel', () => {
  it('zet voor- en achternaam samen voor kandidaten en contactpersonen', () => {
    expect(deriveLabel({ first_name: 'Mihai', last_name: 'Sandor' })).toBe('Mihai Sandor');
    expect(deriveLabel({ first_name: 'Dinis', last_name: null })).toBe('Dinis');
  });

  it('pakt de naam van een opdrachtgever en de titel van een vacature', () => {
    expect(deriveLabel({ name: 'Vescom B.V.' })).toBe('Vescom B.V.');
    expect(deriveLabel({ title: 'Lasser MIG/MAG' })).toBe('Lasser MIG/MAG');
  });

  it('valt terug op de meegegeven meta wanneer de payload niets bruikbaars heeft', () => {
    // Matches hebben geen naamveld; de runner geeft een omschrijving mee.
    expect(
      deriveLabel({ candidate_id: 'uuid-a', vacancy_id: 'uuid-b' }, { name: 'kandidaat 522 → vacature 26' }),
    ).toBe('kandidaat 522 → vacature 26');
  });

  it('gebruikt carerix_name uit de mapping-metadata van een plaatsing', () => {
    expect(deriveLabel({ status: 'actief' }, { carerix_name: 'Plaatsing Bax — lasser' }))
      .toBe('Plaatsing Bax — lasser');
  });

  it('kort een notitie af tot een leesbare regel', () => {
    const lang = 'A'.repeat(120);
    const label = deriveLabel({ content: lang });
    expect(label).toHaveLength(81);
    expect(label?.endsWith('…')).toBe(true);
  });

  it('geeft null wanneer er niets bruikbaars is — de UI toont dan het Carerix-id', () => {
    expect(deriveLabel({ organization_id: 'org' })).toBeNull();
    expect(deriveLabel({})).toBeNull();
  });

  it('negeert lege en niet-tekstuele waarden', () => {
    expect(deriveLabel({ first_name: '   ', last_name: '', name: 42 as unknown as string })).toBeNull();
  });
});

describe('deriveDetails', () => {
  it('neemt alleen beoordelingsvelden mee', () => {
    expect(
      deriveDetails({
        first_name: 'Jan',
        email: 'jan@example.com',
        phone: '+31612345678',
        address_city: 'Eindhoven',
        status: 'nieuw',
      }),
    ).toEqual({
      email: 'jan@example.com',
      phone: '+31612345678',
      address_city: 'Eindhoven',
      status: 'nieuw',
    });
  });

  it('laat gevoelige velden buiten de voorvertoning', () => {
    const details = deriveDetails({
      email: 'jan@example.com',
      bsn: '123456782',
      iban: 'NL91ABNA0417164300',
      date_of_birth: '1990-01-01',
    });
    expect(details).toEqual({ email: 'jan@example.com' });
    expect(details).not.toHaveProperty('bsn');
    expect(details).not.toHaveProperty('iban');
    expect(details).not.toHaveProperty('date_of_birth');
  });

  it('geeft null in plaats van een leeg object', () => {
    expect(deriveDetails({ organization_id: 'org' })).toBeNull();
    expect(deriveDetails({ email: '  ' })).toBeNull();
  });
});

describe('selectionKey', () => {
  it('scheidt entiteiten met hetzelfde Carerix-id', () => {
    expect(selectionKey('candidate', '522')).toBe('candidate:522');
    expect(selectionKey('candidate', '522')).not.toBe(selectionKey('vacancy', '522'));
  });
});

describe('normalizeForCompare', () => {
  it('negeert cosmetische verschillen', () => {
    expect(normalizeForCompare('address_city', '  Eindhoven ')).toBe('Eindhoven');
    expect(normalizeForCompare('email', 'Jan@Example.COM')).toBe('jan@example.com');
    expect(normalizeForCompare('date_of_birth', '1990-01-01T00:00:00.000Z')).toBe('1990-01-01');
    // Telefoonnotatie: +31 6 vs 06 is hetzelfde nummer.
    expect(normalizeForCompare('phone', '+31 6 12 34 56 78')).toBe(
      normalizeForCompare('phone', '0612345678'),
    );
    expect(normalizeForCompare('hourly_rate', '14,50')).toBe(normalizeForCompare('hourly_rate', 14.5));
  });

  it('vergelijkt arrays als geordende set', () => {
    expect(normalizeForCompare('languages', ['Engels', 'Pools'])).toBe(
      normalizeForCompare('languages', ['pools', 'engels']),
    );
    expect(normalizeForCompare('languages', [])).toBeNull();
  });

  it('behandelt leeg als null', () => {
    expect(normalizeForCompare('email', '')).toBeNull();
    expect(normalizeForCompare('email', '   ')).toBeNull();
    expect(normalizeForCompare('email', null)).toBeNull();
    expect(normalizeForCompare('email', undefined)).toBeNull();
  });
});

describe('computeUpdateDiff', () => {
  it('vindt echte conflicten en laat gelijke velden weg', () => {
    const diff = computeUpdateDiff(
      'candidate',
      { first_name: 'Jan', address_city: 'Venlo', email: 'JAN@x.nl' },
      { first_name: 'Jan', address_city: 'Eindhoven', email: 'jan@x.nl' },
    );
    expect(diff).toEqual({ address_city: { van: 'Eindhoven', naar: 'Venlo' } });
  });

  it('stelt nooit voor om echte data door een mapper-placeholder te vervangen', () => {
    expect(
      computeUpdateDiff('candidate', { first_name: 'Onbekend' }, { first_name: 'Maria' }),
    ).toBeNull();
    expect(
      computeUpdateDiff('company', { name: 'Onbekend bedrijf' }, { name: 'Vescom B.V.' }),
    ).toBeNull();
  });

  it('slaat kandidaat-velden over die de enrichment toch al vult', () => {
    // Lokaal leeg of een enrich-default ('NL', 'Dossier') → geen diff-regel.
    expect(
      computeUpdateDiff(
        'candidate',
        { address_city: 'Venlo', nationality: 'Pools', address_country: 'PL' },
        { address_city: null, nationality: 'Dossier', address_country: 'NL' },
      ),
    ).toBeNull();
  });

  it('telt lokaal-leeg bij entiteiten zonder enrichment wél als update', () => {
    const diff = computeUpdateDiff(
      'contact',
      { email: 'inkoop@vescom.nl' },
      { email: null },
    );
    expect(diff).toEqual({ email: { van: null, naar: 'inkoop@vescom.nl' } });
  });

  it('vergelijkt alleen ge-whiteliste velden', () => {
    // status/bsn staan bewust niet in de vergelijkingsvelden.
    expect(
      computeUpdateDiff(
        'candidate',
        { status: 'nieuw', bsn: '123456782' },
        { status: 'medewerker', bsn: null },
      ),
    ).toBeNull();
    expect(computeUpdateDiff('placement', { status: 'actief' }, { status: 'afgerond' })).toBeNull();
  });

  it('negeert telefoonnotatie maar ziet een echt ander nummer', () => {
    expect(
      computeUpdateDiff('candidate', { phone: '+31 6 12345678' }, { phone: '0612345678' }),
    ).toBeNull();
    expect(
      computeUpdateDiff('candidate', { phone: '+31 6 99999999' }, { phone: '0612345678' }),
    ).toEqual({ phone: { van: '0612345678', naar: '+31 6 99999999' } });
  });
});

describe('buildUpdatePatch', () => {
  it('past alleen ge-whiteliste velden toe', () => {
    const patch = buildUpdatePatch(
      {
        address_city: { van: 'Eindhoven', naar: 'Venlo' },
        // Gemanipuleerde diff: mag nooit in de patch belanden.
        bsn: { van: null, naar: '123456782' },
        role: { van: 'medewerker', naar: 'admin' },
      },
      'candidate',
    );
    expect(patch).toEqual({ address_city: 'Venlo' });
  });

  it('is robuust tegen kapotte diff-structuren', () => {
    expect(buildUpdatePatch(null, 'candidate')).toEqual({});
    expect(buildUpdatePatch('geen object', 'candidate')).toEqual({});
    expect(buildUpdatePatch([{ naar: 'x' }], 'candidate')).toEqual({});
    expect(buildUpdatePatch({ email: 'plat' }, 'candidate')).toEqual({});
    expect(buildUpdatePatch({ email: { van: 'a' } }, 'candidate')).toEqual({});
    expect(buildUpdatePatch({ email: { naar: 'b@x.nl' } }, 'onbekend-type')).toEqual({});
  });
});
