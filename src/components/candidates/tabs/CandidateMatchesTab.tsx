import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EntityLink } from '@/components/ui/entity-link';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

const STATUS_OPTIONS = [
  { value: 'nieuwe_match', label: 'Nieuwe match' },
  { value: 'gescreend', label: 'Gescreend' },
  { value: 'voorgesteld', label: 'Voorgesteld' },
  { value: 'voorgesteld_bij_klant', label: 'Voorgesteld bij klant' },
  { value: 'in_gesprek', label: 'In gesprek' },
  { value: 'geaccepteerd', label: 'Geaccepteerd' },
  { value: 'afgewezen', label: 'Afgewezen' },
  { value: 'geplaatst', label: 'Geplaatst' },
];

const CandidateMatchesTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [feedbackRequest, setFeedbackRequest] = useState<{ match: any; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');

  const { data: matches = [] } = useQuery({
    queryKey: ['candidate-matches', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, vacancies!matches_vacancy_id_fkey(id, title, companies!vacancies_company_id_fkey(id, name))')
        .eq('candidate_id', candidateId)
        .order('proposed_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: feedbackReasons = [] } = useQuery({
    queryKey: ['match-feedback-reasons', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('match_feedback_reasons')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ matchId, status, reasonId, notes }: { matchId: string; status: string; reasonId?: string | null; notes?: string | null }) => {
      const current = (matches as any[]).find((m) => m.id === matchId);
      if (status === 'afgewezen' && !reasonId) throw new Error('Kies een feedbackreden voor afwijzen');

      const { error } = await supabase.from('matches').update({ status, status_changed_at: new Date().toISOString() } as any).eq('id', matchId);
      if (error) throw error;

      if (reasonId || notes || ['afgewezen', 'geaccepteerd', 'geplaatst'].includes(status)) {
        const { error: feedbackError } = await (supabase as any).from('match_feedback_events').insert({
          organization_id: orgId,
          match_id: matchId,
          from_status: current?.status ?? null,
          to_status: status,
          reason_id: reasonId ?? null,
          notes: notes?.trim() || null,
          created_by: user?.id ?? null,
          match_score_snapshot: current?.match_score ?? null,
          match_breakdown_snapshot: current?.match_breakdown ?? null,
        });
        if (feedbackError) throw feedbackError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-matches', candidateId] });
      toast.success('Status bijgewerkt');
      setFeedbackRequest(null);
      setFeedbackReasonId('');
      setFeedbackNotes('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleStatusChange = (match: any, toStatus: string) => {
    if (toStatus === match.status) return;
    if (toStatus === 'afgewezen') {
      setFeedbackReasonId('');
      setFeedbackNotes('');
      setFeedbackRequest({ match, toStatus });
      return;
    }
    statusMutation.mutate({ matchId: match.id, status: toStatus });
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Matches</h3>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vacature</TableHead>
              <TableHead>Bedrijf</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Voorgesteld</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(matches as any[]).map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  <EntityLink type="vacancy" id={m.vacancy_id}>{m.vacancies?.title ?? '—'}</EntityLink>
                </TableCell>
                <TableCell>
                  <EntityLink type="company" id={m.vacancies?.companies?.id}>{m.vacancies?.companies?.name ?? '—'}</EntityLink>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={(m.match_score ?? 0) * 100} className="h-2 w-16" />
                    <span className="text-xs text-muted-foreground">{m.match_score ? `${Math.round(m.match_score * 100)}%` : '—'}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Select value={m.status} onValueChange={(v) => handleStatusChange(m, v)} disabled={statusMutation.isPending}>
                    <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>{formatDate(m.proposed_at)}</TableCell>
              </TableRow>
            ))}
            {(matches as any[]).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nog geen matches voor deze kandidaat</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Afwijzen — feedbackreden verplicht */}
      <Dialog open={!!feedbackRequest} onOpenChange={(o) => { if (!o) setFeedbackRequest(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Match afwijzen</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reden *</Label>
              <Select value={feedbackReasonId} onValueChange={setFeedbackReasonId}>
                <SelectTrigger><SelectValue placeholder="Kies een feedbackreden" /></SelectTrigger>
                <SelectContent>
                  {(feedbackReasons as any[]).length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Geen redenen geconfigureerd</div>
                  )}
                  {(feedbackReasons as any[]).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label ?? r.name ?? r.reason ?? r.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Toelichting (optioneel)</Label>
              <Textarea value={feedbackNotes} onChange={(e) => setFeedbackNotes(e.target.value)} rows={3} placeholder="Korte toelichting..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFeedbackRequest(null)}>Annuleren</Button>
            <Button
              onClick={() => feedbackRequest && statusMutation.mutate({ matchId: feedbackRequest.match.id, status: feedbackRequest.toStatus, reasonId: feedbackReasonId || null, notes: feedbackNotes || null })}
              disabled={!feedbackReasonId || statusMutation.isPending}
            >
              {statusMutation.isPending ? 'Opslaan...' : 'Afwijzen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CandidateMatchesTab;
