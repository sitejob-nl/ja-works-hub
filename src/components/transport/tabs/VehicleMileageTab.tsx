import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';

const VehicleMileageTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [employeeId, setEmployeeId] = useState('');
  const [startKm, setStartKm] = useState(vehicle.current_mileage?.toString() ?? '');
  const [endKm, setEndKm] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState('');

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
    enabled: addOpen,
  });

  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

  const stats = useMemo(() => {
    const thisMonth = (entries ?? []).filter((e: any) => e.entry_date >= monthStart && e.entry_date <= monthEnd);
    const totalKm = thisMonth.reduce((s, e: any) => s + (e.end_km - e.start_km), 0);
    const privateKm = thisMonth.filter((e: any) => e.is_private).reduce((s, e: any) => s + (e.end_km - e.start_km), 0);
    return { totalKm, privateKm, businessKm: totalKm - privateKm };
  }, [entries, monthStart, monthEnd]);

  const addMutation = useMutation({
    mutationFn: async () => {
      const sk = parseInt(startKm);
      const ek = parseInt(endKm);
      if (ek <= sk) throw new Error('Eind km moet groter zijn dan begin km');
      const { error } = await supabase.from('mileage_entries').insert({
        organization_id: orgId,
        vehicle_id: vehicle.id,
        employee_id: employeeId,
        entry_date: formDate,
        start_km: sk,
        end_km: ek,
        is_private: isPrivate,
        notes: notes || null,
      });
      if (error) throw error;
      const { error: vErr } = await supabase.from('vehicles').update({ current_mileage: ek }).eq('id', vehicle.id);
      if (vErr) throw vErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mileage-entries', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      toast.success('Rit geregistreerd');
      setAddOpen(false);
      setEndKm(''); setNotes(''); setIsPrivate(false);
    },
    onError: (e: any) => toast.error(e.message),
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
        <Button size="sm" onClick={() => { setStartKm(vehicle.current_mileage?.toString() ?? ''); setAddOpen(true); }} className="gap-1"><Plus className="h-4 w-4" /> Nieuwe rit</Button>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entries ?? []).map((e: any) => {
              const c = e.employees?.candidates as any;
              return (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.entry_date)}</TableCell>
                  <TableCell>{c ? `${c.first_name} ${c.last_name}` : '—'}</TableCell>
                  <TableCell className="text-right">{e.start_km.toLocaleString('nl-NL')}</TableCell>
                  <TableCell className="text-right">{e.end_km.toLocaleString('nl-NL')}</TableCell>
                  <TableCell className="text-right">{(e.end_km - e.start_km).toLocaleString('nl-NL')}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={e.is_private ? 'bg-orange-100 text-orange-600 border-0' : 'bg-stat-green/10 text-stat-green border-0'}>
                      {e.is_private ? 'Privé' : 'Zakelijk'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.notes ?? '—'}</TableCell>
                </TableRow>
              );
            })}
            {(entries ?? []).length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nog geen ritten geregistreerd</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Nieuwe rit</SheetTitle></SheetHeader>
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
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Annuleren</Button>
              <Button onClick={() => addMutation.mutate()} disabled={!employeeId || !endKm || addMutation.isPending}>
                {addMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default VehicleMileageTab;
