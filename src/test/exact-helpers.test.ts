import { describe, expect, it } from 'vitest';
import {
  buildAccountMatchQueries,
  classifyExactProviderError,
  exactRetryDelayMs,
  exactSalesInvoiceType,
  normalizeVatPercentage,
  odataResults,
  parseExactDate,
  selectVatCodeForRate,
  toExactDate,
// exact-format bevat de pure regels (Deno-vrij); exact-helpers voegt daar de
// fetch- en Deno-afhankelijke laag aan toe en exporteert deze door.
} from '../../supabase/functions/_shared/exact-format.ts';

describe('BTW-codes', () => {
  // Exact levert vaste-breedte codes met spatie-padding; die padding hoort
  // ongewijzigd terug te gaan, anders herkent Exact de code niet.
  const rows = [
    { Code: '6  ', Description: 'BTW hoog 21%', Percentage: 21, Type: 'E', VATTransactionType: 'S' },
    { Code: '1  ', Description: 'BTW laag 9%', Percentage: 9, Type: 'E', VATTransactionType: 'S' },
    { Code: '42 ', Description: 'Geen BTW', Percentage: 0, Type: 'B', VATTransactionType: 'S' },
    { Code: '43 ', Description: 'BTW verlegd', Percentage: 0, Type: 'N', VATTransactionType: 'S' },
    { Code: '9  ', Description: 'Inkoop hoog', Percentage: 21, Type: 'E', VATTransactionType: 'P' },
  ];

  it('kiest de verkoopcode bij het juiste tarief, mét padding', () => {
    expect(selectVatCodeForRate(rows, 21)).toBe('6  ');
    expect(selectVatCodeForRate(rows, 9)).toBe('1  ');
  });

  it('negeert inkoop-only codes', () => {
    const onlyPurchase = rows.filter((row) => row.VATTransactionType === 'P');
    expect(selectVatCodeForRate(onlyPurchase, 21)).toBeNull();
  });

  it('kiest bij 0% niet automatisch "verlegd" — dat moet een bewuste keuze zijn', () => {
    expect(selectVatCodeForRate(rows, 0)).toBe('42 ');
  });

  it('negeert geblokkeerde codes', () => {
    const blocked = [{ ...rows[0], IsBlocked: true }];
    expect(selectVatCodeForRate(blocked, 21)).toBeNull();
  });

  it('geeft null zonder bruikbaar tarief of zonder treffer', () => {
    expect(selectVatCodeForRate(rows, null)).toBeNull();
    expect(selectVatCodeForRate(rows, 13)).toBeNull();
    expect(selectVatCodeForRate([], 21)).toBeNull();
  });

  it('normaliseert percentages die als fractie binnenkomen', () => {
    expect(normalizeVatPercentage(0.21)).toBeCloseTo(21);
    expect(normalizeVatPercentage(21)).toBe(21);
    expect(normalizeVatPercentage('9')).toBe(9);
    expect(normalizeVatPercentage('9,5')).toBe(9.5);
    expect(normalizeVatPercentage(0)).toBe(0);
    expect(normalizeVatPercentage(null)).toBeNull();
  });

  it('matcht een fractie-percentage op een heel tarief', () => {
    const fractionRows = [{ Code: '6  ', Percentage: 0.21, Type: 'E', VATTransactionType: 'S' }];
    expect(selectVatCodeForRate(fractionRows, 21)).toBe('6  ');
  });
});

describe('factuurtype', () => {
  it('herkent een creditnota aan een negatief totaal', () => {
    expect(exactSalesInvoiceType(1250)).toBe(8020);
    expect(exactSalesInvoiceType(0)).toBe(8020);
    expect(exactSalesInvoiceType(-1250)).toBe(8021);
  });
});

