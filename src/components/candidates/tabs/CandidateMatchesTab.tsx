import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useOutboundPause } from '@/hooks/useOutboundPause';
import { useAuth } from '@/contexts/AuthContext';
import { AlertTriangle, Mail, UserPlus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import MatchCard from '@/components/matches/MatchCard';
import MatchFeedbackDialog from '@/components/matches/MatchFeedbackDialog';
import MatchInspectorDialog from '@/components/matches/MatchInspectorDialog';
import { matchStatusNeedsFeedbackDialog } from '@/lib/match-status';
import { toast } from 'sonner';
import type { MatchBreakdown } from '@/lib/matching';

const CandidateMatchesTab = ({ candidateId, candidate }: { candidateId: string; candidate?: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [feedbackRequest, setFeedbackRequest] = useState<{ match: any; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ to: string; contact_name: string; subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detail, setDetail] = useState<{ title: string; description: string; breakdown?: MatchBreakdown | null; quality?: number | null } | null>(null);
  const { data: outboundPaused } = useOutboundPause(orgId);

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
    if (matchStatusNeedsFeedbackDialog(toStatus)) {
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
        <div>
          <h3 className="font-medium">Matches</h3>
          <p className="text-xs text-muted-foreground">Bestaande matches met dezelfde score-uitleg en statusregels als de vacaturekant.</p>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to={`/kandidaten/${candidateId}?tab=vacatures`}>
            <UserPlus className="h-3.5 w-3.5" /> Nieuwe match
          </Link>
        </Button>
      </div>
      <div className="space-y-2">
        {(matches as any[]).map((m) => {
          const breakdown = m.match_breakdown as MatchBreakdown | null;
          const vacancy = m.vacancies as any;
          const company = vacancy?.companies as any;
          return (
            <MatchCard
              key={m.id}
              id={m.id}
              status={m.status}
              candidate={candidate ? {
                id: candidate.id,
                first_name: candidate.first_name,
                last_name: candidate.last_name,
                email: candidate.email,
                phone: candidate.phone,
                compliance_status: candidate.compliance_status,
              } : { id: candidateId, first_name: 'Deze', last_name: 'kandidaat' }}
              vacancy={{
                id: m.vacancy_id,
                title: vacancy?.title,
                company_id: company?.id,
                company_name: company?.name,
              }}
              statusChangedAt={m.status_changed_at}
              createdAt={m.created_at}
              score={m.match_score}
              breakdown={breakdown}
              candidateQuality={breakdown?.candidateQuality ?? null}
              statusDisabled={statusMutation.isPending}
              onStatusChange={(value) => handleStatusChange(m, value)}
              onInspect={() => setDetail({
                title: 'Waarom deze match?',
                description: `${vacancy?.title ?? 'Vacature'} — score-opbouw voor deze kandidaat.`,
                breakdown,
                quality: breakdown?.candidateQuality ?? null,
              })}
              primaryAction={m.status === 'voorgesteld' ? (
                <Button size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => openPreview(m.id)} disabled={previewLoading && previewMatchId === m.id}>
                  <Mail className="h-3.5 w-3.5" /> {previewLoading && previewMatchId === m.id ? 'Laden...' : 'Mail preview'}
                </Button>
              ) : null}
            />
          );
        })}
        {(matches as any[]).length === 0 && (
          <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
            Nog geen matches voor deze kandidaat. Open "Passende vacatures" om een eerste match te maken.
          </div>
        )}
      </div>

      <MatchInspectorDialog
        open={!!detail}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
        title={detail?.title ?? 'Waarom deze match?'}
        description={detail?.description}
        breakdown={detail?.breakdown ?? null}
        candidateQuality={detail?.quality ?? null}
      />

      <Dialog open={!!previewMatchId} onOpenChange={(open) => { if (!open) { setPreviewMatchId(null); setPreviewData(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Voorstel-mail preview</DialogTitle>
          </DialogHeader>
          {outboundPaused?.email === true && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>E-mail staat op pauze</AlertTitle>
              <AlertDescription>Je kunt de preview controleren, maar versturen is geblokkeerd door de outbound kill-switch.</AlertDescription>
            </Alert>
          )}
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
            <Button onClick={() => previewMatchId && sendProposalMutation.mutate(previewMatchId)} disabled={!previewData || sendProposalMutation.isPending || outboundPaused?.email === true}>
              {outboundPaused?.email === true ? 'E-mail gepauzeerd' : sendProposalMutation.isPending ? 'Versturen...' : 'Versturen naar opdrachtgever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MatchFeedbackDialog
        open={!!feedbackRequest}
        toStatus={feedbackRequest?.toStatus}
        reasons={feedbackReasons as any[]}
        reasonId={feedbackReasonId}
        notes={feedbackNotes}
        pending={statusMutation.isPending}
        onReasonChange={setFeedbackReasonId}
        onNotesChange={setFeedbackNotes}
        onCancel={() => setFeedbackRequest(null)}
        onSubmit={() => feedbackRequest && statusMutation.mutate({
          matchId: feedbackRequest.match.id,
          status: feedbackRequest.toStatus,
          reasonId: feedbackReasonId || null,
          notes: feedbackNotes || null,
        })}
      />
    </div>
  );
};

export default CandidateMatchesTab;
