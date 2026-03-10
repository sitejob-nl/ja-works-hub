import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ChevronRight, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import VehicleSlideOver from '@/components/transport/VehicleSlideOver';
import VehicleInfoTab from '@/components/transport/tabs/VehicleInfoTab';
import VehicleAssignmentsTab from '@/components/transport/tabs/VehicleAssignmentsTab';
import VehicleMileageTab from '@/components/transport/tabs/VehicleMileageTab';
import VehicleFinesTab from '@/components/transport/tabs/VehicleFinesTab';
import VehicleDamageTab from '@/components/transport/tabs/VehicleDamageTab';

const statusBadge: Record<string, string> = {
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  toegewezen: 'bg-blue-100 text-blue-700 border-0',
  onderhoud: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};
const statusLabel: Record<string, string> = {
  beschikbaar: 'Beschikbaar', toegewezen: 'Toegewezen', onderhoud: 'Onderhoud', uit_dienst: 'Uit dienst',
};

const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select(`
        *,
        vehicle_assignments!vehicle_assignments_vehicle_id_fkey(
          id, assigned_date, returned_date, start_mileage, end_mileage,
          employees!vehicle_assignments_employee_id_fkey(
            id, candidates!employees_candidate_id_fkey(first_name, last_name)
          )
        )
      `).eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from('vehicles').update({ status } as any).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle', id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !vehicle) return <div className="p-8 text-muted-foreground">Laden...</div>;

  const activeAssignment = (vehicle.vehicle_assignments as any[])?.find((a: any) => !a.returned_date);
  const assignee = activeAssignment?.employees?.candidates as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/transport" className="hover:text-foreground">Transport</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{vehicle.license_plate}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{vehicle.license_plate}</h1>
          <p className="text-sm text-muted-foreground">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className={statusBadge[vehicle.status] ?? ''}>{statusLabel[vehicle.status] ?? vehicle.status}</Badge>
            {assignee && <span className="text-sm text-muted-foreground">Toegewezen aan {assignee.first_name} {assignee.last_name}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1"><Edit className="h-4 w-4" /> Bewerken</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Status wijzigen</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {Object.entries(statusLabel).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => statusMutation.mutate(k)}>{v}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="gegevens">
        <TabsList>
          <TabsTrigger value="gegevens">Gegevens</TabsTrigger>
          <TabsTrigger value="toewijzingen">Toewijzingen</TabsTrigger>
          <TabsTrigger value="kilometers">Kilometers</TabsTrigger>
          <TabsTrigger value="boetes">Boetes</TabsTrigger>
          <TabsTrigger value="schade">Schademeldingen</TabsTrigger>
        </TabsList>
        <TabsContent value="gegevens"><VehicleInfoTab vehicle={vehicle} activeAssignment={activeAssignment} /></TabsContent>
        <TabsContent value="toewijzingen"><VehicleAssignmentsTab vehicle={vehicle} /></TabsContent>
        <TabsContent value="kilometers"><VehicleMileageTab vehicle={vehicle} /></TabsContent>
        <TabsContent value="boetes"><VehicleFinesTab vehicle={vehicle} /></TabsContent>
        <TabsContent value="schade"><VehicleDamageTab vehicle={vehicle} /></TabsContent>
      </Tabs>

      <VehicleSlideOver open={editOpen} onOpenChange={setEditOpen} vehicle={vehicle} />
    </div>
  );
};

export default VehicleDetail;
