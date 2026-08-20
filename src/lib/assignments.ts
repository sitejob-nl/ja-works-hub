import { supabase } from '@/integrations/supabase/client';
import { formatDate } from '@/lib/format';

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
