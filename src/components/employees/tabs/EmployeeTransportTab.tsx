import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Plus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityLink } from '@/components/ui/entity-link';
import { resolveEmployeeId } from '@/lib/assignments';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const EmployeeTransportTab = ({ candidateId }: { candidateId: string }) => {
  const { data: assignment } = useQuery({
    queryKey: ['vehicle-assignment', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_assignments')
        .select('*, vehicles!vehicle_assignments_vehicle_id_fkey(license_plate, brand, model)')
        .eq('candidate_id', candidateId)
        .is('returned_date', null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [startMileage, setStartMileage] = useState('');

  const { data: availableVehicles = [] } = useQuery({
    queryKey: ['available-vehicles', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles')
        .select('id, license_plate, brand, model, current_mileage')
        .eq('status', 'beschikbaar' as any)
        .order('license_plate');
      if (error) throw error;
      return data ?? [];
    },
    enabled: assignOpen,
  });

  const assignVehicle = useMutation({
    mutationFn: async () => {
      const { data: candidate, error: candErr } = await supabase.from('candidates')
        .select('id, employee_number, employee_status')
        .eq('id', candidateId)
        .single();
      if (candErr) throw candErr;
      const employeeId = await resolveEmployeeId(candidate, orgId, assignedDate);
      const { error } = await supabase.from('vehicle_assignments').insert({
        organization_id: orgId,
        vehicle_id: vehicleId,
        employee_id: employeeId,
        candidate_id: candidateId,
        assigned_date: assignedDate,
        start_mileage: startMileage ? parseInt(startMileage) : null,
      });
      if (error) throw error;
      const { error: vErr } = await supabase.from('vehicles').update({ status: 'toegewezen' as any }).eq('id', vehicleId);
      if (vErr) throw vErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-assignment', candidateId] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Voertuig toegewezen');
      setAssignOpen(false);
      setVehicleId(''); setAssignedDate(''); setStartMileage('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: mileage = [] } = useQuery({
    queryKey: ['mileage', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('mileage_entries')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('entry_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const { data: fines = [] } = useQuery({
    queryKey: ['vehicle-fines', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_fines')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('fine_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      {/* Current vehicle */}
      <div className="bg-card rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Huidig voertuig</h3>
          {!assignment && (
            <Button size="sm" onClick={() => setAssignOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Voertuig toewijzen</Button>
          )}
        </div>
        {assignment ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><p className="text-xs text-muted-foreground">Kenteken</p><p className="text-sm font-medium"><EntityLink type="vehicle" id={assignment.vehicle_id}>{assignment.vehicles?.license_plate}</EntityLink></p></div>
            <div><p className="text-xs text-muted-foreground">Merk</p><p className="text-sm">{assignment.vehicles?.brand ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Model</p><p className="text-sm">{assignment.vehicles?.model ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Toewijsdatum</p><p className="text-sm">{formatDate(assignment.assigned_date)}</p></div>
            <div><p className="text-xs text-muted-foreground">Begin km</p><p className="text-sm">{assignment.start_mileage ?? '—'}</p></div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Geen voertuig toegewezen</p>
        )}
      </div>

      {/* Mileage */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Kilometerregistraties</h3>
        {mileage.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen registraties</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Begin km</TableHead>
                <TableHead className="text-right">Eind km</TableHead>
                <TableHead className="text-right">Totaal km</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mileage.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDate(m.entry_date)}</TableCell>
                  <TableCell className="text-right">{m.start_km}</TableCell>
                  <TableCell className="text-right">{m.end_km}</TableCell>
                  <TableCell className="text-right font-medium">{m.end_km - m.start_km}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={m.is_private ? 'bg-orange-100 text-orange-600 border-0' : 'bg-blue-100 text-blue-700 border-0'}>
                      {m.is_private ? 'Privé' : 'Zakelijk'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Fines */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Boetes</h3>
        {fines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen boetes</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Uiterste betaaldatum</TableHead>
                <TableHead>Bedrag</TableHead>
                <TableHead>Beschrijving</TableHead>
                <TableHead>Betaald</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell>{formatDate(f.fine_date)}</TableCell>
                  <TableCell>{formatDate(f.due_date)}</TableCell>
                  <TableCell className="font-medium">{formatEUR(f.amount)}</TableCell>
                  <TableCell>{f.description ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={f.paid ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}>
                      {f.paid ? 'Ja' : 'Nee'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Voertuig toewijzen</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Voertuig *</Label>
              <Select
                value={vehicleId}
                onValueChange={(v) => {
                  setVehicleId(v);
                  const veh = (availableVehicles as any[]).find((x) => x.id === v);
                  if (veh?.current_mileage != null) setStartMileage(String(veh.current_mileage));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecteer beschikbaar voertuig" /></SelectTrigger>
                <SelectContent>
                  {(availableVehicles as any[]).length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Geen beschikbare voertuigen</div>
                  )}
                  {(availableVehicles as any[]).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.license_plate}{v.brand ? ` — ${v.brand} ${v.model ?? ''}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Toewijsdatum *</Label><Input type="date" value={assignedDate} onChange={(e) => setAssignedDate(e.target.value)} /></div>
            <div><Label>Begin kilometerstand</Label><Input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAssignOpen(false)}>Annuleren</Button>
              <Button onClick={() => assignVehicle.mutate()} disabled={!vehicleId || !assignedDate || assignVehicle.isPending}>
                {assignVehicle.isPending ? 'Toewijzen...' : 'Toewijzen'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default EmployeeTransportTab;
