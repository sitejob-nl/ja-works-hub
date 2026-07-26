import { supabase } from '@/integrations/supabase/client';
import { addDays, format, startOfWeek, getDay } from 'date-fns';
import { getDrivingDistance } from '@/lib/distance';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { unwrap } from '@/lib/db';

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
  // Mag ontbreken: het uurtarief is optioneel op een plaatsing (meeting 17-07).
  hourlyRate: number | null;
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
    // Stringvergelijking: new Date('YYYY-MM-DD') is UTC-middernacht en sloeg daardoor
    // de startdag zelf over (lokale weekStart < UTC-start bij een maandag-start).
    if (format(day, 'yyyy-MM-dd') < input.startDate) continue;
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
 * Result from placement confirmation email generation.
 */
export interface PlacementConfirmationResult {
  success: boolean;
  preview?: boolean;
  client_email?: {
    subject: string;
    html: string;
    /** Platte, gemergede tekst — dit is wat de gebruiker in de wizard bewerkt. */
    body_text?: string;
    to: string;
    sent_via?: string;
    communication_id?: string;
  };
  employee_email?: {
    subject: string;
    html: string;
    body_text?: string;
    to: string;
    sent_via?: string;
    communication_id?: string;
  };
  warnings: string[];
}

/**
 * Door de gebruiker aangepaste bevestigingsmail. De body is platte tékst, geen HTML:
 * de server rendert 'm in de huisstijl-frame, zodat opmaak en merk intact blijven.
 */
export interface PlacementMailEdits {
  accountId?: string | null;
  clientTo?: string;
  clientSubject?: string;
  clientBody?: string;
  clientCc?: string[];
  clientBcc?: string[];
  employeeSubject?: string;
  employeeBody?: string;
  employeeCc?: string[];
  employeeBcc?: string[];
}

function mailEditsToBody(edits?: PlacementMailEdits): Record<string, unknown> {
  if (!edits) return {};
  return {
    account_id: edits.accountId ?? null,
    client_to: edits.clientTo,
    client_subject: edits.clientSubject,
    client_body: edits.clientBody,
    client_cc: edits.clientCc,
    client_bcc: edits.clientBcc,
    employee_subject: edits.employeeSubject,
    employee_body: edits.employeeBody,
    employee_cc: edits.employeeCc,
    employee_bcc: edits.employeeBcc,
  };
}

/**
 * Send placement confirmation emails (stored as concept in communications table).
 */
export async function sendPlacementConfirmation(
  placementId: string,
  sendToClient: boolean,
  sendToEmployee: boolean,
  edits?: PlacementMailEdits,
): Promise<PlacementConfirmationResult> {
  const { data, error } = await supabase.functions.invoke('send-placement-confirmation', {
    body: {
      placement_id: placementId,
      send_to_client: sendToClient,
      send_to_employee: sendToEmployee,
      ...mailEditsToBody(edits),
    },
  });

  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Fout bij versturen bevestigingsemail'));
  }

  return data as PlacementConfirmationResult;
}

/**
 * Render de bevestigingsmails zonder te versturen of loggen. Werkt met een bestaand
 * placement_id (opnieuw versturen vanaf de detailpagina) óf met losse placement-data
 * (wizard-stap Controle, vóórdat de plaatsing bestaat).
 */
export async function previewPlacementConfirmation(input: {
  placementId?: string;
  placementData?: Record<string, unknown>;
  sendToClient: boolean;
  sendToEmployee: boolean;
  edits?: PlacementMailEdits;
}): Promise<PlacementConfirmationResult> {
  const { data, error } = await supabase.functions.invoke('send-placement-confirmation', {
    body: {
      preview: true,
      placement_id: input.placementId,
      placement_data: input.placementData,
      send_to_client: input.sendToClient,
      send_to_employee: input.sendToEmployee,
      ...mailEditsToBody(input.edits),
    },
  });

  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Fout bij genereren e-mailvoorbeeld'));
  }

  return data as PlacementConfirmationResult;
}

/**
 * Portal auto-activeren bij plaatsing: zet portal_enabled, maakt (indien nodig) een
 * invite en verstuurt de welkomstmail. Retourneert wat er gebeurd is voor de UI.
 */
export async function activatePortalOnPlacement(input: {
  organizationId: string;
  candidateId: string;
  employeeId: string;
}): Promise<{ activated: boolean; emailSent: boolean; email?: string; note?: string }> {
  const { data: candData } = await supabase
    .from('candidates')
    .select('portal_enabled, email')
    .eq('id', input.candidateId)
    .single();

  if (!candData || candData.portal_enabled || !candData.email) {
    return { activated: false, emailSent: false, note: candData?.portal_enabled ? 'Portaal was al actief' : undefined };
  }

  await supabase.from('candidates').update({ portal_enabled: true }).eq('id', input.candidateId);

  // Skip als er al een actieve, niet-verlopen invite is
  const { data: existingInvite } = await supabase
    .from('portal_invites')
    .select('id, used_at, expires_at')
    .eq('candidate_id', input.candidateId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existingInvite) {
    return { activated: true, emailSent: false, note: 'Bestaande activatielink is nog geldig' };
  }

  let inviteId: string | null = null;
  try {
    const newInvite = await unwrap(supabase.from('portal_invites')
      .insert({
        organization_id: input.organizationId,
        candidate_id: input.candidateId,
        employee_id: input.employeeId,
        email: candData.email,
      })
      .select('id')
      .single());
    inviteId = newInvite?.id ?? null;
  } catch (e: any) {
    console.warn('Portal invite aanmaken mislukt:', e.message);
  }
  if (!inviteId) {
    return { activated: true, emailSent: false };
  }

  try {
    const { data: sendResult } = await supabase.functions.invoke('send-portal-invite', {
      body: { invite_id: inviteId },
    });
    return { activated: true, emailSent: Boolean((sendResult as any)?.sent), email: candData.email };
  } catch (sendErr) {
    console.warn('Welkomstmail mislukt:', sendErr);
    return { activated: true, emailSent: false, email: candData.email };
  }
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
