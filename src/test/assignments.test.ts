import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Inleveren en verwijderen van een voertuigtoewijzing — gedeeld door de voertuigkant en
 * het medewerkersdossier. De Supabase-client is op modulegrens gemockt met een builder
 * die elke aanroep (tabel, operatie, payload, filters) vastlegt, zodat we niet alleen
 * de uitkomst maar ook de writes zelf kunnen controleren: welke rij, welke org-scope,
 * welke voertuigstatus.
 */
const h = vi.hoisted(() => {
  type Call = { table: string; op: string; payload?: any; filters: Array<[string, any]>; selected?: string };
  const state: { calls: Call[]; results: Record<string, any> } = { calls: [], results: {} };
  const makeBuilder = (table: string) => {
    const call: Call = { table, op: '', filters: [] };
    const resultFor = () => {
      const r = state.results[`${table}.${call.op}`];
      return typeof r === 'function' ? r(call) : (r ?? { data: null, error: null });
    };
    const b: any = {};
    for (const op of ['select', 'update', 'delete', 'insert']) {
      b[op] = (payload?: any) => {
        if (!call.op) {
          call.op = op;
          call.payload = payload;
          state.calls.push(call);
        } else if (op === 'select') {
          // `.select('id')` ná een delete/update — unwrapDeleted zet die zelf.
          call.selected = payload;
        }
        return b;
      };
    }
    b.eq = (column: string, value: any) => { call.filters.push([column, value]); return b; };
    b.single = () => Promise.resolve(resultFor());
    b.maybeSingle = () => Promise.resolve(resultFor());
    b.then = (resolve: any, reject: any) => Promise.resolve(resultFor()).then(resolve, reject);
    return b;
  };
  return { state, makeBuilder };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => h.makeBuilder(table) },
}));

const auditSpy = vi.fn((_params: unknown) => Promise.resolve());
vi.mock('@/lib/audit', () => ({ logAudit: (params: any) => auditSpy(params) }));

import {
  VEHICLE_ASSIGNMENT_NOT_RETURNED,
  deleteVehicleAssignment,
  parseVehicleMileage,
  returnVehicleAssignment,
  syncVehicleStatus,
  vehicleAssignmentErrorMessage,
  vehicleReturnIssue,
  vehicleReturnReady,
} from '@/lib/assignments';

const ORG = 'org-1';
const VEHICLE = 'veh-1';
const TODAY = '2026-09-07';

const callsFor = (table: string, op: string) => h.state.calls.filter((c) => c.table === table && c.op === op);

const vehicleFixture = (status: string, assignments: Array<{ assigned_date: string; returned_date: string | null }>) => ({
  data: { status, vehicle_assignments: assignments },
  error: null,
});

beforeEach(() => {
  h.state.calls = [];
  h.state.results = {};
  auditSpy.mockClear();
});

describe('parseVehicleMileage', () => {
  it('accepteert alleen hele kilometers', () => {
    expect(parseVehicleMileage('12345')).toBe(12345);
    expect(parseVehicleMileage(' 7 ')).toBe(7);
    expect(parseVehicleMileage('12.5')).toBeNull();
    expect(parseVehicleMileage('-3')).toBeNull();
    expect(parseVehicleMileage('')).toBeNull();
    expect(parseVehicleMileage('abc')).toBeNull();
  });
});

describe('vehicleReturnIssue', () => {
  const base = { assignedDate: '2026-09-01', startMileage: 10000 };

  it('geeft geen melding bij lege velden — de knop blokkeert, het veld kleurt niet rood', () => {
    expect(vehicleReturnIssue({ ...base, returnedDate: '', endMileage: '' })).toBeNull();
    expect(vehicleReturnIssue({ ...base, returnedDate: '2026-09-07', endMileage: '' })).toBeNull();
  });

  it('weigert een inleverdatum vóór de toewijsdatum', () => {
    expect(vehicleReturnIssue({ ...base, returnedDate: '2026-08-31', endMileage: '' })).toMatch(/vóór de toewijsdatum/);
    expect(vehicleReturnIssue({ ...base, returnedDate: '2026-09-01', endMileage: '' })).toBeNull();
  });

  it('weigert een eindstand onder de beginstand', () => {
    expect(vehicleReturnIssue({ ...base, returnedDate: TODAY, endMileage: '9999' })).toMatch(/lager dan de beginstand/);
    expect(vehicleReturnIssue({ ...base, returnedDate: TODAY, endMileage: '10000' })).toBeNull();
  });

  it('weigert een kilometerstand die geen heel getal is', () => {
    expect(vehicleReturnIssue({ ...base, returnedDate: TODAY, endMileage: '10.5' })).toMatch(/geldige kilometerstand/);
  });

  it('laat de ondergrens los als de beginstand onbekend is', () => {
    expect(vehicleReturnIssue({ assignedDate: null, startMileage: null, returnedDate: '2020-01-01', endMileage: '1' })).toBeNull();
  });
});

