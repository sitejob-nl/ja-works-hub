import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

const KeysTab = ({ propertyId }: { propertyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ key_number: '', unit_id: '', employee_id: '', issued_at: '' });

  const { data: keys = [] } = useQuery({
    queryKey: ['property-keys', propertyId],
    queryFn: async () => {
      // Get units for this property first
      const { data: units } = await supabase.from('units').select('id').eq('property_id', propertyId);
      const unitIds = (units ?? []).map((u: any) => u.id);
      if (unitIds.length === 0) return [];
      const { data, error } = await supabase.from('key_registrations')
        .select('*, units!key_registrations_unit_id_fkey(name), employees!key_registrations_employee_id_fkey(candidates!employees_candidate_id_fkey(first_name, last_name))')
        .in('unit_id', unitIds)
        .order('issued_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Units and residents for the form
  const { data: unitsData = [] } = useQuery({
    queryKey: ['property-units-select', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('units').select('id, name').eq('property_id', propertyId);
      if (error) throw error;
      return data;
    },
    enabled: adding,
  });

  const { data: residents = [] } = useQuery({
    queryKey: ['property-residents-select', propertyId],
    queryFn: async () => {
      const unitIds = unitsData.map((u: any) => u.id);
      if (unitIds.length === 0) return [];
      const { data, error } = await supabase.from('housing_assignments')
        .select('employee_id, employees!housing_assignments_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))')
        .in('unit_id', unitIds)
        .eq('status', 'ingecheckt');
      if (error) throw error;
      return data;
    },
    enabled: adding && unitsData.length > 0,
  });

  const addKey = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('key_registrations').insert({
        organization_id: orgId,
        key_number: form.key_number,
        unit_id: form.unit_id,
        employee_id: form.employee_id,
        issued_at: form.issued_at || new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-keys', propertyId] });
      setAdding(false);
      setForm({ key_number: '', unit_id: '', employee_id: '', issued_at: '' });
      toast.success('Sleutel geregistreerd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const returnKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase.from('key_registrations').update({ returned_at: new Date().toISOString() }).eq('id', keyId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-keys', propertyId] });
      toast.success('Sleutel ingeleverd');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Sleutelregistratie</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe sleutel
        </Button>
      </div>

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Sleutelnummer *</Label><Input value={form.key_number} onChange={(e) => setForm(f => ({ ...f, key_number: e.target.value }))} /></div>
            <div><Label>Uitgiftedatum</Label><Input type="date" value={form.issued_at} onChange={(e) => setForm(f => ({ ...f, issued_at: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kamer *</Label>
              <Select value={form.unit_id} onValueChange={(v) => setForm(f => ({ ...f, unit_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer kamer" /></SelectTrigger>
                <SelectContent>
                  {unitsData.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Medewerker *</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm(f => ({ ...f, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer bewoner" /></SelectTrigger>
                <SelectContent>
                  {residents.map((r: any) => (
                    <SelectItem key={r.employee_id} value={r.employee_id}>
                      {r.employees?.candidates?.first_name} {r.employees?.candidates?.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => addKey.mutate()} disabled={!form.key_number || !form.unit_id || !form.employee_id || addKey.isPending}>
              {addKey.isPending ? 'Opslaan...' : 'Registreren'}
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen sleutels geregistreerd</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sleutelnr.</TableHead>
                <TableHead>Kamer</TableHead>
                <TableHead>Medewerker</TableHead>
                <TableHead>Uitgiftedatum</TableHead>
                <TableHead>Inleverdatum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k: any) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.key_number}</TableCell>
                  <TableCell>{k.units?.name ?? '—'}</TableCell>
                  <TableCell>{k.employees?.candidates?.first_name} {k.employees?.candidates?.last_name}</TableCell>
                  <TableCell>{formatDate(k.issued_at)}</TableCell>
                  <TableCell>{k.returned_at ? formatDate(k.returned_at) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs ${k.returned_at ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-orange-100 text-orange-600 border-0'}`}>
                      {k.returned_at ? 'Ingeleverd' : 'Uitstaand'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!k.returned_at && (
                      <Button size="sm" variant="outline" onClick={() => returnKey.mutate(k.id)} disabled={returnKey.isPending}>
                        Inleveren
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default KeysTab;
