import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Mail, UserPlus, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MatchRow from '@/components/matches/MatchRow';
import MatchFeedbackDialog from '@/components/matches/MatchFeedbackDialog';
import MatchInspectorDialog from '@/components/matches/MatchInspectorDialog';
import MatchProposalEmailDialog from '@/components/matches/MatchProposalEmailDialog';
import { matchStatusNeedsFeedbackDialog } from '@/lib/match-status';
import { toast } from 'sonner';
import type { MatchBreakdown } from '@/lib/matching';
import { advanceMatchStatus } from '@/lib/match-lifecycle';

const CandidateMatchesTab = ({ candidateId, candidate }: { candidateId: string; candidate?: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [feedbackRequest, setFeedbackRequest] = useState<{ match: any; toStatus: string } | null>(null);
  const [feedbackReasonId, setFeedbackReasonId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ title: string; description: string; breakdown?: MatchBreakdown | null; quality?: number | null; candidate?: any | null; vacancyId?: string | null } | null>(null);

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
      await advanceMatchStatus(supabase as any, {
        orgId,
        matchId,
        toStatus: status,
        currentMatch: current,
        reasonId: reasonId ?? null,
        notes: notes ?? null,
        actorId: user?.id ?? null,
      });
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

  const openPreview = (matchId: string) => setPreviewMatchId(matchId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Matches</h3>
          <p className="text-xs text-muted-foreground">Bestaande matches met dezelfde score-uitleg en statusregels als de vacaturekant.</p>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to={`/kandidaten/${candidateId}?tab=vacatures`}>
            <UserPlus className="h-3.5 w-3.5" /> Match maken
          </Link>
        </Button>
      </div>
      <div className="space-y-2">
        {(matches as any[]).map((m) => {
          const breakdown = m.match_breakdown as MatchBreakdown | null;
          const vacancy = m.vacancies as any;
          const company = vacancy?.companies as any;
          return (
            <MatchRow
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
                available_from: candidate.available_from,
                available_until: candidate.available_until,
                arrival_date: candidate.arrival_date,
                availability_notes: candidate.availability_notes,
                ai_analysis: candidate.ai_analysis,
                ai_summary: candidate.ai_summary,
                ai_classification: candidate.ai_classification,
                ai_reliability_score: candidate.ai_reliability_score,
                screening_data: candidate.screening_data,
                screened_at: candidate.screened_at,
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
                candidate,
                vacancyId: m.vacancy_id,
              })}
              primaryAction={m.status === 'voorgesteld' ? (
                <Button size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => openPreview(m.id)}>
                  <Mail className="h-3.5 w-3.5" /> Mail preview
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
        candidate={detail?.candidate ?? null}
        action={detail?.vacancyId ? (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to={`/vacatures/${detail.vacancyId}`}><Briefcase className="h-3.5 w-3.5" /> Bekijk vacature</Link>
          </Button>
        ) : undefined}
      />

      <MatchProposalEmailDialog
        open={!!previewMatchId}
        matchId={previewMatchId}
        onOpenChange={(open) => { if (!open) setPreviewMatchId(null); }}
        onSent={() => {
          qc.invalidateQueries({ queryKey: ['candidate-matches', orgId, candidateId] });
          qc.invalidateQueries({ queryKey: ['match-pipeline'] });
        }}
      />

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
