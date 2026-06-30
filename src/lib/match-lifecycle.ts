import { isTerminalMatchStatus, requiresMatchFeedbackReason, type MatchStatus } from '@/lib/match-status';
import type { MatchBreakdown } from '@/lib/matching';

export type MatchLifecycleClient = {
  from: (table: string) => any;
};

export type MatchLifecycleEventMode = 'auto' | 'always' | 'never';

export type MatchSnapshot = {
  id: string;
  organization_id?: string | null;
  status?: string | null;
  match_score?: number | null;
  match_breakdown?: MatchBreakdown | Record<string, unknown> | null;
};

export type MatchScoreInput = MatchBreakdown | {
  matchPercent?: number | null;
  reasoning?: string | null;
  distance?: {
    km?: number | null;
    durationMin?: number | null;
  } | null;
} | null;

const runQuery = async <T>(query: PromiseLike<{ data: T; error: any }>): Promise<T> => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const buildMatchScorePatch = (score?: MatchScoreInput) => {
  if (!score) return {};
  return {
    match_score: score.matchPercent ?? null,
    match_reasoning: score.reasoning ?? null,
    match_breakdown: score as any,
    distance_km: score.distance?.km ?? null,
    duration_min: score.distance?.durationMin ?? null,
  };
};

export const buildMatchCreateRow = (input: {
  orgId: string;
  vacancyId: string;
  candidateId: string;
  proposedBy?: string | null;
  assignedTo?: string | null;
  source?: string | null;
  status?: MatchStatus | string | null;
  notes?: string | null;
  proposedAt?: string | null;
  score?: MatchScoreInput;
}) => ({
  organization_id: input.orgId,
  vacancy_id: input.vacancyId,
  candidate_id: input.candidateId,
  proposed_by: input.proposedBy ?? null,
  assigned_to: input.assignedTo ?? null,
  status: (input.status ?? 'nieuwe_match') as any,
  source: input.source ?? 'eigen_match',
  notes: input.notes?.trim() || null,
  ...(input.proposedAt ? { proposed_at: input.proposedAt } : {}),
  ...buildMatchScorePatch(input.score),
});

export async function createMatch(
  client: MatchLifecycleClient,
  input: Parameters<typeof buildMatchCreateRow>[0],
): Promise<{ id: string }> {
  return runQuery(
    client
      .from('matches')
      .insert(buildMatchCreateRow(input))
      .select('id')
      .single(),
  );
}

export const shouldRecordMatchLifecycleEvent = (input: {
  mode?: MatchLifecycleEventMode;
  toStatus: string;
  reasonId?: string | null;
  notes?: string | null;
}) => {
  if (input.mode === 'never') return false;
  if (input.mode === 'always') return true;
  return Boolean(input.reasonId || input.notes?.trim() || isTerminalMatchStatus(input.toStatus));
};

export const buildMatchFeedbackEvent = (input: {
  orgId: string;
  matchId: string;
  fromStatus?: string | null;
  toStatus: string;
  reasonId?: string | null;
  notes?: string | null;
  actorId?: string | null;
  scoreSnapshot?: number | null;
  breakdownSnapshot?: MatchSnapshot['match_breakdown'];
}) => ({
  organization_id: input.orgId,
  match_id: input.matchId,
  from_status: input.fromStatus ?? null,
  to_status: input.toStatus as any,
  reason_id: input.reasonId ?? null,
  notes: input.notes?.trim() || null,
  created_by: input.actorId ?? null,
  match_score_snapshot: input.scoreSnapshot ?? null,
  match_breakdown_snapshot: (input.breakdownSnapshot ?? null) as any,
});

async function loadMatchSnapshot(client: MatchLifecycleClient, orgId: string, matchId: string): Promise<MatchSnapshot | null> {
  return runQuery(
    client
      .from('matches')
      .select('id, organization_id, status, match_score, match_breakdown')
      .eq('organization_id', orgId)
      .eq('id', matchId)
      .maybeSingle(),
  );
}

export async function advanceMatchStatus(
  client: MatchLifecycleClient,
  input: {
    orgId: string;
    matchId: string;
    toStatus: MatchStatus | string;
    actorId?: string | null;
    reasonId?: string | null;
    notes?: string | null;
    patch?: Record<string, unknown>;
    currentMatch?: MatchSnapshot | null;
    requireReason?: boolean;
    eventMode?: MatchLifecycleEventMode;
  },
) {
  const current = input.currentMatch ?? await loadMatchSnapshot(client, input.orgId, input.matchId);
  if (!current) throw new Error('Match niet gevonden');
  if (input.requireReason !== false && requiresMatchFeedbackReason(input.toStatus) && !input.reasonId) {
    throw new Error('Kies een feedbackreden voor afwijzen');
  }

  await runQuery(
    client
      .from('matches')
      .update({
        ...(input.patch ?? {}),
        status: input.toStatus as any,
        status_changed_at: new Date().toISOString(),
      } as any)
      .eq('organization_id', input.orgId)
      .eq('id', input.matchId),
  );

  if (shouldRecordMatchLifecycleEvent({
    mode: input.eventMode,
    toStatus: input.toStatus,
    reasonId: input.reasonId,
    notes: input.notes,
  })) {
    await runQuery(
      client
        .from('match_feedback_events')
        .insert(buildMatchFeedbackEvent({
          orgId: input.orgId,
          matchId: input.matchId,
          fromStatus: current.status ?? null,
          toStatus: input.toStatus,
          reasonId: input.reasonId ?? null,
          notes: input.notes ?? null,
          actorId: input.actorId ?? null,
          scoreSnapshot: current.match_score ?? null,
          breakdownSnapshot: current.match_breakdown ?? null,
        })),
    );
  }

  return { fromStatus: current.status ?? null, toStatus: input.toStatus, changed: current.status !== input.toStatus };
}
