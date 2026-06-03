import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { EntityLink } from '@/components/ui/entity-link';

const VehicleMileageTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [employeeId, setEmployeeId] = useState('');
  const [startKm, setStartKm] = useState(vehicle.current_mileage?.toString() ?? '');
  const [endKm, setEndKm] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState('');
  const [entryToDelete, setEntryToDelete] = useState<any | null>(null);

  const { data: entries } = useQuery({
    queryKey: ['mileage-entries', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('mileage_entries').select(`
        *,
        employees!mileage_entries_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))
      `).eq('vehicle_id', vehicle.id).order('entry_date', { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assignedEmployees } = useQuery({
    queryKey: ['vehicle-assigned-employees', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_assignments').select('employees!vehicle_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))').eq('vehicle_id', vehicle.id);
      if (error) throw error;
      const unique = new Map<string, any>();
      (data ?? []).forEach((a: any) => { if (a.employees) unique.set(a.employees.id, a.employees); });
      return Array.from(unique.values());
    },
    enabled: sheetOpen,
  });

  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

  const stats = useMemo(() => {
    const thisMonth = (entries ?? []).filter((e: any) => e.entry_date >= monthStart && e.entry_date <= monthEnd);
    const totalKm = thisMonth.reduce((s, e: any) => s + (e.end_km - e.start_km), 0);
    const privateKm = thisMonth.filter((e: any) => e.is_private).reduce((s, e: any) => s + (e.end_km - e.start_km), 0);
    return { totalKm, privateKm, businessKm: totalKm - privateKm };
  }, [entries, monthStart, monthEnd]);

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
    setFormDate(format(new Date(), 'yyyy-MM-dd'));
    setEmployeeId('');
    setStartKm(vehicle.current_mileage?.toString() ?? '');
    setEndKm('');
    setIsPrivate(false);
    setNotes('');
  };

  const openAdd = () => {
    setEditingId(null);
    setFormDate(format(new Date(), 'yyyy-MM-dd'));
    setEmployeeId('');
    setStartKm(vehicle.current_mileage?.toString() ?? '');
    setEndKm('');
    setIsPrivate(false);
    setNotes('');
    setSheetOpen(true);
  };

  const openEdit = (e: any) => {
    setEditingId(e.id);
    setFormDate(e.entry_date ?? format(new Date(), 'yyyy-MM-dd'));
    setEmployeeId(e.employee_id ?? '');
    setStartKm(String(e.start_km ?? ''));
    setEndKm(String(e.end_km ?? ''));
    setIsPrivate(!!e.is_private);
    setNotes(e.notes ?? '');
    setSheetOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sk = parseInt(startKm);
      const ek = parseInt(endKm);
      if (ek <= sk) throw new Error('Eind km moet groter zijn dan begin km');
      const payload: any = {
        employee_id: employeeId,
        entry_date: formDate,
        start_km: sk,
        end_km: ek,
        is_private: isPrivate,
        notes: notes || null,
      };
      if (editingId) {
        const { error } = await supabase.from('mileage_entries').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('mileage_entries').insert({
          ...payload, organization_id: orgId, vehicle_id: vehicle.id,
        });
        if (error) throw error;
      }
      // Update current_mileage als deze rit hoger is dan huidige stand (alleen bij nieuwe rit)
      if (!editingId && ek > (vehicle.current_mileage ?? 0)) {
        const { error: vErr } = await supabase.from('vehicles').update({ current_mileage: ek }).eq('id', vehicle.id);
        if (vErr) throw vErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mileage-entries', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      logAudit({ action: editingId ? 'update' : 'create', tableName: 'mileage_entries', recordId: editingId ?? 'new' });
      toast.success(editingId ? 'Rit bijgewerkt' : 'Rit geregistreerd');
      closeSheet();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.from('mileage_entries').delete().eq('id', entryId);
      if (error) throw error;
    },
    onSuccess: (_, entryId) => {
      qc.invalidateQueries({ queryKey: ['mileage-entries', vehicle.id] });
      logAudit({ action: 'delete', tableName: 'mileage_entries', recordId: entryId });
      toast.success('Rit verwijderd');
      setEntryToDelete(null);
    },
    onError: (e: any) => { toast.error(e.message); setEntryToDelete(null); },
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Totaal km deze maand', value: stats.totalKm.toLocaleString('nl-NL') },
          { label: 'Privé', value: stats.privateKm.toLocaleString('nl-NL') },
          { label: 'Zakelijk', value: stats.businessKm.toLocaleString('nl-NL') },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold">{s.value} km</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> Nieuwe rit</Button>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Medewerker</TableHead>
              <TableHead className="text-right">Begin km</TableHead>
              <TableHead className="text-right">Eind km</TableHead>
              <TableHead className="text-right">Totaal km</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Notities</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entries ?? []).map((e: any) => {
              const c = e.employees?.candidates as any;
              return (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.entry_date)}</TableCell>
                  <TableCell>
                    <EntityLink type="employee" id={e.employees?.id}>
                      {c ? `${c.first_name} ${c.last_name}` : '—'}
                    </EntityLink>
                  </TableCell>
                  <TableCell className="text-right">{e.start_km.toLocaleString('nl-NL')}</TableCell>
                  <TableCell className="text-right">{e.end_km.toLocaleString('nl-NL')}</TableCell>
                  <TableCell className="text-right">{(e.end_km - e.start_km).toLocaleString('nl-NL')}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={e.is_private ? 'bg-orange-100 text-orange-600 border-0' : 'bg-stat-green/10 text-stat-green border-0'}>
                      {e.is_private ? 'Privé' : 'Zakelijk'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.notes ?? '—'}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(e)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Bewerken
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setEntryToDelete(e)} className="text-destructive">
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Verwijderen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {(entries ?? []).length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nog geen ritten geregistreerd</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) closeSheet(); else setSheetOpen(o); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>{editingId ? 'Rit bewerken' : 'Nieuwe rit'}</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Datum</Label><Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} /></div>
            <div>
              <Label>Medewerker *</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
                <SelectContent>
                  {(assignedEmployees ?? []).map((e: any) => {
                    const c = e.candidates as any;
                    return <SelectItem key={e.id} value={e.id}>{c?.first_name} {c?.last_name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Begin km</Label><Input type="number" value={startKm} onChange={(e) => setStartKm(e.target.value)} /></div>
              <div><Label>Eind km *</Label><Input type="number" value={endKm} onChange={(e) => setEndKm(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} id="private" />
              <Label htmlFor="private">Privé rit</Label>
            </div>
            <div><Label>Notities</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={closeSheet}>Annuleren</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!employeeId || !endKm || saveMutation.isPending}>
                {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!entryToDelete} onOpenChange={(o) => { if (!o) setEntryToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rit verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Verwijdert de rit van {entryToDelete && formatDate(entryToDelete.entry_date)}. Deze actie kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (entryToDelete) deleteMutation.mutate(entryToDelete.id); }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Verwijderen...' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default VehicleMileageTab;
