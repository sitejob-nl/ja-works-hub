import { supabase } from '@/integrations/supabase/client';
import { addDays, format, startOfWeek, getDay } from 'date-fns';

/**
 * Post-placement automation:
 * 1. Generate timesheet templates for the first week
 * 2. Return available housing suggestions (team clustering + capacity)
 * 3. Send WhatsApp confirmation (if configured)
 */

interface PlacementTriggerInput {
  placementId: string;
  employeeId: string;
  companyId: string;
  organizationId: string;
  startDate: string;
  functionName: string;
  hourlyRate: number;
  candidatePhone?: string | null;
  candidateName?: string;
}

export interface HousingSuggestion {
  unitId: string;
  unitName: string;
  propertyName: string;
  propertyCity: string;
  capacity: number;
  currentOccupancy: number;
  colleagueCount: number;
  monthlyCost: number | null;
}

/**
 * Generate timesheet template entries (Mon-Fri) for the first week of a placement.
 */
export async function generateTimesheetTemplates(input: PlacementTriggerInput): Promise<number> {
  const start = new Date(input.startDate);
  const weekStart = startOfWeek(start, { weekStartsOn: 1 });

  const entries = [];
  for (let i = 0; i < 5; i++) {
    const day = addDays(weekStart, i);
    if (day < start) continue; // skip days before start
    entries.push({
      organization_id: input.organizationId,
      employee_id: input.employeeId,
      placement_id: input.placementId,
      work_date: format(day, 'yyyy-MM-dd'),
      hours: 8,
      overtime_hours: 0,
      hourly_rate: input.hourlyRate,
      status: 'concept' as any,
      source: 'handmatig' as any,
      notes: `Auto-gegenereerd bij plaatsing ${input.functionName}`,
    });
  }

  if (entries.length === 0) return 0;

  const { error } = await supabase.from('timesheets').insert(entries);
  if (error) throw error;
  return entries.length;
}

/**
 * Get housing suggestions ranked by team clustering (colleagues at same company)
 * and available capacity.
 */
export async function getHousingSuggestions(
  organizationId: string,
  companyId: string
): Promise<HousingSuggestion[]> {
  // Get all units with available capacity
  const { data: units, error: unitErr } = await supabase
    .from('v_unit_occupancy')
    .select('unit_id, unit_name, property_name, property_city, capacity, current_occupancy, monthly_cost');
  if (unitErr) throw unitErr;

  const available = (units ?? []).filter(
    (u: any) => Number(u.current_occupancy) < u.capacity
  );

  if (available.length === 0) return [];

  // Get current housing assignments to find colleagues from same company
  const { data: assignments } = await supabase
    .from('housing_assignments')
    .select(`
      unit_id,
      employees!housing_assignments_employee_id_fkey(
        id,
        placements!placements_employee_id_fkey(company_id, status)
      )
    `)
    .eq('organization_id', organizationId)
    .eq('status', 'ingecheckt' as any);

  // Count colleagues per unit
  const colleagueMap: Record<string, number> = {};
  for (const a of (assignments ?? []) as any[]) {
    const placements = a.employees?.placements ?? [];
    const hasMatch = placements.some(
      (p: any) => p.company_id === companyId && p.status === 'actief'
    );
    if (hasMatch) {
      colleagueMap[a.unit_id] = (colleagueMap[a.unit_id] ?? 0) + 1;
    }
  }

  return available
    .map((u: any) => ({
      unitId: u.unit_id,
      unitName: u.unit_name,
      propertyName: u.property_name,
      propertyCity: u.property_city,
      capacity: u.capacity,
      currentOccupancy: Number(u.current_occupancy),
      colleagueCount: colleagueMap[u.unit_id] ?? 0,
      monthlyCost: u.monthly_cost,
    }))
    .sort((a, b) => b.colleagueCount - a.colleagueCount || a.currentOccupancy - b.currentOccupancy)
    .slice(0, 10);
}

/**
 * Send WhatsApp placement confirmation (if WhatsApp is configured).
 */
export async function sendPlacementWhatsApp(
  input: PlacementTriggerInput
): Promise<boolean> {
  if (!input.candidatePhone) return false;

  try {
    const { error } = await supabase.functions.invoke('whatsapp-send', {
      body: {
        to: input.candidatePhone,
        message: `Hoi ${input.candidateName ?? ''},\n\nJe plaatsing als ${input.functionName} is bevestigd. Je start op ${input.startDate}.\n\nSucces! 🎉\n\n— SiteJob`,
      },
    });
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}
