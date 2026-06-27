import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock de Supabase-client op modulegrens. De call-ketens in checkCompliance verschillen
// per tabel: `compliance_rules` en `documents` worden direct ge-await (thenable, GEEN .single),
// `candidates` eindigt op .single(), en get_candidate_decrypted gaat via .rpc(). De builder
// hieronder is daarom zowel awaitable als voorzien van .single(). Fixtures via vi.hoisted zodat
// de (gehoiste) vi.mock-factory ze kan lezen.
const h = vi.hoisted(() => {
  const state: { fixtures: Record<string, any> } = { fixtures: {} };
  const makeBuilder = (data: any) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      single: () => Promise.resolve({ data, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject),
    };
    return b;
  };
  return { state, makeBuilder };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => h.makeBuilder(h.state.fixtures[table] ?? null),
    rpc: () => Promise.resolve({ data: h.state.fixtures.rpc ?? null, error: null }),
  },
}));

import { checkCompliance } from '@/hooks/useComplianceCheck';

type Setup = {
  rules?: any[];
  candidate?: Record<string, any>;
  docs?: Array<{ type: string; status?: string }>;
  bsn?: string | null;
  iban?: string | null;
};

const setup = ({ rules = [], candidate = {}, docs = [], bsn = null, iban = null }: Setup) => {
  h.state.fixtures = {
    compliance_rules: rules,
    candidates: candidate,
    documents: docs,
    // get_candidate_decrypted geeft (gedecrypte) PII terug — hier bewust NEP.
    rpc: [{ decrypted_bsn: bsn, decrypted_iban: iban }],
  };
};

const FAKE_BSN = '000000000';
const FAKE_IBAN = 'NL00TEST0000000000';

describe('checkCompliance — hardcoded fallback (geen actieve regels)', () => {
  beforeEach(() => setup({}));

  it('vlagt alle standaard-checks bij een leeg dossier', async () => {
    setup({ rules: [], candidate: { date_of_birth: null }, docs: [], bsn: null, iban: null });
    const res = await checkCompliance('cand-1');

    expect(res.rulesApplied).toBe('standaard');
    expect(res.passed).toBe(false);
    expect(res.issues).toEqual(expect.arrayContaining([
      'Geen geldig ID bewijs',
      'Reglement niet afgetekend',
      'BSN niet ingevuld',
      'IBAN niet ingevuld',
      'Geboortedatum ontbreekt',
      'Contract ontbreekt',
    ]));
  });

  it('passed=true wanneer alles aanwezig is', async () => {
    setup({
      candidate: { date_of_birth: '1990-01-01', has_dutch_address: true },
      docs: [
        { type: 'id_bewijs', status: 'geldig' },
        { type: 'reglement', status: 'geldig' },
        { type: 'contract', status: 'geldig' },
      ],
      bsn: FAKE_BSN,
      iban: FAKE_IBAN,
    });
    const res = await checkCompliance('cand-2');

    expect(res.issues).toEqual([]);
    expect(res.passed).toBe(true);
    expect(res.rulesApplied).toBe('standaard');
  });
});

describe('checkCompliance — dynamische regels', () => {
  it('zet rulesApplied op de regelnamen en leidt issues af uit required_documents/_fields', async () => {
    setup({
      rules: [{ id: 'r1', name: 'Productie NL', required_documents: ['id_bewijs', 'vca'], required_fields: ['bsn', 'phone'] }],
      candidate: { phone: null },
      docs: [],
      bsn: null,
    });
    const res = await checkCompliance('cand-3');

    expect(res.rulesApplied).toBe('Productie NL');
    expect(res.issues).toEqual(expect.arrayContaining([
      'Geen geldig ID Bewijs',
      'VCA ontbreekt',
      'BSN niet ingevuld',
      'Telefoon niet ingevuld',
      'Contract ontbreekt',
    ]));
  });

  it('past globale + matchende sectorregel toe, sluit niet-matchende sector uit', async () => {
    setup({
      rules: [
        { id: 'g', name: 'Globaal', required_fields: ['bsn'] },
        { id: 's', name: 'Sector logistiek', sector: 'logistiek', required_documents: ['vca'] },
        { id: 'x', name: 'Sector zorg', sector: 'zorg', required_documents: ['diploma'] },
      ],
      candidate: {},
      docs: [{ type: 'contract' }],
      bsn: FAKE_BSN,
    });
    const res = await checkCompliance('cand-4', { sector: 'logistiek' });

    expect(res.rulesApplied).toContain('Globaal');
    expect(res.rulesApplied).toContain('Sector logistiek');
    expect(res.rulesApplied).not.toContain('Sector zorg');
    expect(res.issues).toContain('VCA ontbreekt');
    expect(res.issues).not.toContain('Diploma ontbreekt');
  });
});

describe('checkCompliance — altijd-aan checks', () => {
  it('vlagt verlopen rijbewijs en ontbrekend Nederlands adres', async () => {
    setup({
      candidate: {
        date_of_birth: '1990-01-01',
        has_dutch_address: false,
        has_drivers_license: true,
        drivers_license_expiry: '2020-01-01',
      },
      docs: [{ type: 'id_bewijs', status: 'geldig' }, { type: 'reglement' }, { type: 'contract' }],
      bsn: FAKE_BSN,
      iban: FAKE_IBAN,
    });
    const res = await checkCompliance('cand-5');

    expect(res.issues).toContain('Rijbewijs is verlopen');
    expect(res.issues).toContain('Geen Nederlands adres');
    expect(res.passed).toBe(false);
  });

  it('vlagt geen rijbewijs-issue bij een geldige vervaldatum', async () => {
    setup({
      candidate: {
        date_of_birth: '1990-01-01',
        has_dutch_address: true,
        has_drivers_license: true,
        drivers_license_expiry: '2999-01-01',
      },
      docs: [{ type: 'id_bewijs', status: 'geldig' }, { type: 'reglement' }, { type: 'contract' }],
      bsn: FAKE_BSN,
      iban: FAKE_IBAN,
    });
    const res = await checkCompliance('cand-6');

    expect(res.issues).not.toContain('Rijbewijs is verlopen');
    expect(res.passed).toBe(true);
  });
});
