import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, CheckCircle2, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { logAudit } from '@/lib/audit';

const flagLabels: Record<string, string> = {
  missing_phone: 'Telefoon ontbreekt',
  missing_email: 'E-mail ontbreekt',
  old_cv: 'CV ouder dan 1 jaar',
  cv_has_photo: 'CV bevat foto',
  bounced_email: 'E-mail bounce',
  carerix_document_missing_file: 'Carerix-document zonder bestand',
};

const severityClass: Record<string, string> = {
  low: 'bg-muted text-muted-foreground border-0',
  medium: 'bg-yellow-100 text-yellow-700 border-0',
  high: 'bg-red-100 text-red-700 border-0',
};

type Props = {
  candidateId?: string;
  limit?: number;
  showRefresh?: boolean;
};

export default function CandidateQualityFlags({ candidateId, limit = 50, showRefresh = true }: Props) {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: flags = [], isLoading } = useQuery({
    queryKey: ['candidate-quality-flags', orgId, candidateId, limit],
    queryFn: async () => {
      let query = supabase
        .from('candidate_data_quality_flags' as any)
        .select('*, candidates!candidate_data_quality_flags_candidate_id_fkey(id, first_name, last_name)')
        .eq('organization_id', orgId)
        .eq('status', 'open')
        .order('severity', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (candidateId) query = query.eq('candidate_id', candidateId);
      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('refresh_candidate_data_quality_flags' as any, { p_org_id: orgId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-quality-flags'] });
      qc.invalidateQueries({ queryKey: ['data-quality'] });
      toast.success('Datakwaliteit bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message ?? 'Refresh mislukt'),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'resolved' | 'ignored' }) => {
      const { error } = await supabase
        .from('candidate_data_quality_flags' as any)
        .update({ status, resolved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      logAudit({
        action: 'status_change',
        tableName: 'candidate_data_quality_flags',
        recordId: id,
        newValues: { status },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-quality-flags'] });
      qc.invalidateQueries({ queryKey: ['data-quality'] });
      toast.success('Datakwaliteit bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message ?? 'Opslaan mislukt'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Datakwaliteit</CardTitle>
        {showRefresh && (
          <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
            Controleren
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {!candidateId && <TableHead>Kandidaat</TableHead>}
              <TableHead>Signaal</TableHead>
              <TableHead>Ernst</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">Actie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map((flag: any) => {
              const candidate = flag.candidates;
              return (
                <TableRow key={flag.id}>
                  {!candidateId && (
                    <TableCell>
                      {candidate ? (
                        <Link to={`/kandidaten/${candidate.id}`} className="font-medium text-primary hover:underline">
                          {candidate.first_name} {candidate.last_name}
                        </Link>
                      ) : '—'}
                    </TableCell>
                  )}
                  <TableCell>{flagLabels[flag.flag_type] ?? flag.flag_type}</TableCell>
                  <TableCell><Badge variant="secondary" className={severityClass[flag.severity] ?? ''}>{flag.severity}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDetails(flag.details)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ id: flag.id, status: 'resolved' })} className="gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Opgelost
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => updateStatus.mutate({ id: flag.id, status: 'ignored' })} className="gap-1">
                        <EyeOff className="h-3.5 w-3.5" /> Negeer
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!isLoading && flags.length === 0 && (
              <TableRow>
                <TableCell colSpan={candidateId ? 4 : 5} className="text-center text-muted-foreground">Geen open datakwaliteitssignalen</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function formatDetails(details: unknown) {
  if (!details || typeof details !== 'object') return '—';
  const value = details as Record<string, unknown>;
  if (value.missing_documents) return `${value.missing_documents} document(en) zonder bestand`;
  if (value.latest_cv_at) return `Laatste CV: ${new Date(String(value.latest_cv_at)).toLocaleDateString('nl-NL')}`;
  if (value.field) return `Veld: ${value.field}`;
  if (value.reason) return String(value.reason);
  return '—';
}
