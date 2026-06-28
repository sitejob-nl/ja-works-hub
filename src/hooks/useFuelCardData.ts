import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { coerceConditions } from '@/lib/fuel-analysis';
import type { FuelAnalysisConditions, FuelAnalysisDataQuality } from '@/lib/fuel-analysis';

/**
 * Datalaag voor de Q8-tankpas-analyse (`FuelCardAnalysis.tsx`).
 *
 * Bundelt alle reads — org-instellingen, transacties, voertuig-datakwaliteit en
 * import-historie — plus de mutaties (review markeren, notitie, voorwaarden opslaan,
 * import verwijderen). Fase 2 van de god-component-decompositie (audit §5.6):
 * verbatim uit de pagina gelicht, zodat de pagina alleen nog orchestreert en rendert.
 *
 * Gedrag, query-keys, invalidatie-prefixes en error-handling zijn ongewijzigd.
 * De delete-bevestigingsdialog (page-state) sluit via een call-site `onSuccess`
 * op `deleteImport.mutate(...)`.
 */
export function useFuelCardData() {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();

  /* ── Queries ─────────────────────────────────────── */

  const { data: organizationSettings } = useQuery({
    queryKey: qk.fuel.analysisSettings(orgId),
    queryFn: async () => {
      return unwrap<{ settings: Record<string, unknown> | null }>(
        supabase
          .from('organizations')
          .select('settings')
          .eq('id', orgId!)
          .single(),
      );
    },
    enabled: !!orgId,
  });

  const conditions = useMemo(
    () => coerceConditions(organizationSettings?.settings?.fuel_analysis_conditions),
    [organizationSettings?.settings],
  );

  const { data: transactions = [] } = useQuery({
    queryKey: qk.fuel.transactions(orgId),
    queryFn: async () => {
      return unwrapList<any>(
        supabase
          .from('fuel_card_transactions')
          .select('*, vehicles(id, license_plate, tank_capacity_liters, avg_consumption_per_100km), employees(id, candidates(first_name, last_name))')
          .eq('organization_id', orgId!)
          .order('transaction_date', { ascending: false }),
      );
    },
    enabled: !!orgId,
  });

  const { data: dataQuality } = useQuery({
    queryKey: qk.fuel.dataQuality(orgId),
    queryFn: async (): Promise<FuelAnalysisDataQuality> => {
      const vehicles = await unwrapList<any>(
        supabase
          .from('vehicles')
          .select('id, fuel_card_reference, tank_capacity_liters, avg_consumption_per_100km, current_mileage, doors, seats')
          .eq('organization_id', orgId!),
      );
      return {
        vehiclesTotal: vehicles.length,
        withoutFuelCard: vehicles.filter((vehicle) => !String(vehicle.fuel_card_reference ?? '').trim()).length,
        withoutTankCapacity: vehicles.filter((vehicle) => !Number(vehicle.tank_capacity_liters)).length,
        withoutConsumption: vehicles.filter((vehicle) => !Number(vehicle.avg_consumption_per_100km)).length,
        withoutMileage: vehicles.filter((vehicle) => !Number(vehicle.current_mileage)).length,
        withoutDoors: vehicles.filter((vehicle) => !Number(vehicle.doors)).length,
        withoutSeats: vehicles.filter((vehicle) => !Number(vehicle.seats)).length,
      };
    },
    enabled: !!orgId,
  });

  const { data: imports = [] } = useQuery({
    queryKey: qk.fuel.imports(orgId),
    queryFn: async () => {
      return unwrapList<any>(
        supabase
          .from('fuel_card_imports')
          .select('*')
          .eq('organization_id', orgId!)
          .order('created_at', { ascending: false }),
      );
    },
    enabled: !!orgId,
  });

  /* ── Mutations ───────────────────────────────────── */

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      await unwrap(supabase.from('fuel_card_transactions').update({ reviewed: true, reviewed_at: new Date().toISOString(), reviewed_by: user?.id } as any).eq('id', id));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fuel-transactions'] }); toast.success('Gemarkeerd als bekeken'); },
  });

  const saveNote = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      await unwrap(supabase.from('fuel_card_transactions').update({ flag_notes: note } as any).eq('id', id));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fuel-transactions'] }); toast.success('Notitie opgeslagen'); },
  });

  const saveConditions = useMutation({
    mutationFn: async (next: FuelAnalysisConditions) => {
      const settings = (organizationSettings?.settings && typeof organizationSettings.settings === 'object')
        ? organizationSettings.settings
        : {};
      await unwrap(supabase
        .from('organizations')
        .update({ settings: { ...settings, fuel_analysis_conditions: next } })
        .eq('id', orgId!));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.fuel.analysisSettings(orgId) });
      toast.success('Voorwaarden opgeslagen');
    },
    onError: (e: any) => toast.error(e.message ?? 'Voorwaarden opslaan mislukt'),
  });

  const deleteImport = useMutation({
    mutationFn: async (id: string) => {
      await unwrap(supabase.from('fuel_card_transactions').delete().eq('import_batch_id', id));
      await unwrap(supabase.from('fuel_card_imports').delete().eq('id', id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-transactions'] });
      qc.invalidateQueries({ queryKey: ['fuel-card-imports'] });
      toast.success('Import verwijderd');
    },
    onError: (e: any) => toast.error(e.message ?? 'Verwijderen mislukt'),
  });

  return {
    conditions,
    transactions,
    dataQuality,
    imports,
    markReviewed,
    saveNote,
    saveConditions,
    deleteImport,
  };
}
