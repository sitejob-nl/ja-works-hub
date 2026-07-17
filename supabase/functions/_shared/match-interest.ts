// Gedeelde kandidaat-interesse-transitie: "ja" → afspraak_voorgesteld, "nee" → afgewezen.
// Gebruikt door whatsapp-webhook (ja/nee-knoppen) én candidate-interest (interesse-links
// uit de kandidaat-voorstelmail), zodat beide kanalen exact dezelfde fase-logica delen.
//
// Daarnaast: token-helpers voor match_candidate_tokens (kandidaat-voorstelmail A2) —
// spiegelt ensureMatchProposalToken/recordMatchProposalTokenResponse, maar op de aparte
// kandidaat-tokentabel (gescheiden audience: een kandidaat-token mag nooit de
// klant-reactiepagina openen).

import {
  advanceMatchStatus,
  MATCH_PROPOSAL_TOKEN_TTL_MS,
  type MatchLifecycleClient,
} from "./match-lifecycle.ts";

export type InterestChannel = "whatsapp" | "email";

// Niet terugzetten als de match al verder of terminaal is.
const INTEREST_LOCKED_STATUSES = ["geaccepteerd", "geplaatst", "afgewezen"];

export async function applyMatchInterest(
  client: MatchLifecycleClient,
  params: { orgId: string; matchId: string; isYes: boolean; channel: InterestChannel },
): Promise<{ applied: boolean; newStatus: string | null }> {
  const { data: match } = await client
    .from("matches")
    .select("id, status, match_score, match_breakdown")
    .eq("id", params.matchId)
    .eq("organization_id", params.orgId)
    .maybeSingle();
  if (!match || INTEREST_LOCKED_STATUSES.includes(match.status)) {
    return { applied: false, newStatus: null };
  }
  const channelLabel = params.channel === "whatsapp" ? "via WhatsApp" : "via e-mail";
  const newStatus = params.isYes ? "afspraak_voorgesteld" : "afgewezen";
  await advanceMatchStatus(client, {
    orgId: params.orgId,
    matchId: params.matchId,
    toStatus: newStatus,
    currentMatch: { ...match, organization_id: params.orgId },
    requireReason: false,
    eventMode: "always",
    notes: params.isYes
      ? `Kandidaat reageerde 'Ja, interesse' ${channelLabel} — afspraakvoorstel opvolgen`
      : `Kandidaat reageerde 'Nee, bedankt' ${channelLabel}`,
  });
  return { applied: true, newStatus };
}

// ---------------------------------------------------------------------------
// Kandidaat-tokens (match_candidate_tokens) — zelfde semantiek als de
// opdrachtgever-varianten in match-lifecycle.ts.
// ---------------------------------------------------------------------------

export async function ensureMatchCandidateToken(
  client: MatchLifecycleClient,
  params: {
    orgId: string;
    matchId: string;
    candidateEmail?: string | null;
    ttlMs?: number;
  },
): Promise<{ id: string; token: string }> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? MATCH_PROPOSAL_TOKEN_TTL_MS)).toISOString();

  // Hergebruik een nog geldig, ongebruikt token voor deze match (idempotent preview→send).
  const { data: reusable } = await client
    .from("match_candidate_tokens")
    .select("id, token")
    .eq("organization_id", params.orgId)
    .eq("match_id", params.matchId)
    .is("used_at", null)
    .is("response", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reusable) {
    if (params.candidateEmail) {
      await client
        .from("match_candidate_tokens")
        .update({ candidate_email: params.candidateEmail })
        .eq("id", reusable.id)
        .eq("organization_id", params.orgId);
    }
    return { id: reusable.id, token: reusable.token };
  }

  const { data: created, error } = await client
    .from("match_candidate_tokens")
    .insert({
      match_id: params.matchId,
      organization_id: params.orgId,
      candidate_email: params.candidateEmail ?? null,
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();
  if (error || !created) throw new Error("Failed to create candidate token");
  return { id: created.id, token: created.token };
}

// Race-safe single-use: alleen de eerste respons wint (update … is('used_at', null)).
export async function recordMatchCandidateTokenResponse(
  client: MatchLifecycleClient,
  input: { tokenId: string; response: string },
): Promise<{ accepted: boolean }> {
  const { data, error } = await client
    .from("match_candidate_tokens")
    .update({ response: input.response, used_at: new Date().toISOString() })
    .eq("id", input.tokenId)
    .is("used_at", null)
    .select("id");
  if (error) throw error;
  return { accepted: Array.isArray(data) && data.length > 0 };
}
