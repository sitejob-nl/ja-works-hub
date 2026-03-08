import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const EmployeeSickTab = ({ employeeId, employee }: { employeeId: string; employee: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ expected_return_date: '', notes: '' });

  const { data: reports = [] } = useQuery({
    queryKey: ['sick-reports', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sick_reports')
        .select('*')
        .eq('employee_id', employeeId)
        .order('reported_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createReport = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('sick_reports').insert({
        organization_id: orgId,
        employee_id: employeeId,
        created_by: user?.id ?? null,
        expected_return_date: form.expected_return_date || null,
        notes: form.notes || null,
      });
      if (error) throw error;
      const { error: e2 } = await supabase.from('employees').update({ status: 'ziek' as const }).eq('id', employeeId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sick-reports', employeeId] });
      qc.invalidateQueries({ queryKey: ['employee', employeeId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      logAudit({
        action: 'create',
        tableName: 'sick_reports',
        recordId: employeeId,
        newValues: form,
      });
      setAdding(false);
      setForm({ expected_return_date: '', notes: '' });
      toast.success('Ziekmelding geregistreerd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const recover = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await supabase.from('sick_reports')
        .update({ actual_return_date: new Date().toISOString().split('T')[0] })
        .eq('id', reportId);
      if (error) throw error;
      const { error: e2 } = await supabase.from('employees').update({ status: 'actief' as const }).eq('id', employeeId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sick-reports', employeeId] });
      qc.invalidateQueries({ queryKey: ['employee', employeeId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Herstelmelding verwerkt');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Ziekmeldingen</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Nieuwe ziekmelding
        </Button>
      </div>

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div><Label>Verwachte terugkeer</Label><Input type="date" value={form.expected_return_date} onChange={(e) => setForm(f => ({ ...f, expected_return_date: e.target.value }))} /></div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => createReport.mutate()} disabled={createReport.isPending}>
              {createReport.isPending ? 'Opslaan...' : 'Registreren'}
            </Button>
          </div>
        </div>
      )}

      {reports.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen ziekmeldingen</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gemeld op</TableHead>
                <TableHead>Verwachte terugkeer</TableHead>
                <TableHead>Werkelijke terugkeer</TableHead>
                <TableHead>Klant geïnformeerd</TableHead>
                <TableHead>Notities</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDate(r.reported_at)}</TableCell>
                  <TableCell>{formatDate(r.expected_return_date)}</TableCell>
                  <TableCell>{formatDate(r.actual_return_date)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={r.client_notified ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}>
                      {r.client_notified ? 'Ja' : 'Nee'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{r.notes ?? '—'}</TableCell>
                  <TableCell>
                    {!r.actual_return_date && (
                      <Button size="sm" variant="outline" onClick={() => recover.mutate(r.id)} disabled={recover.isPending}>
                        Hersteld melden
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

export default EmployeeSickTab;