describe('vehicleReturnReady', () => {
  const base = { assignedDate: '2026-09-01', startMileage: 10000 };

  it('is pas waar als beide velden gevuld zijn en er geen bezwaar is', () => {
    expect(vehicleReturnReady({ ...base, returnedDate: '', endMileage: '10500' })).toBe(false);
    expect(vehicleReturnReady({ ...base, returnedDate: TODAY, endMileage: '' })).toBe(false);
    expect(vehicleReturnReady({ ...base, returnedDate: TODAY, endMileage: '9000' })).toBe(false);
    expect(vehicleReturnReady({ ...base, returnedDate: TODAY, endMileage: '10500' })).toBe(true);
  });
});

describe('syncVehicleStatus', () => {
  it('zet het voertuig op beschikbaar als er geen toewijzing meer loopt', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('toegewezen', [{ assigned_date: '2026-09-01', returned_date: TODAY }]);
    const status = await syncVehicleStatus(ORG, VEHICLE, {}, TODAY);
    expect(status).toBe('beschikbaar');
    const [update] = callsFor('vehicles', 'update');
    expect(update.payload).toEqual({ status: 'beschikbaar' });
    expect(update.filters).toEqual([['organization_id', ORG], ['id', VEHICLE]]);
  });

  it('schrijft niets als de status al klopt en er niets extra te schrijven is', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('toegewezen', [{ assigned_date: '2026-09-01', returned_date: null }]);
    expect(await syncVehicleStatus(ORG, VEHICLE, {}, TODAY)).toBeNull();
    expect(callsFor('vehicles', 'update')).toHaveLength(0);
  });

  it('neemt de kilometerstand mee in dezelfde write, ook zonder statuswijziging', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('toegewezen', [{ assigned_date: '2026-09-01', returned_date: '2026-09-30' }]);
    expect(await syncVehicleStatus(ORG, VEHICLE, { current_mileage: 12000 }, TODAY)).toBeNull();
    expect(callsFor('vehicles', 'update')[0].payload).toEqual({ current_mileage: 12000 });
  });

  it('zet een hangende beschikbaar-stand terug op toegewezen als er wél een toewijzing loopt', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('beschikbaar', [{ assigned_date: '2026-09-01', returned_date: null }]);
    expect(await syncVehicleStatus(ORG, VEHICLE, {}, TODAY)).toBe('toegewezen');
  });

  it('laat onderhoud en uit_dienst met rust', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('onderhoud', []);
    expect(await syncVehicleStatus(ORG, VEHICLE, {}, TODAY)).toBeNull();
    expect(callsFor('vehicles', 'update')).toHaveLength(0);
  });

  it('scopet de leesactie op organisatie én voertuig', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('beschikbaar', []);
    await syncVehicleStatus(ORG, VEHICLE, {}, TODAY);
    expect(callsFor('vehicles', 'select')[0].filters).toEqual([['organization_id', ORG], ['id', VEHICLE]]);
  });
});

