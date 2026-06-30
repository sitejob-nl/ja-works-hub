// Match lifecycle helpers for edge adapters.
//
// Scoring stays in matching-core.ts. This module owns the operational lifecycle around
// a match: row creation, status transitions, feedback events, proposal-token responses,
// and follow-up tasks. Edge functions stay adapters over this seam.

export const MATCH_STATUS_FLOW = [
  "nieuwe_match",
  "gescreend",
  "voorgesteld",
  "voorgesteld_bij_klant",
  "afspraak_voorgesteld",
  "afspraak_op_kantoor",
  "geaccepteerd",
  "afgewezen",
  "geplaatst",
] as const;

export type MatchStatus = typeof MATCH_STATUS_FLOW[number] | "in_gesprek";
export type MatchLifecycleEventMode = "auto" | "always" | "never";

export const INITIAL_MATCH_STATUS: MatchStatus = "nieuwe_match";
export const TERMINAL_MATCH_STATUSES = ["afgewezen", "geaccepteerd", "geplaatst"] as const;
export const FEEDBACK_REQUIRED_STATUSES = ["afgewezen"] as const;

export const NEXT_MATCH_STATUS: Record<string, MatchStatus> = {
  nieuwe_match: "gescreend",
  gescreend: "voorgesteld",
  voorgesteld: "voorgesteld_bij_klant",
  voorgesteld_bij_klant: "afspraak_voorgesteld",
  afspraak_voorgesteld: "afspraak_op_kantoor",
  afspraak_op_kantoor: "geaccepteerd",
  in_gesprek: "geaccepteerd",
};

export const MATCH_PROPOSAL_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type MatchLifecycleClient = {
  from: (table: string) => any;
};

export type MatchSnapshot = {
  id: string;
  organization_id?: string | null;
  status?: string | null;
  match_score?: number | null;
  match_breakdown?: unknown;
};

export type MatchScoreSnapshot = {
  matchPercent?: number | null;
  reasoning?: string | null;
  distance?: {
    km?: number | null;
    durationMin?: number | null;
  } | null;
};

export function isTerminalMatchStatus(status: string | null | undefined): boolean {
  return TERMINAL_MATCH_STATUSES.includes(status as any);
}

export function requiresMatchFeedbackReason(status: string | null | undefined): boolean {
  return FEEDBACK_REQUIRED_STATUSES.includes(status as any);
}

export function getNextMatchStatus(status: string | null | undefined): MatchStatus | null {
  return NEXT_MATCH_STATUS[status ?? ""] ?? null;
}

export function buildMatchScorePatch(score: MatchScoreSnapshot | null | undefined) {
  if (!score) return {};
  return {
    match_score: score.matchPercent ?? null,
    match_reasoning: score.reasoning ?? null,
    match_breakdown: score,
    distance_km: score.distance?.km ?? null,
    duration_min: score.distance?.durationMin ?? null,
  };
}

export function buildMatchCreateRow(input: {
  orgId: string;
  vacancyId: string;
  candidateId: string;
  proposedBy?: string | null;
  assignedTo?: string | null;
  source?: string | null;
  status?: MatchStatus | null;
  notes?: string | null;
  score?: MatchScoreSnapshot | null;
}) {
  return {
    organization_id: input.orgId,
    vacancy_id: input.vacancyId,
    candidate_id: input.candidateId,
    proposed_by: input.proposedBy ?? null,
    assigned_to: input.assignedTo ?? null,
    status: input.status ?? INITIAL_MATCH_STATUS,
    source: input.source ?? "eigen_match",
    notes: input.notes?.trim() || null,
    ...buildMatchScorePatch(input.score),
  };
}

