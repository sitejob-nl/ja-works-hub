import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link } from 'react-router-dom';
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';

const VehicleAssignmentsTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [returnDialog, setReturnDialog] = useState<any>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [startMileage, setStartMileage] = useState(vehicle.current_mileage?.toString() ?? '');
  const [endMileage, setEndMileage] = useState('');

  const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    assigned_date: '',
    returned_date: '',
    start_mileage: '',
    end_mileage: '',
  });
  const [assignmentToDelete, setAssignmentToDelete] = useState<any | null>(null);

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

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingAssignment) throw new Error('Geen toewijzing geselecteerd');
      const update: any = {
        assigned_date: editForm.assigned_date,
        returned_date: editForm.returned_date || null,
        start_mileage: editForm.start_mileage ? parseInt(editForm.start_mileage) : null,
        end_mileage: editForm.end_mileage ? parseInt(editForm.end_mileage) : null,
      };
      const { error } = await supabase.from('vehicle_assignments').update(update).eq('id', editingAssignment.id);
      if (error) throw error;
      return update;
    },
    onSuccess: (update) => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      logAudit({ action: 'update', tableName: 'vehicle_assignments', recordId: editingAssignment?.id ?? '', newValues: update });
      toast.success('Toewijzing bijgewerkt');
      setEditingAssignment(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: any) => {
      if (!a.returned_date) {
        throw new Error('Voertuig is nog niet ingeleverd — eerst inleveren voordat de toewijzing verwijderd kan worden.');
      }
      const { error } = await supabase.from('vehicle_assignments').delete().eq('id', a.id);
      if (error) throw error;
      return a;
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignments', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      logAudit({ action: 'delete', tableName: 'vehicle_assignments', recordId: a.id });
      toast.success('Toewijzing verwijderd');
      setAssignmentToDelete(null);
    },
    onError: (e: any) => { toast.error(e.message); setAssignmentToDelete(null); },
  });

  const openEdit = (a: any) => {
    setEditingAssignment(a);
    setEditForm({
      assigned_date: a.assigned_date ?? '',
      returned_date: a.returned_date ?? '',
      start_mileage: a.start_mileage != null ? String(a.start_mileage) : '',
      end_mileage: a.end_mileage != null ? String(a.end_mileage) : '',
    });
  };

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
                    <div className="flex gap-1 items-center">
                      {!a.returned_date && <Button size="sm" variant="outline" onClick={() => { setReturnDialog(a); setEndMileage(''); }}>Inleveren</Button>}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(a)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setAssignmentToDelete(a)} className="text-destructive">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Verwijderen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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

      {/* Edit assignment Sheet */}
      <Sheet open={!!editingAssignment} onOpenChange={(o) => { if (!o) setEditingAssignment(null); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Toewijzing bewerken</SheetTitle></SheetHeader>
          {editingAssignment && (
            <div className="space-y-4 mt-6">
              <div className="p-3 rounded-lg bg-muted/50 border text-sm">
                {editingAssignment.employees?.candidates?.first_name} {editingAssignment.employees?.candidates?.last_name}
              </div>
              <div><Label>Startdatum *</Label><Input type="date" value={editForm.assigned_date} onChange={(e) => setEditForm(f => ({ ...f, assigned_date: e.target.value }))} /></div>
              <div><Label>Einddatum (leeg = nog actief)</Label><Input type="date" value={editForm.returned_date} onChange={(e) => setEditForm(f => ({ ...f, returned_date: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Begin km</Label><Input type="number" value={editForm.start_mileage} onChange={(e) => setEditForm(f => ({ ...f, start_mileage: e.target.value }))} /></div>
                <div><Label>Eind km</Label><Input type="number" value={editForm.end_mileage} onChange={(e) => setEditForm(f => ({ ...f, end_mileage: e.target.value }))} /></div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" onClick={() => setEditingAssignment(null)}>Annuleren</Button>
                <Button onClick={() => editMutation.mutate()} disabled={!editForm.assigned_date || editMutation.isPending}>
                  {editMutation.isPending ? 'Opslaan...' : 'Opslaan'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete assignment confirm */}
      <AlertDialog open={!!assignmentToDelete} onOpenChange={(o) => { if (!o) setAssignmentToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Toewijzing verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              {assignmentToDelete && !assignmentToDelete.returned_date
                ? 'Voertuig is nog niet ingeleverd. Eerst inleveren voordat je de toewijzing kunt verwijderen.'
                : 'Verwijdert de historische toewijzing permanent. Deze actie kan niet ongedaan worden gemaakt.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (assignmentToDelete) deleteMutation.mutate(assignmentToDelete); }}
              disabled={deleteMutation.isPending || (assignmentToDelete && !assignmentToDelete.returned_date)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
