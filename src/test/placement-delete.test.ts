import { describe, expect, it } from 'vitest';
import {
  canDeletePlacement,
  describePlacementPeriod,
  placementAuditSnapshot,
  placementDeleteBlockers,
} from '@/lib/placement-delete';

const empty = { timesheets: 0, hourLetters: 0, sickReports: 0, invoiceLines: 0 };

describe('placementDeleteBlockers', () => {
  it('geeft niets terug als er niets aan de plaatsing hangt', () => {
    expect(placementDeleteBlockers(empty)).toEqual([]);
    expect(placementDeleteBlockers(null)).toEqual([]);
    expect(placementDeleteBlockers(undefined)).toEqual([]);
  });

  it('benoemt elke blokkade in het Nederlands, in vaste volgorde, enkel- en meervoud', () => {
    const labels = placementDeleteBlockers({ timesheets: 3, hourLetters: 1, sickReports: 2, invoiceLines: 1 }).map((b) => b.label);
    expect(labels).toEqual(['3 urenregistraties', '1 urenbrief', '2 ziekmeldingen', '1 factuurregel']);
  });

  it('telt factuurregels als blokkade, ook al staat die FK op SET NULL', () => {
    // Technisch zou de delete slagen, maar dan blijft een factuurregel als wees achter.
    const blockers = placementDeleteBlockers({ ...empty, invoiceLines: 2 });
    expect(blockers).toEqual([{ key: 'invoiceLines', count: 2, label: '2 factuurregels' }]);
  });
});

describe('canDeletePlacement', () => {
  it('is alleen waar als de impact bekend én leeg is', () => {
    expect(canDeletePlacement(empty)).toBe(true);
    expect(canDeletePlacement({ ...empty, timesheets: 1 })).toBe(false);
    // Onbekend (nog niet geteld / fout) mag nooit als "veilig" doorgaan.
    expect(canDeletePlacement(null)).toBe(false);
    expect(canDeletePlacement(undefined)).toBe(false);
  });
});

describe('describePlacementPeriod', () => {
  it('toont start t/m einde in Nederlandse datumnotatie', () => {
    expect(describePlacementPeriod('2026-09-01', '2026-09-30', null)).toBe('01-09-2026 t/m 30-09-2026');
  });

  it('valt terug op de verwachte einddatum en anders op "vanaf"', () => {
    expect(describePlacementPeriod('2026-09-01', null, '2026-12-31')).toBe('01-09-2026 t/m 31-12-2026');
    expect(describePlacementPeriod('2026-09-01', null, null)).toBe('vanaf 01-09-2026');
  });

  it('laat de echte einddatum voorgaan op de verwachte', () => {
    expect(describePlacementPeriod('2026-09-01', '2026-09-15', '2026-12-31')).toBe('01-09-2026 t/m 15-09-2026');
  });
});

describe('placementAuditSnapshot', () => {
  it('houdt scalars, nulls en arrays, en laat gejoinde relaties weg', () => {
    const snapshot = placementAuditSnapshot({
      id: 'p1',
      function_name: 'Lasser',
      hourly_rate: 15,
      end_date: null,
      work_days: ['ma', 'di'],
      companies: { id: 'c1', name: 'Acme' },
      candidates: { id: 'k1', first_name: 'Jan' },
      payrollers: null,
    });
    expect(snapshot).toEqual({
      id: 'p1',
      function_name: 'Lasser',
      hourly_rate: 15,
      end_date: null,
      work_days: ['ma', 'di'],
      payrollers: null,
    });
  });

  it('geeft een leeg object voor een ontbrekende rij', () => {
    expect(placementAuditSnapshot(null)).toEqual({});
    expect(placementAuditSnapshot(undefined)).toEqual({});
  });
});
