import { useState } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { nl } from 'date-fns/locale';

const resolveEmployeeRecordId = async (candidateId: string) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Geen medewerkerrecord gevonden voor deze kandidaat');
  return data.id;
};

const PortalSickReport = () => {
  const { employee } = usePortal();
  const qc = useQueryClient();
  const employeeId = employee?.id;
  const orgId = employee?.organization_id;

  const [reason, setReason] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Get active placement
  const { data: placement } = useQuery({
    queryKey: ['portal-active-placement', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('id, employee_id')
        .eq('candidate_id', employeeId!)
        .eq('status', 'actief' as any)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Get previous sick reports
  const { data: reports } = useQuery({
    queryKey: ['portal-sick-reports', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('sick_reports')
        .select('*')
        .eq('candidate_id', employeeId!)
        .order('reported_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!employeeId || !orgId) throw new Error('Geen sessie');
      if (!reason.trim()) throw new Error('Vul een reden in');
      const employeeRecordId = placement?.employee_id ?? await resolveEmployeeRecordId(employeeId);

      const { data: inserted, error } = await supabase
        .from('sick_reports')
        .insert({
          candidate_id: employeeId,
          employee_id: employeeRecordId,
          organization_id: orgId,
          placement_id: placement?.id ?? null,
          notes: reason.trim(),
          expected_return_date: expectedReturn || null,
          reported_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) throw error;

      // Trigger cascade: notify intercedent, email opdrachtgever, WhatsApp confirm
      const { data: cascade } = await supabase.functions.invoke('process-sick-report', {
        body: { sick_report_id: inserted.id },
      });
      return cascade;
    },
    onSuccess: (cascade: any) => {
      qc.invalidateQueries({ queryKey: ['portal-sick-reports'] });
      setSubmitted(true);
      setReason('');
      setExpectedReturn('');
      if (cascade?.email_sent) toast.success('Opdrachtgever is geïnformeerd');
    },
    onError: (err: any) => toast.error(err.message || 'Indienen mislukt'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Ziekmelding</h1>

      {submitted ? (
        <div className="bg-card rounded-xl border p-6 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-stat-green mx-auto" />
          <p className="font-semibold">Ziekmelding ingediend</p>
          <p className="text-sm text-muted-foreground">
            Je werkgever en opdrachtgever worden automatisch geïnformeerd.
          </p>
          <Button variant="outline" onClick={() => setSubmitted(false)}>
            Nieuwe melding
          </Button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border p-4 space-y-4">
          <div className="flex items-center gap-2 text-orange-600">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm font-medium">Ziek melden</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Opmerking (optioneel)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Bijv. wanneer je verwacht weer te kunnen werken. Vermeld géén medische details."
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Verwachte terugkeerdatum (optioneel)</Label>
              <Input
                type="date"
                value={expectedReturn}
                onChange={(e) => setExpectedReturn(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="w-full"
          >
            {submitMutation.isPending ? 'Indienen...' : 'Ziekmelding indienen'}
          </Button>
        </div>
      )}

      {/* History */}
      {reports && reports.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Eerdere meldingen</p>
          <div className="bg-card rounded-xl border divide-y">
            {reports.map((r) => (
              <div key={r.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {format(new Date(r.reported_at), 'd MMM yyyy', { locale: nl })}
                  </p>
                  {r.actual_return_date ? (
                    <Badge variant="secondary" className="text-[10px] bg-stat-green/10 text-stat-green border-0">
                      Hersteld
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-600 border-0">
                      Actief
                    </Badge>
                  )}
                </div>
                {r.notes && <p className="text-sm text-muted-foreground">{r.notes}</p>}
                <div className="flex gap-4 text-xs text-muted-foreground">
                  {r.expected_return_date && (
                    <span>Verwacht: {format(new Date(r.expected_return_date), 'd MMM', { locale: nl })}</span>
                  )}
                  {r.actual_return_date && (
                    <span>Hersteld: {format(new Date(r.actual_return_date), 'd MMM', { locale: nl })}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalSickReport;
