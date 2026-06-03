import { supabase } from '@/integrations/supabase/client';

export interface HousingAssignmentLite {
  status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
}

const ACTIVE_HOUSING = ['ingecheckt', 'gereserveerd'];

/**
 * Aantal bezette bedden in een kamer op datum `dateStr` (YYYY-MM-DD).
 *
 * Een bewoner bezet het bed op die datum als zijn verblijf de datum omvat:
 * hij is op/voor die datum ingecheckt (`check_in_date <= dateStr`, of onbekend) én
 * nog niet vertrokken (`check_out_date` leeg of ná die datum). Zo telt een
 * toekomstige reservering NIET mee voor eerdere datums, en komt een kamer vrij
 * zodra de bewoner op/voor de gekozen datum uitcheckt.
 */
export function bedsOccupiedOn(assignments: HousingAssignmentLite[] | null | undefined, dateStr: string): number {
  return (assignments ?? []).filter(
    (a) =>
      ACTIVE_HOUSING.includes(a.status ?? '') &&
      (!a.check_in_date || a.check_in_date <= dateStr) &&
      (a.check_out_date == null || a.check_out_date > dateStr),
  ).length;
}

/**
 * Heeft de kamer een vrij bed op `dateStr`? Onbekende capaciteit telt als 1
 * (zodat een lege kamer met niet-ingevulde capaciteit nooit onterecht wegvalt).
 */
export function roomHasFreeBedOn(
  unit: { capacity?: number | null; housing_assignments?: HousingAssignmentLite[] | null },
  dateStr: string,
): boolean {
  return bedsOccupiedOn(unit.housing_assignments, dateStr) < (unit.capacity ?? 1);
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
