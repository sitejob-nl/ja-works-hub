import { supabase } from '@/integrations/supabase/client';
import { formatDate } from '@/lib/format';
import { unwrap, unwrapDeleted } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { toFriendlyError } from '@/lib/errorMessages';
import { todayISO } from '@/lib/tasks';
import { vehicleStoredStatusFor } from '@/lib/vehicle-availability';

/**
 * "Toegewezen door" met de datum erbij.
 *
 * De naam alleen (punt 13) liet nog open wánneer de toewijzing is vastgelegd,
 * terwijl juist die datum antwoord geeft op "sinds wanneer rijdt hij hierin".
 * `created_at` is bewust de registratiedatum en niet `assigned_date`/`check_in_date`:
 * die twee staan al apart in beeld en kunnen in de toekomst liggen.
 *
 * Toewijzingen van vóór augustus 2026 hebben geen `created_by` — die vallen terug
 * op een streepje in plaats van een halve regel.
 */
export function formatAssignedBy(
  row: { profiles?: { full_name?: string | null } | null; created_at?: string | null } | null | undefined,
): string {
  const name = row?.profiles?.full_name?.trim();
  if (!name) return '—';
  const date = row?.created_at ? formatDate(row.created_at) : null;
  return date ? `${name} · ${date}` : name;
}

/**
 * Vindt de legacy `employees`-rij voor een kandidaat, of maakt hem aan als die
 * nog niet bestaat. Nodig omdat huisvestings- en voertuigtoewijzingen op
 * `employee_id` keyen terwijl de UI met `candidates` werkt.
 *
 * Gedeeld door de toewijs-flows (huisvesting, transport) zodat het find-or-create
 * gedrag overal identiek is. Gebaseerd op de oorspronkelijke implementatie in
 * ResidentsTab / HousingSuggestionsCard.
 */
export async function resolveEmployeeId(
  candidate: { id: string; employee_number?: string | null; employee_status?: string | null },
  organizationId: string,
  startDate: string,
): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from('employees')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('candidate_id', candidate.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await supabase
    .from('employees')
    .insert({
      organization_id: organizationId,
      candidate_id: candidate.id,
      employee_number: candidate.employee_number ?? null,
      start_date: startDate,
      status: (candidate.employee_status === 'ziek' ? 'ziek' : candidate.employee_status ?? 'actief') as any,
    })
    .select('id')
    .single();
  if (createError) throw createError;
  return created.id;
}

// ---------------------------------------------------------------------------
// Voertuigtoewijzing inleveren / verwijderen
//
// Gedeeld door de voertuigkant (VehicleAssignmentsTab) en de medewerkerkant
// (EmployeeTransportTab), zodat beide schermen dezelfde uitkomst geven: dezelfde
// velden, dezelfde voertuigstatus, dezelfde auditregel. Vóór dit deelde alleen de
// voertuigkant deze acties, en moest je voor een correctie het dossier verlaten.
// ---------------------------------------------------------------------------

/** De velden van een toewijzing die inleveren en verwijderen nodig hebben. */
export interface VehicleAssignmentRef {
  id: string;
  vehicle_id: string;
  assigned_date?: string | null;
  returned_date?: string | null;
  start_mileage?: number | null;
  end_mileage?: number | null;
}

export type VehicleStoredStatus = 'beschikbaar' | 'toegewezen';

export interface VehicleReturnInput {
  /** Toewijsdatum en beginstand van de toewijzing: de ondergrens van de invoer. */
  assignedDate?: string | null;
  startMileage?: number | null;
  /** Ruwe formulierinvoer. */
  returnedDate: string;
  endMileage: string;
}

