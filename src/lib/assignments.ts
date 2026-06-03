import { supabase } from '@/integrations/supabase/client';

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
