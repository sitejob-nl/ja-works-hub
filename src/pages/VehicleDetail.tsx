import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapDeleted, unwrapList } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { vehicleDisplayStatus } from '@/lib/vehicle-availability';
import { qk } from '@/lib/query-keys';
import { toFriendlyError } from '@/lib/errorMessages';
import { ChevronRight, Edit, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import VehicleInfoTab from '@/components/transport/tabs/VehicleInfoTab';
import VehicleAssignmentsTab from '@/components/transport/tabs/VehicleAssignmentsTab';
import VehicleMileageTab from '@/components/transport/tabs/VehicleMileageTab';
import VehicleFinesTab from '@/components/transport/tabs/VehicleFinesTab';
import VehicleDamageTab from '@/components/transport/tabs/VehicleDamageTab';
import TasksSection from '@/components/shared/TasksSection';
import { useTabSearchParam } from '@/hooks/useTabSearchParam';
import { useAuth } from '@/contexts/AuthContext';
import { fetchFacilityTransportSnapshot, isFacilityRole, saveFacilityOperationalEntity } from '@/lib/facility';

const statusBadge: Record<string, string> = {
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  toegewezen: 'bg-blue-100 text-blue-700 border-0',
  gereserveerd: 'bg-purple-100 text-purple-700 border-0',
  onderhoud: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};
// 'Non-Actief' i.p.v. 'Uit dienst' (punt 18) — zie Transport.tsx.
const statusLabel: Record<string, string> = {
  beschikbaar: 'Beschikbaar', toegewezen: 'Toegewezen', onderhoud: 'Onderhoud', uit_dienst: 'Non-Actief',
};
const displayStatusLabel: Record<string, string> = { ...statusLabel, gereserveerd: 'Gereserveerd' };

const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role, profile } = useAuth();
  const isFacility = isFacilityRole(role);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeTab, setActiveTab] = useTabSearchParam('gegevens');
  const visibleTab = isFacility && !['gegevens', 'toewijzingen', 'schade'].includes(activeTab) ? 'gegevens' : activeTab;

  const { data: vehicle, isLoading } = useQuery({
    queryKey: isFacility ? ['facility-transport-snapshot', profile?.organization_id, id] : qk.vehicles.detail(id),
    queryFn: async () => {
      if (isFacility) {
        const snapshot = await fetchFacilityTransportSnapshot(id);
        const safeVehicle = snapshot.vehicles.find((item: any) => item.id === id);
        if (!safeVehicle) throw new Error('Voertuig niet gevonden');
        return safeVehicle;
      }
      return unwrap(supabase.from('vehicles').select(`
        *,
        vehicle_assignments!vehicle_assignments_vehicle_id_fkey(
          id, assigned_date, returned_date, start_mileage, end_mileage,
          employees!vehicle_assignments_employee_id_fkey(
            id, candidates!employees_candidate_id_fkey(first_name, last_name)
          )
        )
      `).eq('id', id!).single());
    },
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (isFacility) {
        await saveFacilityOperationalEntity('vehicle', { id: id!, status });
      } else {
        await unwrap(supabase.from('vehicles').update({ status } as any).eq('id', id!));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.vehicles.detail(id) });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['facility-transport-snapshot'] });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Counts voor delete-dialog: hoeveel kind-records gaan mee weg
  const { data: deleteImpact } = useQuery({
    queryKey: qk.vehicles.deleteImpact(id),
    queryFn: async () => {
      const [assignments, damage, fines, mileage, fuel] = await Promise.all([
        supabase.from('vehicle_assignments').select('id', { count: 'exact', head: true }).eq('vehicle_id', id!),
        supabase.from('vehicle_damage_reports').select('id, photos').eq('vehicle_id', id!),
        supabase.from('vehicle_fines' as any).select('id, photos').eq('vehicle_id', id!),
        supabase.from('mileage_entries').select('id', { count: 'exact', head: true }).eq('vehicle_id', id!),
        supabase.from('fuel_card_transactions').select('id', { count: 'exact', head: true }).eq('vehicle_id', id!),
      ]);
      const damagePhotos = (damage.data ?? []).flatMap((d: any) => (d.photos ?? []) as string[]);
      const finePhotos = (fines.data ?? []).flatMap((f: any) => (f.photos ?? []) as string[]);
      return {
        assignments: assignments.count ?? 0,
        damage: damage.data?.length ?? 0,
        fines: fines.data?.length ?? 0,
        mileage: mileage.count ?? 0,
        fuel: fuel.count ?? 0,
        damagePhotos,
        finePhotos,
      };
    },
    enabled: !isFacility && deleteOpen && !!id,
  });

  const hardDelete = useMutation({
    mutationFn: async () => {
      // Rechten-precheck vóór élke delete. De child-tabellen staan op is_internal_user(),
      // maar `vehicles` zelf is admin-only: zonder deze poort wist een intercedent eerst de
      // tankpas-, schade- en toewijzingshistorie en strandt daarna op het voertuig — een
      // half uitgevoerde, onomkeerbare actie met een foutmelding die suggereert dat er
      // niets is gebeurd. De FK's zijn RESTRICT/NO ACTION, dus omkeren van de volgorde kan niet.
      if (role !== 'admin') {
        throw new Error('Alleen een beheerder kan een voertuig definitief verwijderen.');
      }

      // Pre-check: weiger als er een actieve toewijzing is
      const active = await unwrapList<any>(supabase
        .from('vehicle_assignments')
        .select('id')
        .eq('vehicle_id', id!)
        .is('returned_date', null)
        .limit(1));
      if ((active ?? []).length > 0) {
        throw new Error('Voertuig heeft een actieve toewijzing — eerst inleveren voordat je kunt verwijderen.');
      }

      // Delete child rijen die niet via CASCADE gaan (RESTRICT / NO ACTION).
      // Geen rowcount-check: een voertuig zónder ritten/boetes/schades is normaal.
      await unwrap(supabase.from('fuel_card_transactions').delete().eq('vehicle_id', id!));
      await unwrap(supabase.from('vehicle_damage_reports').delete().eq('vehicle_id', id!));
      await unwrap(supabase.from('vehicle_assignments').delete().eq('vehicle_id', id!));

      // Vehicle delete cascadeert mileage_entries + vehicle_fines via FK.
      // Wél een rowcount-check: raakt deze delete 0 rijen (RLS weigert stil), dan meldde de
      // UI eerder 'Voertuig verwijderd' + navigeerde weg terwijl het voertuig bleef bestaan.
      await unwrapDeleted(
        supabase.from('vehicles').delete().eq('id', id!),
        'Dit voertuig kon niet worden verwijderd — je hebt hiervoor mogelijk beheerdersrechten nodig.',
      );

      // Foto's pas opruimen als de rij écht weg is; anders zijn bij een geweigerde delete
      // de foto's verdwenen en staat het voertuig er nog.
      if (deleteImpact?.damagePhotos && deleteImpact.damagePhotos.length > 0) {
        await supabase.storage.from('documents').remove(deleteImpact.damagePhotos);
      }
      if (deleteImpact?.finePhotos && deleteImpact.finePhotos.length > 0) {
        await supabase.storage.from('documents').remove(deleteImpact.finePhotos);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Voertuig verwijderd');
      navigate('/transport');
    },
    onError: (e: any) => {
      toast.error(toFriendlyError(e, 'Verwijderen mislukt'));
      setDeleteOpen(false);
    },
  });

  if (isLoading || !vehicle) return <div className="p-8 text-muted-foreground">Laden...</div>;

  const activeAssignment = ((vehicle.assignments ?? vehicle.vehicle_assignments) as any[])?.find((a: any) => !a.returned_date);
  // Punt 17 — een reservering is een toewijzing die later begint; de status wordt
  // daaruit afgeleid zodat hij niet kan verouderen.
  const displayStatus = vehicleDisplayStatus(
    { status: vehicle.status, vehicle_assignments: (vehicle.assignments ?? vehicle.vehicle_assignments) as any[] },
    new Date().toISOString().slice(0, 10),
  );
  const assignee = activeAssignment?.employees?.candidates ?? activeAssignment?.worker ?? activeAssignment;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/transport" className="hover:text-foreground">Transport</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground truncate">{vehicle.license_plate}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold">{vehicle.license_plate}</h1>
          <p className="text-sm text-muted-foreground">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className={statusBadge[displayStatus.key] ?? ''}>{displayStatusLabel[displayStatus.key] ?? displayStatus.key}</Badge>
            {displayStatus.reservedFrom && (
              <span className="text-xs text-muted-foreground">vanaf {formatDate(displayStatus.reservedFrom)}</span>
            )}
            {assignee && <span className="text-sm text-muted-foreground">Toegewezen aan {assignee.first_name} {assignee.last_name}</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isFacility && <Button variant="outline" size="sm" onClick={() => navigate(`/transport/${id}/bewerken`)} className="gap-1"><Edit className="h-4 w-4" /> Bewerken</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Status</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(statusLabel).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => statusMutation.mutate(k)}>{v}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Alleen admin: de vehicles-DELETE-policy is admin-only en de cascade is niet
              atomair, dus de actie tonen aan wie hem niet kan afmaken is destructief. */}
          {!isFacility && role === 'admin' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Voertuig verwijderen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <AlertDialog open={!isFacility && deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voertuig {vehicle.license_plate} verwijderen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Dit verwijdert het voertuig en alle gekoppelde gegevens permanent. Een actieve toewijzing blokkeert de verwijdering — eerst inleveren.</p>
                {deleteImpact && (
                  <ul className="text-sm space-y-0.5 mt-2">
                    {deleteImpact.assignments > 0 && <li>· {deleteImpact.assignments} toewijzing(en)</li>}
                    {deleteImpact.damage > 0 && <li>· {deleteImpact.damage} schademelding(en) {deleteImpact.damagePhotos.length > 0 && `(${deleteImpact.damagePhotos.length} foto's)`}</li>}
                    {deleteImpact.fines > 0 && <li>· {deleteImpact.fines} boete(s) {deleteImpact.finePhotos.length > 0 && `(${deleteImpact.finePhotos.length} foto's)`}</li>}
                    {deleteImpact.mileage > 0 && <li>· {deleteImpact.mileage} kilometerregistratie(s)</li>}
                    {deleteImpact.fuel > 0 && <li>· {deleteImpact.fuel} tankpas-transactie(s)</li>}
                    {deleteImpact.assignments + deleteImpact.damage + deleteImpact.fines + deleteImpact.mileage + deleteImpact.fuel === 0 && <li className="text-muted-foreground italic">Geen gekoppelde gegevens.</li>}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); hardDelete.mutate(); }}
              disabled={hardDelete.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {hardDelete.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={visibleTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="gegevens">Gegevens</TabsTrigger>
            <TabsTrigger value="toewijzingen">Toewijzingen</TabsTrigger>
            {!isFacility && <TabsTrigger value="kilometers">Kilometers</TabsTrigger>}
            {!isFacility && <TabsTrigger value="boetes">Boetes</TabsTrigger>}
            <TabsTrigger value="schade">Schade</TabsTrigger>
            {!isFacility && <TabsTrigger value="taken">Taken</TabsTrigger>}
          </TabsList>
        </div>
        <TabsContent value="gegevens"><VehicleInfoTab vehicle={vehicle} activeAssignment={activeAssignment} /></TabsContent>
        <TabsContent value="toewijzingen"><VehicleAssignmentsTab vehicle={vehicle} /></TabsContent>
        {!isFacility && <TabsContent value="kilometers"><VehicleMileageTab vehicle={vehicle} /></TabsContent>}
        {!isFacility && <TabsContent value="boetes"><VehicleFinesTab vehicle={vehicle} /></TabsContent>}
        <TabsContent value="schade"><VehicleDamageTab vehicle={vehicle} /></TabsContent>
        {!isFacility && <TabsContent value="taken"><TasksSection entityId={vehicle.id} entityType="auto" /></TabsContent>}
      </Tabs>
    </div>
  );
};

export default VehicleDetail;