/** Hele kilometers, anders null — parseInt zou "12.5" stilzwijgend afkappen. */
export function parseVehicleMileage(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Wat er mis is met de inleverinvoer, of null. Lege velden geven géén melding: de
 * aanroeper blokkeert dan alleen de knop (zie `vehicleReturnReady`), want rood op een
 * veld dat je nog niet hebt aangeraakt leest als een fout die je zelf hebt gemaakt.
 */
export function vehicleReturnIssue(input: VehicleReturnInput): string | null {
  if (input.returnedDate && input.assignedDate && input.returnedDate < input.assignedDate) {
    return `De inleverdatum ligt vóór de toewijsdatum (${formatDate(input.assignedDate)}).`;
  }
  if (input.endMileage.trim() !== '') {
    const km = parseVehicleMileage(input.endMileage);
    if (km == null) return 'Vul een geldige kilometerstand in (hele kilometers).';
    if (input.startMileage != null && km < input.startMileage) {
      return `De eindstand is lager dan de beginstand (${input.startMileage.toLocaleString('nl-NL')} km).`;
    }
  }
  return null;
}

/** Beide velden gevuld en geen bezwaar: de inleverknop mag aan. */
export function vehicleReturnReady(input: VehicleReturnInput): boolean {
  return !!input.returnedDate && input.endMileage.trim() !== '' && vehicleReturnIssue(input) === null;
}

/**
 * Zet `vehicles.status` gelijk aan wat de toewijzingen zeggen: 'toegewezen' zolang er op
 * `today` een toewijzing loopt, anders 'beschikbaar'. Handmatige standen (onderhoud /
 * uit_dienst) blijven staan. `extra` (bv. `current_mileage`) gaat in dezelfde write mee.
 * Geeft de nieuwe status terug, of null als die niet hoefde te veranderen.
 *
 * Bewust een herberekening uit de database en niet "de status die bij deze mutatie
 * hoort": zo zet elke inlever- of verwijderactie ook een stand recht die om een andere
 * reden was blijven hangen, zoals een reservering die inmiddels is ingegaan.
 */
export async function syncVehicleStatus(
  organizationId: string,
  vehicleId: string,
  extra: { current_mileage?: number } = {},
  today: string = todayISO(),
): Promise<VehicleStoredStatus | null> {
  const vehicle = await unwrap<any>(
    supabase
      .from('vehicles')
      .select('status, vehicle_assignments!vehicle_assignments_vehicle_id_fkey(assigned_date, returned_date)')
      .eq('organization_id', organizationId)
      .eq('id', vehicleId)
      .single(),
  );
  const next = vehicleStoredStatusFor(vehicle ?? {}, today);
  const patch: Record<string, unknown> = { ...extra };
  if (next) patch.status = next;
  if (Object.keys(patch).length === 0) return null;
  await unwrap(
    supabase.from('vehicles').update(patch as any).eq('organization_id', organizationId).eq('id', vehicleId),
  );
  return next;
}

/**
 * Beëindigt een toewijzing: inleverdatum + eindstand op de toewijzing, eindstand als
 * actuele kilometerstand op het voertuig, en de voertuigstatus die daarbij hoort.
 * Een inleverdatum in de toekomst laat de toewijzing tot die dag lopen; het voertuig
 * blijft dan 'toegewezen'.
 */
export async function returnVehicleAssignment(input: {
  organizationId: string;
  assignment: VehicleAssignmentRef;
  returnedDate: string;
  endMileage: number;
}): Promise<{ vehicleStatus: VehicleStoredStatus | null }> {
  const { organizationId, assignment, returnedDate, endMileage } = input;
  const newValues = { returned_date: returnedDate, end_mileage: endMileage };
  await unwrap(
    supabase
      .from('vehicle_assignments')
      .update(newValues)
      .eq('organization_id', organizationId)
      .eq('id', assignment.id),
  );
  const vehicleStatus = await syncVehicleStatus(organizationId, assignment.vehicle_id, { current_mileage: endMileage });
  logAudit({
    action: 'update',
    tableName: 'vehicle_assignments',
    recordId: assignment.id,
    oldValues: { returned_date: assignment.returned_date ?? null, end_mileage: assignment.end_mileage ?? null },
    newValues,
    reason: 'Voertuig ingeleverd',
  });
  return { vehicleStatus };
}

export const VEHICLE_ASSIGNMENT_NOT_RETURNED =
  'Voertuig is nog niet ingeleverd — eerst inleveren voordat de toewijzing verwijderd kan worden.';

/**
 * Verwijdert een afgeronde toewijzing. Een lopende toewijzing moet eerst worden
 * ingeleverd (zelfde regel als op de voertuigkant); zo blijft de eindstand bewaard en
 * kan een auto niet ongemerkt "in gebruik" blijven zonder toewijzing.
 */
export async function deleteVehicleAssignment(input: {
  organizationId: string;
  assignment: VehicleAssignmentRef;
}): Promise<{ vehicleStatus: VehicleStoredStatus | null }> {
  const { organizationId, assignment } = input;
  if (!assignment.returned_date) throw new Error(VEHICLE_ASSIGNMENT_NOT_RETURNED);
  // Rowcount tellen: RLS filtert een geweigerde DELETE stil weg (0 rijen, geen error).
  await unwrapDeleted(
    supabase.from('vehicle_assignments').delete().eq('organization_id', organizationId).eq('id', assignment.id),
  );
  const vehicleStatus = await syncVehicleStatus(organizationId, assignment.vehicle_id);
  logAudit({
    action: 'delete',
    tableName: 'vehicle_assignments',
    recordId: assignment.id,
    oldValues: {
      vehicle_id: assignment.vehicle_id,
      assigned_date: assignment.assigned_date ?? null,
      returned_date: assignment.returned_date ?? null,
      start_mileage: assignment.start_mileage ?? null,
      end_mileage: assignment.end_mileage ?? null,
    },
  });
  return { vehicleStatus };
}

/**
 * Foutmelding voor een mislukte toewijzingsmutatie. De overlap-grendel in de database
 * (`vehicle_assignments_no_overlap`, errcode 23514) legt in het Nederlands uit wélke
 * periode botst; die tekst willen we tonen in plaats van de generieke 23514-vertaling.
 */
export function vehicleAssignmentErrorMessage(error: unknown, fallback: string): string {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e?.code === '23514' && typeof e.message === 'string' && /toegewezen/i.test(e.message)) {
    return e.message;
  }
  return toFriendlyError(error, fallback);
}
