import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';

const VehicleFinesTab = ({ vehicle }: { vehicle: any }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [fineDate, setFineDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: fines } = useQuery({
    queryKey: ['vehicle-fines', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_fines').select(`
        *,
        employees!vehicle_fines_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))
      `).eq('vehicle_id', vehicle.id).order('fine_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assignedEmployees } = useQuery({
    queryKey: ['vehicle-assigned-employees-fines', vehicle.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_assignments').select('employees!vehicle_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))').eq('vehicle_id', vehicle.id);
      if (error) throw error;
      const unique = new Map<string, any>();
      (data ?? []).forEach((a: any) => { if (a.employees) unique.set(a.employees.id, a.employees); });
      return Array.from(unique.values());
    },
    enabled: addOpen,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('vehicle_fines').insert({
        organization_id: orgId,
        vehicle_id: vehicle.id,
        fine_date: fineDate,
        amount: parseFloat(amount),
        description: description || null,
        reference_number: referenceNumber || null,
        employee_id: employeeId || null,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-fines', vehicle.id] });
      toast.success('Boete geregistreerd');
      setAddOpen(false);
      setFineDate(''); setAmount(''); setDescription(''); setReferenceNumber(''); setEmployeeId(''); setNotes('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const paidMutation = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase.from('vehicle_fines').update({
        paid,
        paid_at: paid ? new Date().toISOString() : null,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-fines', vehicle.id] });
      toast.success('Betaalstatus bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Nieuwe boete</Button>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Bedrag</TableHead>
              <TableHead>Beschrijving</TableHead>
              <TableHead>Referentie</TableHead>
              <TableHead>Medewerker</TableHead>
              <TableHead>Betaald</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(fines ?? []).map((f: any) => {
              const c = f.employees?.candidates as any;
              return (
                <TableRow key={f.id}>
                  <TableCell>{formatDate(f.fine_date)}</TableCell>
                  <TableCell>{formatEUR(f.amount)}</TableCell>
                  <TableCell>{f.description ?? '—'}</TableCell>
                  <TableCell>{f.reference_number ?? '—'}</TableCell>
                  <TableCell>{c ? `${c.first_name} ${c.last_name}` : '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`cursor-pointer ${f.paid ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}`}
                      onClick={() => paidMutation.mutate({ id: f.id, paid: !f.paid })}
                    >
                      {f.paid ? 'Betaald' : 'Niet betaald'}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {(fines ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Geen boetes geregistreerd</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Nieuwe boete</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div><Label>Datum *</Label><Input type="date" value={fineDate} onChange={(e) => setFineDate(e.target.value)} /></div>
            <div><Label>Bedrag (€) *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Beschrijving</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><Label>Referentienummer</Label><Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></div>
            <div>
              <Label>Medewerker (optioneel)</Label>
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
            <div><Label>Notities</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Annuleren</Button>
              <Button onClick={() => addMutation.mutate()} disabled={!fineDate || !amount || addMutation.isPending}>
                {addMutation.isPending ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default VehicleFinesTab;
