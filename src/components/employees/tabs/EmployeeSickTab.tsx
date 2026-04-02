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

const EmployeeSickTab = ({ candidateId, candidate }: { candidateId: string; candidate: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ expected_return_date: '', notes: '' });

  const { data: reports = [] } = useQuery({
    queryKey: ['sick-reports', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sick_reports')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('reported_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createReport = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('sick_reports').insert({
        organization_id: orgId,
        candidate_id: candidateId,
        created_by: user?.id ?? null,
        expected_return_date: form.expected_return_date || null,
        notes: form.notes || null,
      });
      if (error) throw error;
      const { error: e2 } = await supabase.from('candidates').update({ employee_status: 'ziek' as any }).eq('id', candidateId);
      if (e2) throw e2;

      // Auto-notify client via WhatsApp
      try {
        const { data: placements } = await supabase
          .from('placements')
          .select('company_id, companies!placements_company_id_fkey(name)')
          .eq('candidate_id', candidateId)
          .eq('status', 'actief' as any)
          .limit(1);

        const placement = placements?.[0] as any;
        if (placement?.company_id) {
          const { data: contacts } = await supabase
            .from('company_contacts')
            .select('full_name, phone')
            .eq('company_id', placement.company_id)
            .eq('is_primary', true)
            .limit(1);

          const contact = contacts?.[0];
          if (contact?.phone) {
            const empName = `${candidate?.first_name ?? ''} ${candidate?.last_name ?? ''}`.trim();
            const companyName = placement.companies?.name ?? '';
            const msg = `Beste ${contact.full_name}, hierbij informeren wij u dat ${empName} zich ziek heeft gemeld${form.expected_return_date ? `. Verwachte terugkeer: ${form.expected_return_date}` : ''}. Wij houden u op de hoogte. Met vriendelijke groet.`;

            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
              await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-send`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  to: contact.phone,
                  message: msg,
                  company_id: placement.company_id,
                }),
              });
              // Mark client_notified on the sick report
              const { data: latestReport } = await supabase
                .from('sick_reports')
                .select('id')
                .eq('candidate_id', candidateId)
                .order('reported_at', { ascending: false })
                .limit(1);
              if (latestReport?.[0]) {
                await supabase.from('sick_reports')
                  .update({ client_notified: true })
                  .eq('id', latestReport[0].id);
              }
            }
          }
        }
      } catch (notifyErr) {
        console.warn('Kon opdrachtgever niet automatisch informeren:', notifyErr);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sick-reports', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      logAudit({
        action: 'create',
        tableName: 'sick_reports',
        recordId: candidateId,
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
      const { error: e2 } = await supabase.from('candidates').update({ employee_status: 'actief' as any }).eq('id', candidateId);
      if (e2) throw e2;
    },
    onSuccess: (_, reportId) => {
      qc.invalidateQueries({ queryKey: ['sick-reports', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      logAudit({
        action: 'status_change',
        tableName: 'sick_reports',
        recordId: reportId,
        newValues: { actual_return_date: new Date().toISOString().split('T')[0], status: 'actief' },
      });
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
