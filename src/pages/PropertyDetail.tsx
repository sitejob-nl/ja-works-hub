import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrapDeleted } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { ChevronRight, MoreHorizontal, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { formatEUR } from '@/lib/format';
import PropertySlideOver from '@/components/housing/PropertySlideOver';
import UnitsTab from '@/components/housing/tabs/UnitsTab';
import ResidentsTab from '@/components/housing/tabs/ResidentsTab';
import CostsTab from '@/components/housing/tabs/CostsTab';
import KeysTab from '@/components/housing/tabs/KeysTab';
import InspectionsTab from '@/components/housing/tabs/InspectionsTab';
import OwnerTab from '@/components/housing/tabs/OwnerTab';
import CleaningTab from '@/components/housing/tabs/CleaningTab';
import PropertyContractsTab from '@/components/housing/tabs/PropertyContractsTab';
import TasksSection from '@/components/shared/TasksSection';
import { useTabSearchParam } from '@/hooks/useTabSearchParam';
import { useTrackPageVisit } from '@/hooks/useTrackPageVisit';
import { totalMonthlyPropertyCost } from '@/lib/housing-costs';
import { useAuth } from '@/contexts/AuthContext';
import { fetchFacilityHousingSnapshot, isFacilityRole, saveFacilityOperationalEntity } from '@/lib/facility';
import { logAudit } from '@/lib/audit';

const PropertyDetail = () => {
  const { role } = useAuth();
  const isFacility = isFacilityRole(role);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeTab, setActiveTab] = useTabSearchParam('kamers');

  const { data: property, isLoading } = useQuery({
    queryKey: ['property', id, isFacility ? 'facility' : 'internal'],
    queryFn: async () => {
      if (isFacility) {
        const snapshot = await fetchFacilityHousingSnapshot(id);
        return snapshot.properties.find((item: any) => item.id === id) ?? null;
      }
      const { data, error } = await supabase.from('properties').select(`
        *,
        property_owners(id, name, contact_person, email, phone, notes),
        units!units_property_id_fkey(
          id, name, capacity, status, floor, weekly_cost, notes,
          housing_assignments!housing_assignments_unit_id_fkey(
            id, status, check_in_date, check_out_date, monthly_deduction, deduction_amount, payment_frequency, deposit_paid, deposit_amount, rent_paid_until,
            candidates!housing_assignments_candidate_id_fkey(id, first_name, last_name)
          )
        )
      `).eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      if (isFacility) {
        await saveFacilityOperationalEntity('property', { id, is_active: false });
        return;
      }
      const { error } = await supabase.from('properties').update({ is_active: false }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', id] });
      qc.invalidateQueries({ queryKey: ['properties'] });
      if (isFacility) qc.invalidateQueries({ queryKey: ['facility-housing-snapshot'] });
      if (isFacility) void logAudit({ action: 'update', tableName: 'properties', recordId: id!, newValues: { is_active: false } });
      toast.success('Pand gedeactiveerd');
    },
  });

  const hardDelete = useMutation({
    mutationFn: async () => {
      // Pre-check: weiger als er bewoner-records (actief of historisch) hangen aan units van dit pand
      const { count, error: countErr } = await supabase
        .from('housing_assignments')
        .select('id, units!inner(property_id)', { count: 'exact', head: true })
        .eq('units.property_id', id!);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        throw new Error(`Pand heeft nog ${count} bewoner-record(s). Verwijder die eerst of gebruik 'Deactiveren'.`);
      }
      // Cascades naar units, housing_inspections, key_registrations via FK.
      // Rowcount-check: een door RLS geweigerde delete geeft geen error, alleen 0 rijen —
      // zonder deze check meldde de UI 'Pand verwijderd' en navigeerde weg terwijl het bleef staan.
      await unwrapDeleted(
        supabase.from('properties').delete().eq('id', id!),
        'Dit pand kon niet worden verwijderd — je hebt hiervoor mogelijk beheerdersrechten nodig.',
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Pand verwijderd');
      navigate('/huisvesting');
    },
    onError: (err: Error) => {
      toast.error(toFriendlyError(err, 'Verwijderen mislukt'));
      setDeleteOpen(false);
    },
  });

  // Punt 7 — panden ook in de balk met recent bekeken items.
  useTrackPageVisit({
    id,
    type: 'pand',
    label: property?.name || [property?.address_street, property?.address_city].filter(Boolean).join(', ') || undefined,
    sublabel: property?.address_city ?? undefined,
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!property) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  const units = property.units ?? [];
  const totalCapacity = units.reduce((s: number, u: any) => s + (u.capacity ?? 0), 0);
  const currentOccupancy = units.reduce((s: number, u: any) =>
    s + ((u.housing_assignments ?? []).filter((a: any) => a.status === 'ingecheckt').length), 0);
  const pct = totalCapacity > 0 ? Math.round((currentOccupancy / totalCapacity) * 100) : 0;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-500' : 'bg-stat-green';

  const totalMaandlasten = totalMonthlyPropertyCost(property);

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/huisvesting" className="hover:text-foreground transition-colors">Huisvesting</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate">{property.name || [property.address_street, property.address_city].filter(Boolean).join(', ')}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{property.name || [property.address_street, property.address_city].filter(Boolean).join(', ')}</h1>
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {[property.address_street, property.address_postal, property.address_city].filter(Boolean).join(', ')}
          </p>
          <div className="flex items-center gap-3 mt-3 max-w-sm">
            <div className="relative h-2 rounded-full bg-muted overflow-hidden flex-1">
              <div className={`absolute inset-y-0 left-0 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-medium">{pct}%</span>
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {!isFacility && property.property_owners?.name && (
              <span className="text-xs text-muted-foreground">Eigenaar: <span className="text-foreground font-medium">{property.property_owners.name}</span></span>
            )}
            {!isFacility && totalMaandlasten > 0 && (
              <span className="text-xs text-muted-foreground">Maandlasten: <span className="text-foreground font-medium">{formatEUR(totalMaandlasten)}</span></span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Bewerken
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => deactivate.mutate()}>Deactiveren</DropdownMenuItem>
              {!isFacility && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive">
                    Verwijderen
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs
        value={isFacility && !['kamers', 'bewoners', 'schoonmaak', 'sleutels', 'inspecties'].includes(activeTab) ? 'kamers' : activeTab}
        onValueChange={setActiveTab}
      >
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="kamers">Kamers</TabsTrigger>
            <TabsTrigger value="bewoners">Bewoners</TabsTrigger>
            {!isFacility && <TabsTrigger value="kosten">Kosten</TabsTrigger>}
            <TabsTrigger value="schoonmaak">Schoonmaak</TabsTrigger>
            {!isFacility && <TabsTrigger value="contracten">Contracten</TabsTrigger>}
            <TabsTrigger value="sleutels">Sleutels</TabsTrigger>
            <TabsTrigger value="inspecties">Inspecties</TabsTrigger>
            {!isFacility && <TabsTrigger value="eigenaar">Eigenaar</TabsTrigger>}
            {!isFacility && <TabsTrigger value="taken">Taken</TabsTrigger>}
          </TabsList>
        </div>
        <TabsContent value="kamers"><UnitsTab property={property} /></TabsContent>
        <TabsContent value="bewoners"><ResidentsTab property={property} /></TabsContent>
        {!isFacility && <TabsContent value="kosten"><CostsTab property={property} /></TabsContent>}
        <TabsContent value="schoonmaak"><CleaningTab property={property} /></TabsContent>
        {!isFacility && <TabsContent value="contracten"><PropertyContractsTab property={property} /></TabsContent>}
        <TabsContent value="sleutels"><KeysTab property={property} /></TabsContent>
        <TabsContent value="inspecties"><InspectionsTab property={property} /></TabsContent>
        {!isFacility && <TabsContent value="eigenaar"><OwnerTab property={property} /></TabsContent>}
        {!isFacility && <TabsContent value="taken"><TasksSection entityId={id!} entityType="huis" /></TabsContent>}
      </Tabs>

      <PropertySlideOver open={editOpen} onOpenChange={setEditOpen} property={property} />

      {!isFacility && <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pand verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dit verwijdert het pand inclusief alle kamers, inspecties en sleutelregistraties.
              Bewoner-records (housing assignments) blokkeren de verwijdering — gebruik dan eerst 'Deactiveren'.
              Deze actie kan niet ongedaan worden gemaakt.
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
      </AlertDialog>}
    </div>
  );
};

export default PropertyDetail;
