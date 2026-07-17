import { supabase } from '@/integrations/supabase/client';
import { addDays, format, startOfWeek, getDay } from 'date-fns';
import { getDrivingDistance } from '@/lib/distance';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { getErrorMessage } from '@/lib/error-message';

/**
 * Post-placement automation:
 * 1. Generate timesheet templates for the first week
 * 2. Return available housing suggestions (team clustering + capacity)
 * 3. Send WhatsApp confirmation (if configured)
 */

interface PlacementTriggerInput {
  placementId: string;
  candidateId: string;
  employeeId?: string | null;
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
  weeklyCost: number | null;
  distanceKm: number | null;
  durationMin: number | null;
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
      candidate_id: input.candidateId,
      employee_id: input.employeeId ?? null,
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
 * Get housing suggestions ranked by driving distance to company, team clustering,
 * and available capacity.
 */
export async function getHousingSuggestions(
  organizationId: string,
  companyId: string,
  companyLat?: number | null,
  companyLng?: number | null,
): Promise<HousingSuggestion[]> {
  // Get all units with available capacity (view now includes weekly_cost + coords)
  const { data: units, error: unitErr } = await supabase
    .from('v_unit_occupancy')
    .select('unit_id, unit_name, property_name, address_city, capacity, current_occupancy, weekly_cost, address_lat, address_lng');
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
      candidates!housing_assignments_candidate_id_fkey(
        id,
        placements!placements_candidate_id_fkey(company_id, status)
      )
    `)
    .eq('organization_id', organizationId)
    .eq('status', 'ingecheckt' as any);

  // Count colleagues per unit
  const colleagueMap: Record<string, number> = {};
  for (const a of (assignments ?? []) as any[]) {
    const placements = a.candidates?.placements ?? [];
    const hasMatch = placements.some(
      (p: any) => p.company_id === companyId && p.status === 'actief'
    );
    if (hasMatch) {
      colleagueMap[a.unit_id] = (colleagueMap[a.unit_id] ?? 0) + 1;
    }
  }

  // Calculate driving distances (deduplicate by property coords)
  const distanceCache = new Map<string, { distanceKm: number; durationMin: number } | null>();
  if (companyLat && companyLng) {
    const uniqueCoords = new Map<string, { lat: number; lng: number }>();
    for (const u of available as any[]) {
      if (u.address_lat && u.address_lng) {
        const key = `${u.address_lat},${u.address_lng}`;
        uniqueCoords.set(key, { lat: u.address_lat, lng: u.address_lng });
      }
    }
    const results = await Promise.all(
      Array.from(uniqueCoords.entries()).map(async ([key, coords]) => {
        const result = await getDrivingDistance(coords.lat, coords.lng, companyLat, companyLng);
        return [key, result] as const;
      })
    );
    for (const [key, result] of results) {
      distanceCache.set(key, result);
    }
  }

  const suggestions = available.map((u: any) => {
    const coordKey = u.address_lat && u.address_lng ? `${u.address_lat},${u.address_lng}` : null;
    const dist = coordKey ? distanceCache.get(coordKey) ?? null : null;
    return {
      unitId: u.unit_id,
      unitName: u.unit_name,
      propertyName: u.property_name,
      propertyCity: u.address_city,
      capacity: u.capacity,
      currentOccupancy: Number(u.current_occupancy),
      colleagueCount: colleagueMap[u.unit_id] ?? 0,
      monthlyCost: u.weekly_cost ? Math.round(u.weekly_cost * 4.33) : null,
      weeklyCost: u.weekly_cost,
      distanceKm: dist?.distanceKm ?? null,
      durationMin: dist?.durationMin ?? null,
    };
  });

  // Sort: distance ASC (nulls last) → colleagues DESC → occupancy ASC
  return suggestions
    .sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null) {
        if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      } else if (a.distanceKm != null) return -1;
      else if (b.distanceKm != null) return 1;
      if (b.colleagueCount !== a.colleagueCount) return b.colleagueCount - a.colleagueCount;
      return a.currentOccupancy - b.currentOccupancy;
    })
    .slice(0, 10);
}

/**
 * Send WhatsApp placement confirmation (if WhatsApp is configured).
 * Returns { sent, skipped, reason } — callers can show a nette toast.
 */
export interface WhatsAppSendResult {
  sent: boolean;
  skipped: boolean;
  reason?: string;
}

export async function sendPlacementWhatsApp(
  input: PlacementTriggerInput
): Promise<WhatsAppSendResult> {
  if (!input.candidatePhone) {
    return { sent: false, skipped: true, reason: 'Geen telefoonnummer' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('whatsapp-send', {
      body: {
        to: input.candidatePhone,
        type: 'text',
        text: {
          body: `Hoi ${input.candidateName ?? ''},\n\nJe plaatsing als ${input.functionName} is bevestigd. Je start op ${input.startDate}.\n\nSucces! 🎉\n\n— SiteJob`,
        },
        candidate_id: input.candidateId,
      },
    });
    if (error) {
      // Edge function geeft 400 "WhatsApp niet geconfigureerd" wanneer de org geen
      // WhatsApp-config heeft — dat is geen technische fout maar een skip. De echte
      // melding zit in de response-body (niet in error.message).
      const bodyMsg = await extractFunctionErrorMessage(error, '');
      const combined = bodyMsg.toLowerCase();
      if (combined.includes('niet geconfigureerd') || combined.includes('afgemeld')) {
        return { sent: false, skipped: true, reason: bodyMsg };
      }
      return { sent: false, skipped: false, reason: getErrorMessage(bodyMsg || (error as any)?.message) };
    }
    // Kill-switch: 200 met paused → als concept gelogd, niet verzonden.
    if ((data as any)?.paused) {
      return { sent: false, skipped: true, reason: 'WhatsApp staat op pauze — als concept opgeslagen' };
    }
    return { sent: true, skipped: false };
  } catch (e: any) {
    return { sent: false, skipped: false, reason: getErrorMessage(e, 'Onbekende fout') };
  }
}

/**
 * Result from placement confirmation email generation.
 */
export interface PlacementConfirmationResult {
  success: boolean;
  client_email?: {
    subject: string;
    html: string;
    to: string;
    communication_id?: string;
  };
  employee_email?: {
    subject: string;
    html: string;
    to: string;
    communication_id?: string;
  };
  warnings: string[];
}

/**
 * Send placement confirmation emails (stored as concept in communications table).
 */
export async function sendPlacementConfirmation(
  placementId: string,
  sendToClient: boolean,
  sendToEmployee: boolean,
): Promise<PlacementConfirmationResult> {
  const { data, error } = await supabase.functions.invoke('send-placement-confirmation', {
    body: {
      placement_id: placementId,
      send_to_client: sendToClient,
      send_to_employee: sendToEmployee,
    },
  });

  if (error) {
    throw new Error(error.message ?? 'Fout bij versturen bevestigingsemail');
  }

  return data as PlacementConfirmationResult;
}

// Voertuig toewijzen bij een plaatsing: schrijft vehicle_assignments + zet het voertuig op 'toegewezen'.
export async function assignVehicleOnPlacement(input: {
  organizationId: string;
  vehicleId: string;
  employeeId: string;
  candidateId: string;
  startDate: string;
  startMileage?: number | null;
}): Promise<void> {
  const { error } = await supabase.from('vehicle_assignments').insert({
    organization_id: input.organizationId,
    vehicle_id: input.vehicleId,
    employee_id: input.employeeId,
    candidate_id: input.candidateId,
    assigned_date: input.startDate,
    start_mileage: input.startMileage ?? null,
  } as any);
  if (error) throw error;
  await supabase.from('vehicles').update({ status: 'toegewezen' as any }).eq('id', input.vehicleId);
}

// Interne opvolg-taken bij een plaatsing (accountmanager, contract-eigenaar "Maria", administratie).
// Contract-eigenaar: org-instelling settings.contract_owner_profile_id -> accountmanager -> backoffice -> admin.
export async function notifyPlacementStakeholders(input: {
  organizationId: string;
  placementId: string;
  candidateName: string;
  companyName: string;
  functionName: string;
  startDate: string;
  accountManagerId?: string | null;
}): Promise<void> {
  const { data: org } = await supabase.from('organizations').select('settings').eq('id', input.organizationId).maybeSingle();
  const contractOwnerSetting = (org?.settings as any)?.contract_owner_profile_id ?? null;
  const { data: profiles } = await supabase
    .from('profiles').select('id, role').eq('organization_id', input.organizationId).eq('is_active', true);
  const byRole = (role: string) => (profiles ?? []).find((p: any) => p.role === role)?.id ?? null;
  const contractOwner = contractOwnerSetting || input.accountManagerId || byRole('backoffice') || byRole('admin');
  const administratie = byRole('finance') || byRole('backoffice') || contractOwner;

  const tasks: any[] = [];
  if (input.accountManagerId) {
    tasks.push({
      organization_id: input.organizationId, assigned_to: input.accountManagerId,
      title: `Plaatsing gestart: ${input.candidateName} bij ${input.companyName}`,
      description: `${input.functionName} per ${input.startDate}.`,
      priority: 'medium', status: 'open', category: 'plaatsing',
      related_entity_type: 'plaatsing', related_entity_id: input.placementId,
    });
  }
  if (contractOwner) {
    tasks.push({
      organization_id: input.organizationId, assigned_to: contractOwner,
      title: `Contract aanmaken: ${input.candidateName} (${input.companyName})`,
      description: `${input.functionName}, startdatum ${input.startDate}.`,
      priority: 'high', status: 'open', category: 'contract',
      related_entity_type: 'plaatsing', related_entity_id: input.placementId,
    });
  }
  if (administratie && administratie !== contractOwner) {
    tasks.push({
      organization_id: input.organizationId, assigned_to: administratie,
      title: `Administratie verwerken: ${input.candidateName}`,
      description: `Plaatsing bij ${input.companyName} per ${input.startDate}.`,
      priority: 'medium', status: 'open', category: 'administratie',
      related_entity_type: 'plaatsing', related_entity_id: input.placementId,
    });
  }
  if (tasks.length) await supabase.from('recruiter_tasks').insert(tasks as any);
}
