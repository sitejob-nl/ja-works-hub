import { describe, expect, it } from 'vitest';
import { formatEUR } from '@/lib/format';
import {
  deleteFineDescription,
  describeFine,
  fineAuditValues,
  fineLicensePlate,
  paidToggleCopy,
} from '@/lib/vehicle-fines';

/**
 * De teksten en auditwaarden die het transportoverzicht en het boetes-tabblad
 * van een voertuig delen. Beide schermen moeten dezelfde drie feiten tonen
 * (datum, kenteken, bedrag) en dezelfde oude waarden in de auditregel zetten.
 */
const fine = {
  id: 'fine-1',
  vehicle_id: 'veh-1',
  employee_id: 'emp-1',
  candidate_id: 'cand-1',
  fine_date: '2026-05-12',
  due_date: '2026-06-01',
  amount: 95,
  reference_number: 'CJIB-123',
  description: 'Te hard gereden',
  notes: null,
  paid: false,
  paid_at: null,
  photos: ['qa-org/vehicle-fines/veh-1/a.jpg', 'qa-org/vehicle-fines/veh-1/b.pdf'],
  vehicles: { id: 'veh-1', license_plate: 'AB-123-C', brand: 'Ford', model: 'Transit' },
  candidates: { id: 'cand-1', first_name: 'Jan', last_name: 'Kowalski' },
  employees: null,
};

describe('vehicle-fines: kenteken', () => {
  it('leest het kenteken uit de gejoinde voertuigrij (transportoverzicht)', () => {
    expect(fineLicensePlate(fine)).toBe('AB-123-C');
  });

  it('valt terug op het kenteken van het voertuig-tabblad als de join ontbreekt', () => {
    expect(fineLicensePlate({ ...fine, vehicles: null }, 'XY-987-Z')).toBe('XY-987-Z');
    expect(fineLicensePlate({ ...fine, vehicles: null })).toBeNull();
  });
});

describe('vehicle-fines: teksten', () => {
  it('beschrijft een boete met datum, kenteken en bedrag', () => {
    expect(describeFine(fine)).toBe(`de boete van 12-05-2026 op AB-123-C (${formatEUR(95)})`);
  });

  it('laat het kenteken weg als het onbekend is, zodat de zin blijft kloppen', () => {
    expect(describeFine({ ...fine, vehicles: null })).toBe(`de boete van 12-05-2026 (${formatEUR(95)})`);
  });

  it('verwijder-uitleg noemt de bijlagen, want die gaan mee uit de opslag', () => {
    expect(deleteFineDescription(fine)).toBe(
      `Verwijdert de boete van 12-05-2026 op AB-123-C (${formatEUR(95)}), inclusief 2 bijlagen. Deze actie kan niet ongedaan worden gemaakt.`,
    );
    expect(deleteFineDescription({ ...fine, photos: [fine.photos[0]] })).toContain('inclusief 1 bijlage.');
    expect(deleteFineDescription({ ...fine, photos: [] })).toBe(
      `Verwijdert de boete van 12-05-2026 op AB-123-C (${formatEUR(95)}). Deze actie kan niet ongedaan worden gemaakt.`,
    );
  });

  it('betaalstatus: naar betaald zet vandaag als betaaldatum', () => {
    expect(paidToggleCopy(fine)).toEqual({
      title: 'Markeren als betaald?',
      description: `De boete van 12-05-2026 op AB-123-C (${formatEUR(95)}) wordt als betaald gemarkeerd, met vandaag als betaaldatum.`,
      confirmLabel: 'Markeren als betaald',
    });
  });

  it('betaalstatus: terug naar niet betaald wist de betaaldatum', () => {
    expect(paidToggleCopy({ ...fine, paid: true, paid_at: '2026-06-02T10:00:00Z' })).toEqual({
      title: 'Markeren als niet betaald?',
      description: `De boete van 12-05-2026 op AB-123-C (${formatEUR(95)}) wordt weer als niet betaald gemarkeerd; de betaaldatum wordt gewist.`,
      confirmLabel: 'Markeren als niet betaald',
    });
  });

  it('gebruikt op het voertuig-tabblad het meegegeven kenteken', () => {
    expect(paidToggleCopy({ ...fine, vehicles: undefined }, 'XY-987-Z').description).toContain('op XY-987-Z');
    expect(deleteFineDescription({ ...fine, vehicles: undefined }, 'XY-987-Z')).toContain('op XY-987-Z');
  });
});

describe('vehicle-fines: auditwaarden bij verwijderen', () => {
  it('bevat de eigen kolommen plus het kenteken, zonder de gejoinde relaties', () => {
    expect(fineAuditValues(fine)).toEqual({
      vehicle_id: 'veh-1',
      license_plate: 'AB-123-C',
      employee_id: 'emp-1',
      candidate_id: 'cand-1',
      fine_date: '2026-05-12',
      due_date: '2026-06-01',
      amount: 95,
      reference_number: 'CJIB-123',
      description: 'Te hard gereden',
      notes: null,
      paid: false,
      paid_at: null,
      photos: ['qa-org/vehicle-fines/veh-1/a.jpg', 'qa-org/vehicle-fines/veh-1/b.pdf'],
    });
    expect(fineAuditValues(fine)).not.toHaveProperty('vehicles');
    expect(fineAuditValues(fine)).not.toHaveProperty('candidates');
    expect(fineAuditValues(fine)).not.toHaveProperty('employees');
  });

  it('normaliseert ontbrekende velden naar null en een lege fotolijst', () => {
    expect(fineAuditValues({ id: 'x' }, 'XY-987-Z')).toEqual({
      vehicle_id: null,
      license_plate: 'XY-987-Z',
      employee_id: null,
      candidate_id: null,
      fine_date: null,
      due_date: null,
      amount: null,
      reference_number: null,
      description: null,
      notes: null,
      paid: false,
      paid_at: null,
      photos: [],
    });
  });
});
