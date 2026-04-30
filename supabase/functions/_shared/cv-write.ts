// Gedeelde candidates-update logica voor zowel VPS-callback als Cloud-pad.
// Dezelfde transform als analyze-cv-callback regels 67-91 hanteerde.

import type { CvAnalysisResult } from "./cv-prompt.ts";

// SupabaseClient zonder type-import om dependency-graaf klein te houden
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export async function writeCvAnalysisToCandidate(
  admin: SupabaseAdmin,
  candidateId: string,
  organizationId: string,
  analysis: CvAnalysisResult,
): Promise<void> {
  const hardSkills = analysis?.competenties?.hard_skills ?? [];
  const softSkills = analysis?.competenties?.soft_skills ?? [];
  const certifications = analysis?.competenties?.certificaten ?? [];
  const allSkills = [...new Set([...hardSkills, ...softSkills])].filter(Boolean);
  const targetFunctions = analysis?.doelgroep?.functies ?? [];

  const update: Record<string, unknown> = {
    ai_analysis: analysis,
    ai_analyzed_at: new Date().toISOString(),
    ai_status: "completed",
    ai_reliability_score: analysis?.samenvatting?.plaatsbaarheid_score ?? null,
    ai_function_group: analysis?.doelgroep?.functies?.[0] ?? null,
    ai_classification:
      analysis?.eigenschappen?.specialisatie === "specialist" ? "specialist" : "productie",
    ai_interview_questions: analysis?.plaatsingsadvies?.interviewvragen ?? [],
    ai_risk_factors: analysis?.plaatsingsadvies?.risicos ?? [],
    ai_summary: analysis?.samenvatting?.profiel ?? null,
    ai_target_functions: targetFunctions,
    ai_positive_signals: analysis?.samenvatting?.positieve_signalen ?? [],
  };

  if (allSkills.length > 0) update.skills = allSkills;
  if (certifications.length > 0) update.certifications = certifications;

  const { error } = await admin
    .from("candidates")
    .update(update)
    .eq("id", candidateId)
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Kon CV-analyse niet wegschrijven: ${error.message}`);
  }
}

export interface UsageLogEntry {
  organization_id: string;
  user_id: string | null;
  provider: "vps" | "cloud";
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cents: number;
  candidate_id: string | null;
  duration_ms: number | null;
}

export async function logAiUsage(admin: SupabaseAdmin, entry: UsageLogEntry): Promise<void> {
  // Silent-fail: usage-log mag de hoofdflow nooit breken
  try {
    await admin.from("ai_usage_log").insert({ feature: "cv_analysis", ...entry });
  } catch (e) {
    console.error("[cv-write] Kon ai_usage_log niet schrijven:", (e as Error).message);
  }
}
