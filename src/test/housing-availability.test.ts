import { describe, expect, it } from 'vitest';
import { bedsOccupiedOn, roomHasFreeBedOn } from '@/lib/assignments';

describe('bedsOccupiedOn', () => {
  it('telt geen bedden in een lege kamer', () => {
    expect(bedsOccupiedOn([], '2026-06-03')).toBe(0);
    expect(bedsOccupiedOn(null, '2026-06-03')).toBe(0);
  });

  it('telt een open-einde bewoner (geen uitcheck) als bezet', () => {
    const a = [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }];
    expect(bedsOccupiedOn(a, '2026-06-03')).toBe(1);
    expect(bedsOccupiedOn(a, '2030-01-01')).toBe(1);
  });

  it('komt vrij op/na de uitcheckdatum (grens inclusief op de datum zelf)', () => {
    const a = [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: '2026-07-15' }];
    expect(bedsOccupiedOn(a, '2026-06-20')).toBe(1); // vóór uitcheck → bezet
    expect(bedsOccupiedOn(a, '2026-07-15')).toBe(0); // op uitcheck → vrij
    expect(bedsOccupiedOn(a, '2026-08-01')).toBe(0); // na uitcheck → vrij
  });

  it('telt een toekomstige reservering niet mee voor eerdere datums', () => {
    const a = [{ status: 'gereserveerd', check_in_date: '2026-08-01', check_out_date: null }];
    expect(bedsOccupiedOn(a, '2026-06-03')).toBe(0); // reservering nog niet begonnen → vrij nu
    expect(bedsOccupiedOn(a, '2026-08-01')).toBe(1); // vanaf de reservering → bezet
  });

  it('negeert niet-actieve (historische) toewijzingen', () => {
    const a = [
      { status: 'uitgecheckt', check_in_date: '2026-01-01', check_out_date: '2026-03-01' },
      { status: 'geannuleerd', check_in_date: '2026-02-01', check_out_date: null },
    ];
    expect(bedsOccupiedOn(a, '2026-06-03')).toBe(0);
  });
});

describe('roomHasFreeBedOn', () => {
  it('lege kamer is vrij', () => {
    expect(roomHasFreeBedOn({ capacity: 1, housing_assignments: [] }, '2026-06-03')).toBe(true);
  });

  it('volle capaciteit-1 kamer met open-einde bewoner is niet vrij', () => {
    const unit = { capacity: 1, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }] };
    expect(roomHasFreeBedOn(unit, '2026-06-03')).toBe(false);
  });

  it('kamer met toekomstige uitcheck is vrij op/na die datum', () => {
    const unit = { capacity: 1, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: '2026-07-15' }] };
    expect(roomHasFreeBedOn(unit, '2026-06-20')).toBe(false);
    expect(roomHasFreeBedOn(unit, '2026-07-15')).toBe(true);
  });

  it('deels bezette kamer (capaciteit 2, 1 bewoner) is vrij', () => {
    const unit = { capacity: 2, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }] };
    expect(roomHasFreeBedOn(unit, '2026-06-03')).toBe(true);
  });

  it('onbekende capaciteit telt als 1 — lege kamer blijft zichtbaar', () => {
    expect(roomHasFreeBedOn({ capacity: null, housing_assignments: [] }, '2026-06-03')).toBe(true);
    const occupied = { capacity: null, housing_assignments: [{ status: 'ingecheckt', check_in_date: '2026-05-01', check_out_date: null }] };
    expect(roomHasFreeBedOn(occupied, '2026-06-03')).toBe(false);
  });
});
