import { describe, expect, it } from 'vitest';
import { vehicleDisplayStatus, vehicleReservedFrom } from '@/lib/vehicle-availability';

// Punt 17 — een reservering is een toewijzing die later begint. De getoonde status
// wordt daaruit afgeleid, zodat hij niet kan verouderen zonder nachtelijke sweep.
describe('vehicleDisplayStatus', () => {
  const TODAY = '2026-08-19';

  it('handmatige standen winnen van de datumlogica', () => {
    const assignments = [{ assigned_date: '2026-09-01', returned_date: null }];
    expect(vehicleDisplayStatus({ status: 'onderhoud', vehicle_assignments: assignments }, TODAY).key).toBe('onderhoud');
    expect(vehicleDisplayStatus({ status: 'uit_dienst', vehicle_assignments: assignments }, TODAY).key).toBe('uit_dienst');
  });

  it('lopende toewijzing leest als toegewezen', () => {
    const v = { status: 'beschikbaar', vehicle_assignments: [{ assigned_date: '2026-05-01', returned_date: null }] };
    expect(vehicleDisplayStatus(v, TODAY)).toEqual({ key: 'toegewezen', reservedFrom: null });
  });

  it('toewijzing die later begint leest als gereserveerd, met begindatum', () => {
    const v = { status: 'beschikbaar', vehicle_assignments: [{ assigned_date: '2026-09-01', returned_date: null }] };
    expect(vehicleDisplayStatus(v, TODAY)).toEqual({ key: 'gereserveerd', reservedFrom: '2026-09-01' });
  });

  it('pakt de eerstvolgende reservering als er meerdere zijn', () => {
    const v = {
      status: 'beschikbaar',
      vehicle_assignments: [
        { assigned_date: '2026-11-01', returned_date: null },
        { assigned_date: '2026-09-15', returned_date: '2026-10-01' },
      ],
    };
    expect(vehicleDisplayStatus(v, TODAY).reservedFrom).toBe('2026-09-15');
  });

  it('afgelopen toewijzing laat het voertuig gewoon beschikbaar', () => {
    const v = { status: 'beschikbaar', vehicle_assignments: [{ assigned_date: '2026-01-01', returned_date: '2026-03-01' }] };
    expect(vehicleDisplayStatus(v, TODAY)).toEqual({ key: 'beschikbaar', reservedFrom: null });
  });

  it('een lopende toewijzing gaat voor op een latere reservering', () => {
    const v = {
      status: 'toegewezen',
      vehicle_assignments: [
        { assigned_date: '2026-05-01', returned_date: null },
        { assigned_date: '2026-09-01', returned_date: null },
      ],
    };
    expect(vehicleDisplayStatus(v, TODAY).key).toBe('toegewezen');
  });

  it('valt terug op de opgeslagen status zonder toewijzingen', () => {
    expect(vehicleDisplayStatus({ status: 'beschikbaar', vehicle_assignments: [] }, TODAY).key).toBe('beschikbaar');
    expect(vehicleDisplayStatus({ status: null, vehicle_assignments: null }, TODAY).key).toBe('beschikbaar');
  });
});

describe('vehicleReservedFrom', () => {
  const TODAY = '2026-08-19';

  it('negeert toewijzingen die vandaag of eerder begonnen', () => {
    expect(vehicleReservedFrom([{ assigned_date: TODAY, returned_date: null }], TODAY)).toBeNull();
    expect(vehicleReservedFrom([{ assigned_date: '2026-01-01', returned_date: null }], TODAY)).toBeNull();
  });

  it('geeft de vroegste toekomstige begindatum', () => {
    const a = [
      { assigned_date: '2026-12-01', returned_date: null },
      { assigned_date: '2026-08-20', returned_date: null },
    ];
    expect(vehicleReservedFrom(a, TODAY)).toBe('2026-08-20');
  });

  it('slaat een toewijzing over die op de begindatum al is ingeleverd', () => {
    const a = [{ assigned_date: '2026-09-01', returned_date: '2026-09-01' }];
    expect(vehicleReservedFrom(a, TODAY)).toBeNull();
  });
});
