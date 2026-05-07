import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
import { Badge } from '@/components/ui/badge';
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

const PropertyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: property, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select(`
        *,
        property_owners(id, name, contact_person, email, phone, notes),
        units!units_property_id_fkey(
          id, name, capacity, status, floor, weekly_cost, notes,
          housing_assignments!housing_assignments_unit_id_fkey(
            id, status, check_in_date, check_out_date, monthly_deduction, deduction_amount, payment_frequency, deposit_paid, rent_paid_until,
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
      const { error } = await supabase.from('properties').update({ is_active: false }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', id] });
      qc.invalidateQueries({ queryKey: ['properties'] });
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
      // Cascades naar units, housing_inspections, key_registrations via FK
      const { error } = await supabase.from('properties').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Pand verwijderd');
      navigate('/huisvesting');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Verwijderen mislukt');
      setDeleteOpen(false);
    },
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!property) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  const units = property.units ?? [];
  const totalCapacity = units.reduce((s: number, u: any) => s + (u.capacity ?? 0), 0);
  const currentOccupancy = units.reduce((s: number, u: any) =>
    s + ((u.housing_assignments ?? []).filter((a: any) => a.status === 'ingecheckt').length), 0);
  const pct = totalCapacity > 0 ? Math.round((currentOccupancy / totalCapacity) * 100) : 0;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-500' : 'bg-stat-green';

  const totalMaandlasten = [
    property.monthly_rent, property.cost_gas, property.cost_water,
    property.cost_electra, property.cost_municipal_tax, property.cost_other,
  ].reduce((s: number, v: any) => s + (Number(v) || 0), 0);

  const ownershipLabels: Record<string, string> = { huur: 'Huur', eigendom: 'Eigendom', beheer: 'Beheer' };

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
            {property.property_owners?.name && (
              <span className="text-xs text-muted-foreground">Eigenaar: <span className="text-foreground font-medium">{property.property_owners.name}</span></span>
            )}
            {property.ownership_type && (
              <Badge variant="secondary" className="text-xs">{ownershipLabels[property.ownership_type] ?? property.ownership_type}</Badge>
            )}
            {totalMaandlasten > 0 && (
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive">
                Verwijderen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="kamers">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="kamers">Kamers</TabsTrigger>
            <TabsTrigger value="bewoners">Bewoners</TabsTrigger>
            <TabsTrigger value="kosten">Kosten</TabsTrigger>
            <TabsTrigger value="schoonmaak">Schoonmaak</TabsTrigger>
            <TabsTrigger value="contracten">Contracten</TabsTrigger>
            <TabsTrigger value="sleutels">Sleutels</TabsTrigger>
            <TabsTrigger value="inspecties">Inspecties</TabsTrigger>
            <TabsTrigger value="eigenaar">Eigenaar</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="kamers"><UnitsTab property={property} /></TabsContent>
        <TabsContent value="bewoners"><ResidentsTab property={property} /></TabsContent>
        <TabsContent value="kosten"><CostsTab property={property} /></TabsContent>
        <TabsContent value="schoonmaak"><CleaningTab property={property} /></TabsContent>
        <TabsContent value="contracten"><PropertyContractsTab property={property} /></TabsContent>
        <TabsContent value="sleutels"><KeysTab propertyId={id!} /></TabsContent>
        <TabsContent value="inspecties"><InspectionsTab propertyId={id!} /></TabsContent>
        <TabsContent value="eigenaar"><OwnerTab property={property} /></TabsContent>
      </Tabs>

      <PropertySlideOver open={editOpen} onOpenChange={setEditOpen} property={property} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
      </AlertDialog>
    </div>
  );
};

export default PropertyDetail;
