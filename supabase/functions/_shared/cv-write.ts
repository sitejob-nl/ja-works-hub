// Gedeelde candidates-update logica voor zowel VPS-callback als Cloud-pad.
// Dezelfde transform als analyze-cv-callback regels 67-91 hanteerde.

import type { CvAnalysisResult } from "./cv-prompt.ts";

// SupabaseClient zonder type-import om dependency-graaf klein te houden
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

// Normaliseert tekst voor letterlijke-bewijs-verificatie: case-, accent- en
// leesteken-agnostisch, zodat een bewijscitaat ook matcht op kleine vormverschillen.
function normalizeForMatch(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// hard_skills mag plain strings bevatten (legacy / VPS-Qwen) óf {vaardigheid,bron,bewijs}
// (het geverifieerde Gemini/Cloud-pad). Grounding-filter tegen hallucinaties:
// - met dossierText: behoud een vaardigheid alleen als het bewijsfragment LETTERLIJK in
//   het dossier voorkomt (taal-onafhankelijk — het citaat komt uit de brontekst zelf).
// - zonder dossierText of bij string-items: behoud zoals aangeleverd (back-compat, geen regressie).
// Levert altijd een platte string[] op, zodat ai_analysis.competenties.hard_skills en
// candidate.skills consistent string[] blijven (bestaande rijen + UI + matching).
export function resolveHardSkills(
  raw: unknown,
  dossierText?: string,
): { terms: string[]; dropped: string[] } {
  const items = Array.isArray(raw) ? raw : [];
  const normalizedDossier = dossierText ? normalizeForMatch(dossierText) : null;
  const terms: string[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) terms.push(t);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    // deno-lint-ignore no-explicit-any
    const obj = item as any;
    const term = String(obj.vaardigheid ?? "").trim();
    if (!term) continue;
    if (!normalizedDossier) {
      terms.push(term); // niet te verifiëren → behoud
      continue;
    }
    const bewijs = normalizeForMatch(obj.bewijs ?? "");
    // Bewijs moet niet-triviaal zijn (>=4 tekens) én letterlijk in het dossier voorkomen.
    if (bewijs.length >= 4 && normalizedDossier.includes(bewijs)) {
      terms.push(term);
    } else {
      dropped.push(term);
    }
  }
  return { terms: [...new Set(terms)], dropped };
}

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

// Eindjaar van een (rommelige, meertalige) periode-string: lopende rol → huidig jaar,
// anders het hoogste 4-cijferige jaartal in de string. Geen dag/maand-parsing (te ambigu).
function extractRoleEndYear(periode?: string | null): number | null {
  if (!periode) return null;
  if (/\b(heden|present|current|today|now|nu)\b/i.test(periode)) return new Date().getFullYear();
  const years = (periode.match(/(?:19|20)\d{2}/g) ?? []).map(Number);
  return years.length ? Math.max(...years) : null;
}

export async function writeCvAnalysisToCandidate(
  admin: SupabaseAdmin,
  candidateId: string,
  organizationId: string,
  analysis: CvAnalysisResult,
  opts: { dossierText?: string } = {},
): Promise<void> {
  // Grounding-filter: ongegronde (gehallucineerde) hard skills eruit, en collapse terug
  // naar string[] zodat downstream (UI, sync-trigger, matching) ongewijzigd blijft.
  const { terms: hardSkills, dropped: droppedHardSkills } = resolveHardSkills(
    analysis?.competenties?.hard_skills,
    opts.dossierText,
  );
  if (droppedHardSkills.length > 0) {
    console.warn(
      `[cv-write] ${droppedHardSkills.length} ongegronde hard skill(s) verwijderd voor kandidaat ${candidateId}: ${droppedHardSkills.join(", ")}`,
    );
  }
  if (analysis?.competenties) {
    // deno-lint-ignore no-explicit-any
    (analysis.competenties as any).hard_skills = hardSkills;
  }
  const softSkills = (analysis?.competenties?.soft_skills ?? [])
    .map((s) => typeof s === "string" ? s : String((s as { vaardigheid?: string })?.vaardigheid ?? ""))
    .filter(Boolean);
  const certifications = (analysis?.competenties?.certificaten ?? [])
    .map((cert) => typeof cert === "string" ? cert : cert?.naam)
    .filter(Boolean);
  const languages = (analysis?.competenties?.talen ?? [])
    .map(formatLanguageLabel)
    .filter(Boolean);
  const allSkills = [...new Set([...hardSkills, ...softSkills])].filter(Boolean);
  const targetFunctions = analysis?.doelgroep?.functies ?? [];
  // Rijbewijsklassen (B/BE/C/CE/D/...) als first-class kolom — genormaliseerd (trim + uppercase),
  // zodat de matcher een C/CE/D-rijbewijs als chauffeurs-functiesignaal kan meewegen (MG1).
  const licenseCategories = [...new Set(
    (analysis?.mobiliteit?.rijbewijs_types ?? [])
      .map((t) => typeof t === "string" ? t.trim().toUpperCase() : "")
      .filter(Boolean),
  )];
  // MG1 GAP2: meest recente rol + eindjaar uit werkhistorie[0] (nieuwste eerst). Alleen het
  // jaartal (robuust), of het huidige jaar bij een lopende rol ("heden"/"present"). De matcher
  // beloont een RECENTE relevante rol additief (nooit een straf op oude ervaring).
  const recentRole = analysis?.werkhistorie?.werkgevers?.[0];
  const mostRecentRole = recentRole?.functie?.trim() || null;
  const mostRecentRoleYear = extractRoleEndYear(recentRole?.periode);
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
  // Niet clobberen met een lege lijst (rijbewijs vaak 'onbekend' op het CV): alleen schrijven
  // als de analyse daadwerkelijk klassen vond — net als skills/certs/talen hierboven.
  if (licenseCategories.length > 0) update.drivers_license_categories = licenseCategories;
  // Alleen schrijven als er werkhistorie is (niet clobberen bij een analyse zonder werkgevers).
  if (recentRole) {
    update.most_recent_role = mostRecentRole;
    update.most_recent_role_year = mostRecentRoleYear;
  }

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