describe('datums', () => {
  it('stuurt ISO zonder tijdzone — Exact weigert het /Date()/-formaat als invoer', () => {
    expect(toExactDate('2026-07-18')).toBe('2026-07-18T00:00:00');
    expect(toExactDate('2026-07-18T13:45:00Z')).toBe('2026-07-18T00:00:00');
    expect(toExactDate(null)).toBeNull();
    expect(toExactDate('onzin')).toBeNull();
  });

  it('leest Exact\'s /Date(ms)/-notatie', () => {
    expect(parseExactDate('/Date(1769817600000)/')?.getTime()).toBe(1769817600000);
    expect(parseExactDate(null)).toBeNull();
  });
});

describe('relatie-zoeksleutels', () => {
  it('zoekt op KvK, dan BTW, dan e-mail, dan pas naam', () => {
    const queries = buildAccountMatchQueries({
      kvkNumber: '12345678',
      vatNumber: 'NL001234567B01',
      email: 'facturen@klant.nl',
      name: 'Klant B.V.',
    });

    expect(queries.map((q) => q.key)).toEqual(['kvk', 'btw', 'email', 'naam']);
    expect(queries[0].filter).toBe("ChamberOfCommerce eq '12345678'");
  });

  it('slaat lege sleutels over', () => {
    const queries = buildAccountMatchQueries({ kvkNumber: '  ', name: 'Alleen Naam' });
    expect(queries.map((q) => q.key)).toEqual(['naam']);
  });

  it('escapet een apostrof in de naam zodat de OData-query heel blijft', () => {
    const queries = buildAccountMatchQueries({ name: "Bakkerij D'Or" });
    expect(queries[0].filter).toBe("Name eq 'Bakkerij D''Or'");
  });
});

describe('foutclassificatie', () => {
  it('onderscheidt een verdwenen tenant van een verlopen autorisatie', () => {
    expect(classifyExactProviderError(new Error('TENANT_NOT_FOUND')).publicCode).toBe('exact_tenant_not_found');
    expect(classifyExactProviderError(new Error('REAUTH_REQUIRED')).publicCode).toBe('needs_reauth');
  });

  it('markeert een rate limit als tijdelijk niet beschikbaar', () => {
    const classified = classifyExactProviderError(new Error('Exact GET crm/Accounts -> 429: rate limit'));
    expect(classified.publicCode).toBe('exact_provider_unavailable');
    expect(classified.providerStatus).toBe(429);
  });

  it('redigeert tokens uit de foutdetails', () => {
    const classified = classifyExactProviderError(new Error('faalde met Bearer eyJhbGciOiJIUzI1NiJ9.abc'));
    expect(classified.detail).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(classified.detail).toContain('[redacted]');
  });
});

describe('retry-vertraging', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('respecteert Retry-After wanneer Exact die meegeeft', () => {
    expect(exactRetryDelayMs(headers({ 'retry-after': '5' }), 1)).toBe(5000);
  });

  it('wacht tot het rate-limit-venster reset', () => {
    const now = 1_700_000_000_000;
    const reset = String(now + 12_000);
    expect(exactRetryDelayMs(headers({ 'x-ratelimit-minutely-reset': reset }), 1, now)).toBe(12_250);
  });

  it('negeert een reset-waarde die niet in de nabije toekomst ligt', () => {
    const now = 1_700_000_000_000;
    // Waarde in het verleden → exponentiële fallback (2e poging = 2s).
    expect(exactRetryDelayMs(headers({ 'x-ratelimit-reset': String(now - 5000) }), 2, now)).toBe(2000);
  });

  it('loopt exponentieel op en plafonneert', () => {
    expect(exactRetryDelayMs(headers({}), 1)).toBe(1000);
    expect(exactRetryDelayMs(headers({}), 3)).toBe(4000);
    expect(exactRetryDelayMs(headers({}), 9)).toBe(8000);
  });
});

describe('OData-uitpakken', () => {
  it('leest zowel { d: { results } } als { d: [] }', () => {
    expect(odataResults({ d: { results: [{ ID: '1' }] } })).toHaveLength(1);
    expect(odataResults({ d: [{ ID: '1' }, { ID: '2' }] })).toHaveLength(2);
    expect(odataResults({})).toEqual([]);
    expect(odataResults(null)).toEqual([]);
  });
});
