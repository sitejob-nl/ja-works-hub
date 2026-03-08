import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';

const VehicleAssignmentsTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [returnDialog, setReturnDialog] = useState<any>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [startMileage, setStartMileage] = useState(vehicle.current_mileage?.toString() ?? '');
  const [endMileage, setEndMileage] = useState('');

  const { data: assignments } = useQuery({
    queryKey: ['vehicle-assignments', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_assignments').select(`
        *,
        employees!vehicle_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))
      `).eq('vehicle_id', vehicle.id).order('assigned_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-active-for-assign'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, candidates!employees_candidate_id_fkey(first_name, last_name)').eq('status', 'actief' as any);
      if (error) throw error;
      return data ?? [];
    },
    enabled: assignOpen,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('vehicle_assignments').insert({
        organization_id: orgId,
        vehicle_id: vehicle.id,
        employee_id: employeeId,
        assigned_date: assignedDate,
        start_mileage: startMileage ? parseInt(startMileage) : null,
      });
      if (error) throw error;
      const { error: vErr } = await supabase.from('vehicles').update({ status: 'toegewezen' as any }).eq('id', vehicle.id);
      if (vErr) throw vErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Voertuig toegewezen');
      setAssignOpen(false);
      setEmployeeId(''); setAssignedDate('');
    },
    onError: (e: any) => {
      const msg = e.message || '';
      if (msg.includes('rijbewijs') || msg.includes('license')) {
        toast.error(`Toewijzing geblokkeerd: ${msg}`);
      } else {
        toast.error(msg);
      }
    },
  });

  const returnMutation = useMutation({
    mutationFn: async () => {
      const km = parseInt(endMileage);
      const { error } = await supabase.from('vehicle_assignments').update({
        returned_date: new Date().toISOString().split('T')[0],
        end_mileage: km,
      }).eq('id', returnDialog.id);
      if (error) throw error;
      const { error: vErr } = await supabase.from('vehicles').update({ current_mileage: km, status: 'beschikbaar' as any }).eq('id', vehicle.id);
      if (vErr) throw vErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Voertuig ingeleverd');
      setReturnDialog(null); setEndMileage('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAssignOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Voertuig toewijzen</Button>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medewerker</TableHead>
              <TableHead>Startdatum</TableHead>
              <TableHead>Einddatum</TableHead>
              <TableHead className="text-right">Begin km</TableHead>
              <TableHead className="text-right">Eind km</TableHead>
              <TableHead className="text-right">Totaal km</TableHead>
              <TableHead>Acties</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(assignments ?? []).map((a: any) => {
              const c = a.employees?.candidates as any;
              const totalKm = a.start_mileage != null && a.end_mileage != null ? a.end_mileage - a.start_mileage : null;
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link to={`/medewerkers/${a.employees?.id}`} className="font-medium hover:text-primary">{c?.first_name} {c?.last_name}</Link>
                  </TableCell>
                  <TableCell>{formatDate(a.assigned_date)}</TableCell>
                  <TableCell>{a.returned_date ? formatDate(a.returned_date) : <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0">Huidig</Badge>}</TableCell>
                  <TableCell className="text-right">{a.start_mileage?.toLocaleString('nl-NL') ?? '—'}</TableCell>
                  <TableCell className="text-right">{a.end_mileage?.toLocaleString('nl-NL') ?? '—'}</TableCell>
                  <TableCell className="text-right">{totalKm != null ? totalKm.toLocaleString('nl-NL') : '—'}</TableCell>
                  <TableCell>
                    {!a.returned_date && <Button size="sm" variant="outline" onClick={() => { setReturnDialog(a); setEndMileage(''); }}>Inleveren</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
            {(assignments ?? []).length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nog geen toewijzingen</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Assign sheet */}
      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Voertuig toewijzen</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Medewerker *</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
                <SelectContent>
                  {(employees ?? []).map((e: any) => {
                    const c = e.candidates as any;
                    return <SelectItem key={e.id} value={e.id}>{c?.first_name} {c?.last_name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Startdatum *</Label><Input type="date" value={assignedDate} onChange={(e) => setAssignedDate(e.target.value)} /></div>
            <div><Label>Begin kilometerstand</Label><Input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAssignOpen(false)}>Annuleren</Button>
              <Button onClick={() => assignMutation.mutate()} disabled={!employeeId || !assignedDate || assignMutation.isPending}>
                {assignMutation.isPending ? 'Toewijzen...' : 'Toewijzen'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Return dialog */}
      <Dialog open={!!returnDialog} onOpenChange={(o) => !o && setReturnDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Voertuig inleveren</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Eind kilometerstand *</Label><Input type="number" value={endMileage} onChange={(e) => setEndMileage(e.target.value)} placeholder="Huidige km-stand" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnDialog(null)}>Annuleren</Button>
            <Button onClick={() => returnMutation.mutate()} disabled={!endMileage || returnMutation.isPending}>
              {returnMutation.isPending ? 'Inleveren...' : 'Inleveren'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VehicleAssignmentsTab;
