// Gedeelde candidates-update logica voor zowel VPS-callback als Cloud-pad.
// Dezelfde transform als analyze-cv-callback regels 67-91 hanteerde.

import type { CvAnalysisResult } from "./cv-prompt.ts";

// SupabaseClient zonder type-import om dependency-graaf klein te houden
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

function formatLanguageLabel(lang: {
  taal?: string;
  niveau?: string;
  bewijsstatus?: string;
}): string | null {
  const taal = lang?.taal?.trim();
  if (!taal) return null;
  const parts = [taal];
  if (lang.niveau && lang.niveau !== "onbekend") parts.push(lang.niveau);
  if (lang.bewijsstatus && lang.bewijsstatus !== "bewezen") {
    parts.push(lang.bewijsstatus.replace(/_/g, " "));
  }
  return parts.join(" - ");
}

export async function writeCvAnalysisToCandidate(
  admin: SupabaseAdmin,
  candidateId: string,
  organizationId: string,
  analysis: CvAnalysisResult,
): Promise<void> {
  const hardSkills = analysis?.competenties?.hard_skills ?? [];
  const softSkills = analysis?.competenties?.soft_skills ?? [];
  const certifications = (analysis?.competenties?.certificaten ?? [])
    .map((cert) => typeof cert === "string" ? cert : cert?.naam)
    .filter(Boolean);
  const languages = (analysis?.competenties?.talen ?? [])
    .map(formatLanguageLabel)
    .filter(Boolean);
  const allSkills = [...new Set([...hardSkills, ...softSkills])].filter(Boolean);
  const targetFunctions = analysis?.doelgroep?.functies ?? [];
  // ai_stability heeft een DB-CHECK op {jobhopper, gemiddeld, loyaal}. Het v2-schema
  // levert geen stabiliteits-enum meer, dus leiden we 'm af uit het gemiddelde
  // dienstverband (<12 mnd = jobhopper, 12-24 = gemiddeld, >24 = loyaal). Bij onbekend: null.
  // (werkhistorie.patroon — oplopend/stabiel/dalend/wisselend — blijft in ai_analysis bewaard.)
  const avgTenureMonths = analysis?.eigenschappen?.gemiddelde_dienstverband_maanden;
  const stability = typeof avgTenureMonths === "number" && avgTenureMonths > 0
    ? (avgTenureMonths < 12 ? "jobhopper" : avgTenureMonths <= 24 ? "gemiddeld" : "loyaal")
    : null;
  const contraIndications = analysis?.plaatsingsadvies?.contra_indicaties ?? [];
  const sourceRisks = (analysis?.plaatsingsadvies?.bronverwijzingen ?? [])
    .filter((item) => item?.type === "risico" || item?.type === "contra_indicatie")
    .map((item) => `${item.bron}: ${item.signaal}`)
    .filter(Boolean);
  const reliabilityWarnings = typeof analysis?.dossier?.betrouwbaarheid === "number" && analysis.dossier.betrouwbaarheid <= 4
    ? [`Lage dossierbetrouwbaarheid (${analysis.dossier.betrouwbaarheid}/10): ${analysis.dossier.toelichting ?? "handmatige controle nodig"}`]
    : [];
  const manualReview = analysis?.plaatsingsadvies?.manual_review_required
    ? ["Handmatige review vereist volgens AI-analyse"]
    : [];
  const unknownFieldQuestions = (analysis?.datakwaliteit?.onbekend ?? [])
    .map((item) => item?.vervolgvraag)
    .filter(Boolean);
  const redFlags = [
    ...(analysis?.werkhistorie?.gaten ?? [])
      .filter((gap) => (gap.duur_maanden ?? 0) >= 3)
      .map((gap) => `Gat in CV: ${gap.periode} (${gap.duur_maanden} maanden)`),
    ...(analysis?.plaatsingsadvies?.risicos ?? []),
    ...contraIndications,
    ...sourceRisks,
    ...reliabilityWarnings,
    ...manualReview,
  ];
  const interviewQuestions = [
    ...(analysis?.plaatsingsadvies?.interviewvragen ?? []),
    ...unknownFieldQuestions,
  ];

  const update: Record<string, unknown> = {
    ai_analysis: analysis,
    ai_analyzed_at: new Date().toISOString(),
    ai_status: "completed",
    ai_reliability_score: analysis?.samenvatting?.plaatsbaarheid_score ?? null,
    ai_function_group: analysis?.doelgroep?.functies?.[0] ?? null,
    ai_classification:
      analysis?.eigenschappen?.specialisatie === "specialist" ? "specialist" : "productie",
    ai_interview_questions: [...new Set(interviewQuestions)].slice(0, 16),
    ai_risk_factors: analysis?.plaatsingsadvies?.risicos ?? [],
    ai_summary: analysis?.samenvatting?.profiel ?? null,
    ai_target_functions: targetFunctions,
    ai_positive_signals: analysis?.samenvatting?.positieve_signalen ?? [],
    ai_red_flags: [...new Set(redFlags)].slice(0, 12),
    ai_stability: stability,
    ai_languages: analysis?.competenties?.talen ?? [],
  };

  if (allSkills.length > 0) update.skills = allSkills;
  if (certifications.length > 0) update.certifications = certifications;
  if (languages.length > 0) update.languages = languages;

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
  provider: "vps" | "cloud" | "gemini";
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
