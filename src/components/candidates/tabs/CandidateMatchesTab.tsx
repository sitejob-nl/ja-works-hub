import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Mail, UserPlus } from 'lucide-react';
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

const toScorePercent = (score: unknown) => {
  if (typeof score !== 'number') return null;
  return Math.max(0, Math.min(100, score <= 1 ? score * 100 : score));
};

const CandidateMatchesTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [feedbackRequest, setFeedbackRequest] = useState<{ match: any; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ to: string; contact_name: string; subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: matches = [] } = useQuery({
    queryKey: ['candidate-matches', orgId, candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, vacancies!matches_vacancy_id_fkey(id, title, companies!vacancies_company_id_fkey(id, name))')
        .eq('organization_id', orgId)
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

      const { error } = await supabase.from('matches')
        .update({ status, status_changed_at: new Date().toISOString() } as any)
        .eq('organization_id', orgId)
        .eq('id', matchId);
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
      qc.invalidateQueries({ queryKey: ['candidate-matches', orgId, candidateId] });
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
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

  const openPreview = async (matchId: string) => {
    setPreviewMatchId(matchId);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: matchId, preview: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Kon preview niet laden');
      setPreviewData({ to: json.to, contact_name: json.contact_name, subject: json.subject, html: json.html });
    } catch (e: any) {
      toast.error(e.message);
      setPreviewMatchId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendProposalMutation = useMutation({
    mutationFn: async (matchId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: matchId }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error ?? json.outlook_error ?? 'Fout bij versturen');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-matches', orgId, candidateId] });
      qc.invalidateQueries({ queryKey: ['match-pipeline'] });
      toast.success('Voorstel verstuurd naar opdrachtgever');
      setPreviewMatchId(null);
      setPreviewData(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Matches</h3>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to={`/kandidaten/${candidateId}?tab=vacatures`}>
            <UserPlus className="h-3.5 w-3.5" /> Nieuwe match
          </Link>
        </Button>
      </div>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vacature</TableHead>
              <TableHead>Bedrijf</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Voorgesteld</TableHead>
              <TableHead className="text-right">Acties</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(matches as any[]).map((m) => {
              const scorePercent = toScorePercent(m.match_score);
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    <EntityLink type="vacancy" id={m.vacancy_id}>{m.vacancies?.title ?? '—'}</EntityLink>
                  </TableCell>
                  <TableCell>
                    <EntityLink type="company" id={m.vacancies?.companies?.id}>{m.vacancies?.companies?.name ?? '—'}</EntityLink>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={scorePercent ?? 0} className="h-2 w-16" />
                      <span className="text-xs text-muted-foreground">{scorePercent != null ? `${Math.round(scorePercent)}%` : '—'}</span>
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
                  <TableCell className="text-right">
                    {m.status === 'voorgesteld' ? (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openPreview(m.id)} disabled={previewLoading && previewMatchId === m.id}>
                        <Mail className="mr-1 h-3.5 w-3.5" /> {previewLoading && previewMatchId === m.id ? '...' : 'Mail'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {(matches as any[]).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nog geen matches voor deze kandidaat</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!previewMatchId} onOpenChange={(open) => { if (!open) { setPreviewMatchId(null); setPreviewData(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Voorstel-mail preview</DialogTitle>
          </DialogHeader>
          {previewData ? (
            <>
              <div className="space-y-1 text-sm border-b pb-3">
                <div><span className="text-muted-foreground">Naar:</span> <span className="font-medium">{previewData.contact_name}</span> &lt;{previewData.to}&gt;</div>
                <div><span className="text-muted-foreground">Onderwerp:</span> <span className="font-medium">{previewData.subject}</span></div>
              </div>
              <div className="flex-1 overflow-auto border rounded">
                <iframe title="email-preview" srcDoc={previewData.html} sandbox="" className="w-full" style={{ height: '500px' }} />
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">Preview laden...</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewMatchId(null); setPreviewData(null); }}>Annuleren</Button>
            <Button onClick={() => previewMatchId && sendProposalMutation.mutate(previewMatchId)} disabled={!previewData || sendProposalMutation.isPending}>
              {sendProposalMutation.isPending ? 'Versturen...' : 'Versturen naar opdrachtgever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