describe('returnVehicleAssignment', () => {
  const assignment = { id: 'va-1', vehicle_id: VEHICLE, assigned_date: '2026-09-01', start_mileage: 10000, returned_date: null, end_mileage: null };

  it('sluit de toewijzing, zet de eindstand op het voertuig en het voertuig op beschikbaar', async () => {
    // Wat de database ná de update teruggeeft: de toewijzing is afgesloten (datum ruim
    // in het verleden, zodat de test niet aan de echte kalender hangt) en niets loopt meer.
    h.state.results['vehicles.select'] = vehicleFixture('toegewezen', [{ assigned_date: '2026-01-01', returned_date: '2026-01-02' }]);
    const { vehicleStatus } = await returnVehicleAssignment({ organizationId: ORG, assignment, returnedDate: '2026-09-07', endMileage: 10500 });
    expect(vehicleStatus).toBe('beschikbaar');

    const [assignmentUpdate] = callsFor('vehicle_assignments', 'update');
    expect(assignmentUpdate.payload).toEqual({ returned_date: '2026-09-07', end_mileage: 10500 });
    expect(assignmentUpdate.filters).toEqual([['organization_id', ORG], ['id', 'va-1']]);

    const [vehicleUpdate] = callsFor('vehicles', 'update');
    expect(vehicleUpdate.payload).toEqual({ current_mileage: 10500, status: 'beschikbaar' });
  });

  it('legt een auditregel vast met oude en nieuwe waarden', async () => {
    h.state.results['vehicles.select'] = vehicleFixture('toegewezen', []);
    await returnVehicleAssignment({ organizationId: ORG, assignment, returnedDate: '2026-09-07', endMileage: 10500 });
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      tableName: 'vehicle_assignments',
      recordId: 'va-1',
      oldValues: { returned_date: null, end_mileage: null },
      newValues: { returned_date: '2026-09-07', end_mileage: 10500 },
    }));
  });

  it('gooit de databasefout door en logt dan géén audit', async () => {
    h.state.results['vehicle_assignments.update'] = { data: null, error: { code: '23514', message: 'Dit voertuig is in die periode al toegewezen (10-09-2026 t/m onbepaald)' } };
    await expect(returnVehicleAssignment({ organizationId: ORG, assignment, returnedDate: '2026-09-15', endMileage: 10500 }))
      .rejects.toMatchObject({ code: '23514' });
    expect(callsFor('vehicles', 'update')).toHaveLength(0);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('deleteVehicleAssignment', () => {
  const returned = { id: 'va-2', vehicle_id: VEHICLE, assigned_date: '2026-08-01', returned_date: '2026-08-20', start_mileage: 100, end_mileage: 900 };

  it('weigert een lopende toewijzing — eerst inleveren', async () => {
    await expect(deleteVehicleAssignment({ organizationId: ORG, assignment: { ...returned, returned_date: null } }))
      .rejects.toThrow(VEHICLE_ASSIGNMENT_NOT_RETURNED);
    expect(callsFor('vehicle_assignments', 'delete')).toHaveLength(0);
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('verwijdert org-gescoped, telt de geraakte rijen en logt een auditregel met de oude waarden', async () => {
    h.state.results['vehicle_assignments.delete'] = { data: [{ id: 'va-2' }], error: null };
    h.state.results['vehicles.select'] = vehicleFixture('beschikbaar', []);
    await deleteVehicleAssignment({ organizationId: ORG, assignment: returned });

    const [del] = callsFor('vehicle_assignments', 'delete');
    expect(del.filters).toEqual([['organization_id', ORG], ['id', 'va-2']]);
    expect(del.selected).toBe('id');
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete',
      tableName: 'vehicle_assignments',
      recordId: 'va-2',
      oldValues: expect.objectContaining({ vehicle_id: VEHICLE, assigned_date: '2026-08-01', returned_date: '2026-08-20', end_mileage: 900 }),
    }));
  });

  // De kern van de eerdere bug (2026-08-13): RLS filtert een DELETE stil weg.
  it('meldt een stille 0-rijen-delete als fout en raakt het voertuig dan niet aan', async () => {
    h.state.results['vehicle_assignments.delete'] = { data: [], error: null };
    await expect(deleteVehicleAssignment({ organizationId: ORG, assignment: returned })).rejects.toThrow(/niet toegestaan/i);
    expect(callsFor('vehicles', 'select')).toHaveLength(0);
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('zet het voertuig terug op beschikbaar als de verwijderde rij de laatste lopende was', async () => {
    h.state.results['vehicle_assignments.delete'] = { data: [{ id: 'va-2' }], error: null };
    h.state.results['vehicles.select'] = vehicleFixture('toegewezen', []);
    const { vehicleStatus } = await deleteVehicleAssignment({ organizationId: ORG, assignment: returned });
    expect(vehicleStatus).toBe('beschikbaar');
    expect(callsFor('vehicles', 'update')[0].payload).toEqual({ status: 'beschikbaar' });
  });
});

describe('vehicleAssignmentErrorMessage', () => {
  it('toont de periode-uitleg van de overlap-grendel in plaats van de generieke 23514-tekst', () => {
    const e = { code: '23514', message: 'Dit voertuig is in die periode al toegewezen (10-09-2026 t/m onbepaald)' };
    expect(vehicleAssignmentErrorMessage(e, 'Inleveren is niet gelukt.')).toBe(e.message);
  });

  it('valt voor andere check-fouten terug op de vriendelijke vertaling', () => {
    const e = { code: '23514', message: 'new row for relation "vehicle_assignments" violates check constraint "x"' };
    expect(vehicleAssignmentErrorMessage(e, 'Inleveren is niet gelukt.')).toBe('De ingevoerde waarde is niet toegestaan.');
  });

  it('laat een eigen Nederlandse melding ongemoeid door', () => {
    expect(vehicleAssignmentErrorMessage(new Error(VEHICLE_ASSIGNMENT_NOT_RETURNED), 'x')).toBe(VEHICLE_ASSIGNMENT_NOT_RETURNED);
  });
});
