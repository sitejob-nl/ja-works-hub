import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { getMatchTransition } from '@/lib/match-transitions';
import MatchInterviewDialog from './MatchInterviewDialog';
import MatchProposalEmailDialog from './MatchProposalEmailDialog';
import PlacementWizard from '@/components/placement/PlacementWizard';

type CommitFn = (matchIds: string[], toStatus: string, extra?: Record<string, unknown>) => void;

type PendingProposal = { match: any; toStatus: string; commitFirst: boolean };
type PendingInterview = { match: any; toStatus: string };

const matchCandidateName = (match: any) => {
  const c = match?.candidates ?? match?.candidate;
  return `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || null;
};

/**
 * Voert het werk uit dat bij een fasewissel hoort, voor kanban én lijst.
 *
 * De aanroeper levert alleen `commit` (hoe een status wordt weggeschreven) en
 * `onDone` (wat er daarna ververst moet worden). Welke dialoog bij welke fase hoort,
 * en of de status vóór of ná die dialoog geschreven wordt, staat in
 * `@/lib/match-transitions` — niet hier en niet in de schermen.
 *
 * Afwijzen zit hier bewust níét in: beide schermen hebben hun eigen feedbackdialoog
 * met bulk-ondersteuning. `request()` geeft daarvoor `false` terug zodat de aanroeper
 * zijn bestaande route houdt.
 */
export function useMatchTransitions({
  commit,
  onDone,
  canConfirmInterview = true,
}: {
  commit: CommitFn;
  onDone?: () => void;
  /** Recht `matching.interview.confirm` — bepaalt of een afspraakmoment vastgelegd mag worden. */
  canConfirmInterview?: boolean;
}) {
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<PendingProposal | null>(null);
  const [interview, setInterview] = useState<PendingInterview | null>(null);
  const [interviewValue, setInterviewValue] = useState('');
  const [placement, setPlacement] = useState<{ match: any; vacancy: any } | null>(null);

  const openPlacement = async (match: any) => {
    const vacancyId = match?.vacancies?.id ?? match?.vacancy_id;
    if (!vacancyId) {
      toast.error('Deze match heeft geen vacature — plaatsen kan alleen vanaf de vacature.');
      return;
    }
    try {
      // De pipeline-query levert de vacature maar deels mee (geen company_id, tarief of
      // startdatum). De wizard heeft die wél nodig, dus hier compleet ophalen.
      const vacancy = await unwrap(
        supabase
          .from('vacancies')
          .select('*, companies!vacancies_company_id_fkey(id, name, email)')
          .eq('id', vacancyId)
          .single(),
      );
      setPlacement({ match, vacancy });
    } catch {
      toast.error('Vacature kon niet geladen worden — plaatsing niet gestart.');
    }
  };

  /**
   * @returns true als deze hook de overgang overneemt; false betekent dat de
   * aanroeper zijn eigen afhandeling moet doen (afwijzen, of een kale statuswissel).
   */
  const request = (matchIds: string[], toStatus: string, match?: any): boolean => {
    const transition = getMatchTransition(toStatus, matchIds.length);
    if (transition.kind === 'none' || transition.kind === 'feedback') return false;
    if (!match) return false;

    switch (transition.kind) {
      case 'proposal':
        if (transition.commitFirst) commit(matchIds, toStatus);
        setProposal({ match, toStatus, commitFirst: transition.commitFirst });
        return true;
      case 'interview':
        if (!canConfirmInterview) {
          toast.error('Je rol mag geen afspraakmoment vastleggen');
          return true;
        }
        setInterviewValue('');
        setInterview({ match, toStatus });
        return true;
      case 'placement':
        commit(matchIds, toStatus);
        void openPlacement(match);
        return true;
      case 'screening': {
        commit(matchIds, toStatus);
        const candidateId = match?.candidates?.id ?? match?.candidate_id;
        const vacancyId = match?.vacancies?.id ?? match?.vacancy_id;
        if (candidateId) {
          navigate(`/kandidaten/${candidateId}?tab=screening${vacancyId ? `&vacancy=${vacancyId}` : ''}`);
        }
        return true;
      }
      default:
        return false;
    }
  };

  const submitInterview = () => {
    if (!interview || !interviewValue) return;
    commit([interview.match.id], interview.toStatus, {
      interview_date: new Date(interviewValue).toISOString(),
    });
    setInterview(null);
    setInterviewValue('');
  };

  const dialogs = (
    <>
      <MatchProposalEmailDialog
        open={!!proposal}
        matchId={proposal?.match?.id ?? null}
        onOpenChange={(open) => { if (!open) setProposal(null); }}
        onSent={() => {
          // Bij een gate-fase ("Voorgesteld") is verzenden het bewijs dat de fase klopt.
          if (proposal && !proposal.commitFirst) commit([proposal.match.id], proposal.toStatus);
          setProposal(null);
          onDone?.();
        }}
      />

      <MatchInterviewDialog
        open={!!interview}
        toStatus={interview?.toStatus}
        candidateName={interview ? matchCandidateName(interview.match) : null}
        value={interviewValue}
        onValueChange={setInterviewValue}
        onCancel={() => { setInterview(null); setInterviewValue(''); }}
        onSubmit={submitInterview}
      />

      <PlacementWizard
        open={!!placement}
        match={placement?.match ?? null}
        vacancy={placement?.vacancy ?? null}
        onClose={() => { setPlacement(null); onDone?.(); }}
      />
    </>
  );

  return { request, dialogs };
}