export async function createMatch(
  client: MatchLifecycleClient,
  input: Parameters<typeof buildMatchCreateRow>[0],
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("matches")
    .insert(buildMatchCreateRow(input))
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

export function shouldRecordMatchLifecycleEvent(input: {
  mode?: MatchLifecycleEventMode;
  toStatus: string;
  reasonId?: string | null;
  notes?: string | null;
}): boolean {
  if (input.mode === "never") return false;
  if (input.mode === "always") return true;
  return Boolean(input.reasonId || input.notes?.trim() || isTerminalMatchStatus(input.toStatus));
}

export function buildMatchFeedbackEvent(input: {
  orgId: string;
  matchId: string;
  fromStatus?: string | null;
  toStatus: string;
  reasonId?: string | null;
  notes?: string | null;
  actorId?: string | null;
  scoreSnapshot?: number | null;
  breakdownSnapshot?: unknown;
}) {
  return {
    organization_id: input.orgId,
    match_id: input.matchId,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus,
    reason_id: input.reasonId ?? null,
    notes: input.notes?.trim() || null,
    created_by: input.actorId ?? null,
    match_score_snapshot: input.scoreSnapshot ?? null,
    match_breakdown_snapshot: input.breakdownSnapshot ?? null,
  };
}

export async function recordMatchFeedbackEvent(
  client: MatchLifecycleClient,
  input: Parameters<typeof buildMatchFeedbackEvent>[0],
) {
  const { error } = await client.from("match_feedback_events").insert(buildMatchFeedbackEvent(input));
  if (error) throw error;
}

export async function loadMatchSnapshot(
  client: MatchLifecycleClient,
  orgId: string,
  matchId: string,
): Promise<MatchSnapshot | null> {
  const { data, error } = await client
    .from("matches")
    .select("id, organization_id, status, match_score, match_breakdown")
    .eq("id", matchId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function advanceMatchStatus(
  client: MatchLifecycleClient,
  input: {
    orgId: string;
    matchId: string;
    toStatus: MatchStatus;
    actorId?: string | null;
    reasonId?: string | null;
    notes?: string | null;
    patch?: Record<string, unknown>;
    currentMatch?: MatchSnapshot | null;
    requireReason?: boolean;
    eventMode?: MatchLifecycleEventMode;
    skipIfCurrentTerminal?: boolean;
  },
): Promise<{ changed: boolean; fromStatus: string | null; toStatus: MatchStatus }> {
  const current = input.currentMatch ?? await loadMatchSnapshot(client, input.orgId, input.matchId);
  if (!current) throw new Error("Match not found");
  if (input.requireReason !== false && requiresMatchFeedbackReason(input.toStatus) && !input.reasonId) {
    throw new Error("Kies een feedbackreden voor afwijzen");
  }
  if (input.skipIfCurrentTerminal && isTerminalMatchStatus(current.status)) {
    return { changed: false, fromStatus: current.status ?? null, toStatus: input.toStatus };
  }

  const update = {
    ...(input.patch ?? {}),
    status: input.toStatus,
    status_changed_at: new Date().toISOString(),
  };
  const { error } = await client
    .from("matches")
    .update(update)
    .eq("id", input.matchId)
    .eq("organization_id", input.orgId);
  if (error) throw error;

  if (shouldRecordMatchLifecycleEvent({
    mode: input.eventMode,
    toStatus: input.toStatus,
    reasonId: input.reasonId,
    notes: input.notes,
  })) {
    await recordMatchFeedbackEvent(client, {
      orgId: input.orgId,
      matchId: input.matchId,
      fromStatus: current.status ?? null,
      toStatus: input.toStatus,
      reasonId: input.reasonId ?? null,
      notes: input.notes ?? null,
      actorId: input.actorId ?? null,
      scoreSnapshot: current.match_score ?? null,
      breakdownSnapshot: current.match_breakdown ?? null,
    });
  }

  return { changed: current.status !== input.toStatus, fromStatus: current.status ?? null, toStatus: input.toStatus };
}

export async function ensureMatchProposalToken(
  client: MatchLifecycleClient,
  params: {
    orgId: string;
    matchId: string;
    contactEmail?: string | null;
    tokenId?: string | null;
    ttlMs?: number;
  },
): Promise<{ id: string; token: string }> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? MATCH_PROPOSAL_TOKEN_TTL_MS)).toISOString();
  const selectCols = "id, token, expires_at, used_at, response, contact_email";

  const updateContactEmail = async (id: string) => {
    if (!params.contactEmail) return;
    await client
      .from("match_proposal_tokens")
      .update({ contact_email: params.contactEmail })
      .eq("id", id)
      .eq("organization_id", params.orgId)
      .eq("match_id", params.matchId);
  };

  if (params.tokenId) {
    const { data: existing } = await client
      .from("match_proposal_tokens")
      .select(selectCols)
      .eq("id", params.tokenId)
      .eq("organization_id", params.orgId)
      .eq("match_id", params.matchId)
      .maybeSingle();

    if (
      existing &&
      !existing.used_at &&
      !existing.response &&
      new Date(existing.expires_at).getTime() > Date.now()
    ) {
      await updateContactEmail(existing.id);
      return { id: existing.id, token: existing.token };
    }
  }

  const { data: reusable } = await client
    .from("match_proposal_tokens")
    .select(selectCols)
    .eq("organization_id", params.orgId)
    .eq("match_id", params.matchId)
    .is("used_at", null)
    .is("response", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable) {
    await updateContactEmail(reusable.id);
    return { id: reusable.id, token: reusable.token };
  }

  const { data: created, error } = await client
    .from("match_proposal_tokens")
    .insert({
      match_id: params.matchId,
      organization_id: params.orgId,
      contact_email: params.contactEmail ?? null,
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();
  if (error || !created) throw new Error("Failed to create proposal token");
  return { id: created.id, token: created.token };
}

export async function recordMatchProposalTokenResponse(
  client: MatchLifecycleClient,
  input: {
    tokenId: string;
    response: string;
    consume: boolean;
  },
): Promise<{ accepted: boolean }> {
  const patch: Record<string, unknown> = { response: input.response };
  if (input.consume) patch.used_at = new Date().toISOString();

  const { data, error } = await client
    .from("match_proposal_tokens")
    .update(patch)
    .eq("id", input.tokenId)
    .is("used_at", null)
    .select("id");
  if (error) throw error;
  return { accepted: Array.isArray(data) && data.length > 0 };
}

export async function createMatchFollowUpTask(
  client: MatchLifecycleClient,
  input: {
    orgId: string;
    matchId: string;
    assignedTo?: string | null;
    title: string;
    description: string;
    priority?: "low" | "medium" | "high" | string;
    status?: "open" | "done" | string;
    category?: string;
  },
) {
  const { error } = await client.from("recruiter_tasks").insert({
    organization_id: input.orgId,
    assigned_to: input.assignedTo ?? null,
    title: input.title,
    description: input.description,
    priority: input.priority ?? "high",
    status: input.status ?? "open",
    category: input.category ?? "matching",
    related_entity_type: "match",
    related_entity_id: input.matchId,
  });
  if (error) throw error;
}
