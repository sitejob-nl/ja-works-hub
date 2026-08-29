import { describe, expect, it } from 'vitest';
import {
  vehicleAssignedOn,
  vehicleFreeOn,
  vehicleNextReservation,
  vehiclePeriodConflict,
} from '@/lib/vehicle-availability';

describe('vehicleAssignedOn', () => {
  it('is niet toegewezen zonder toewijzingen', () => {
    expect(vehicleAssignedOn([], '2026-06-03')).toBe(false);
    expect(vehicleAssignedOn(null, '2026-06-03')).toBe(false);
  });

  it('open-einde toewijzing bezet het voertuig op elke datum erna', () => {
    const a = [{ assigned_date: '2026-05-01', returned_date: null }];
    expect(vehicleAssignedOn(a, '2026-06-03')).toBe(true);
    expect(vehicleAssignedOn(a, '2030-01-01')).toBe(true);
  });

  it('komt vrij op/na de inleverdatum (grens inclusief op de datum zelf)', () => {
    const a = [{ assigned_date: '2026-05-01', returned_date: '2026-07-15' }];
    expect(vehicleAssignedOn(a, '2026-06-20')).toBe(true); // vóór inleveren → bezet
    expect(vehicleAssignedOn(a, '2026-07-15')).toBe(false); // op inleverdatum → vrij
    expect(vehicleAssignedOn(a, '2026-08-01')).toBe(false); // erna → vrij
  });

  it('telt een toekomstige toewijzing niet mee voor eerdere datums', () => {
    const a = [{ assigned_date: '2026-08-01', returned_date: null }];
    expect(vehicleAssignedOn(a, '2026-06-03')).toBe(false); // nog niet begonnen → vrij nu
    expect(vehicleAssignedOn(a, '2026-08-01')).toBe(true); // vanaf dan → bezet
  });
});

describe('vehicleFreeOn', () => {
  it('voertuig zonder toewijzingen is vrij', () => {
    expect(vehicleFreeOn({ vehicle_assignments: [] }, '2026-06-03')).toBe(true);
  });

  it('open-einde toegewezen voertuig is niet vrij', () => {
    expect(vehicleFreeOn({ vehicle_assignments: [{ assigned_date: '2026-05-01', returned_date: null }] }, '2026-06-03')).toBe(false);
  });

  it('voertuig met toekomstige inlever-datum is vrij op/na die datum', () => {
    const v = { vehicle_assignments: [{ assigned_date: '2026-05-01', returned_date: '2026-07-15' }] };
    expect(vehicleFreeOn(v, '2026-06-20')).toBe(false);
    expect(vehicleFreeOn(v, '2026-07-15')).toBe(true);
  });
});

describe('vehicleNextReservation', () => {
  it('geeft niets terug zonder toekomstige toewijzing', () => {
    expect(vehicleNextReservation([{ assigned_date: '2026-05-01', returned_date: null }], '2026-06-03')).toBeNull();
    expect(vehicleNextReservation([], '2026-06-03')).toBeNull();
  });

  it('geeft de eerstvolgende reservering terug, met alles wat eraan hangt', () => {
    const a = [
      { assigned_date: '2026-09-01', returned_date: null, naam: 'laat' },
      { assigned_date: '2026-07-01', returned_date: null, naam: 'eerst' },
    ];
    expect(vehicleNextReservation(a, '2026-06-03')?.naam).toBe('eerst');
  });

  it('telt een reservering die op dezelfde dag alweer afloopt niet mee', () => {
    const a = [{ assigned_date: '2026-07-01', returned_date: '2026-07-01' }];
    expect(vehicleNextReservation(a, '2026-06-03')).toBeNull();
  });
});

describe('vehiclePeriodConflict', () => {
  const reservering = [{ assigned_date: '2026-07-01', returned_date: null }];

  it('open einde botst met een latere reservering', () => {
    expect(vehiclePeriodConflict(reservering, '2026-06-03', null)).not.toBeNull();
  });

  it('inleveren op de dag dat de reservering ingaat mag', () => {
    expect(vehiclePeriodConflict(reservering, '2026-06-03', '2026-07-01')).toBeNull();
  });

  it('inleveren ná die dag botst wel', () => {
    expect(vehiclePeriodConflict(reservering, '2026-06-03', '2026-07-02')).not.toBeNull();
  });

  it('een afgeronde toewijzing in het verleden botst niet', () => {
    const verleden = [{ assigned_date: '2026-01-01', returned_date: '2026-03-01' }];
    expect(vehiclePeriodConflict(verleden, '2026-06-03', null)).toBeNull();
  });
});
