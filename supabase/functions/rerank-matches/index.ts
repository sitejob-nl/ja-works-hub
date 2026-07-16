// rerank-matches — STAGE-2 van de matching-funnel.
//
// Stage-1 (rank-candidates) levert goedkoop & regelgebaseerd een shortlist uit de hele pool. Hier
// herrangschikken we de meegegeven TOP-N met Gemini: de VOLLEDIGE vacaturetekst tegen een compact
// kandidaatdossier → fit-score (0-100) + verdict + onderbouwing + sterke/zorgpunten. Zo telt de
// nuance uit de vacatureomschrijving mee die de skill-match niet kan uitdrukken.
//
// Kosten: 1 Gemini-call per (nieuwe) kandidaat. Default-model is gemini-3.1-flash-lite: het goedkoopste
// model dat nog beschikbaar is op deze API-key (de hele 2.5-serie geeft sinds ~juli 2026 een 404
// "no longer available to new users") en 6× goedkoper per token dan 3.5-flash. Door de Math.max(1,…)-
// vloer is de reële prijs voor dit payloadformaat sowieso ~1 ct/kandidaat; het goedkopere tarief telt
// pas als de vacaturetekst groot wordt. Wil je meer nuance op rijke vacatures: zet 'm op gemini-3.5-flash
// (kost gelijk 1 ct tot de payload de vloer overschrijdt). Resultaat wordt gecached in match_rerank_cache
// per (vacature × kandidaat); reruns zijn gratis zolang de input (vacaturetekst + dossier) niet wijzigt
// (input_hash). Credits via consume_ai_credits.
//
// Auth: ingelogde org-gebruiker (RLS scoped op eigen org). verify_jwt=false in config.toml; we
// valideren de Bearer-token zelf. Cache-writes + creditafschrijving gaan via de service-role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rerankCandidateFit } from "../_shared/gemini-rerank.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_CANDIDATES = 30;
const CONCURRENCY = 4;
const PREFLIGHT_RESERVATION_CENTS = 2;
const SOFT_DEADLINE_MS = 110_000;
const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

interface GeminiPricing {
  inputCentsPerMtok: number;
  outputCentsPerMtok: number;
}

const GEMINI_PRICING: Record<string, GeminiPricing> = {
  "gemini-3.5-flash": { inputCentsPerMtok: 150, outputCentsPerMtok: 900 },
  "gemini-3-flash-preview": { inputCentsPerMtok: 50, outputCentsPerMtok: 300 },
  "gemini-3.1-flash-lite": { inputCentsPerMtok: 25, outputCentsPerMtok: 150 },
  "gemini-2.5-flash": { inputCentsPerMtok: 30, outputCentsPerMtok: 250 },
  "gemini-2.5-flash-lite": { inputCentsPerMtok: 10, outputCentsPerMtok: 40 },
};

function geminiPricingForModel(model: string): GeminiPricing {
  return GEMINI_PRICING[model] ?? GEMINI_PRICING[GEMINI_DEFAULT_MODEL];
}

function calculateCostCents(
  inputTokens: number,
  outputTokens: number,
  pricingInputCentsPerMtok: number,
  pricingOutputCentsPerMtok: number,
): number {
  const inCost = (inputTokens / 1_000_000) * pricingInputCentsPerMtok;
  const outCost = (outputTokens / 1_000_000) * pricingOutputCentsPerMtok;
  return Math.max(1, Math.ceil(inCost + outCost));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
function buildVacancyText(v: any): string {
  const parts: string[] = [];
  if (v.title) parts.push(`Functie: ${v.title}`);
  if (v.location) parts.push(`Locatie: ${v.location}`);
  if (Array.isArray(v.required_skills) && v.required_skills.length) parts.push(`Vereiste skills: ${v.required_skills.join(", ")}`);
  if (Array.isArray(v.required_certifications) && v.required_certifications.length) parts.push(`Vereiste certificaten: ${v.required_certifications.join(", ")}`);
  if (v.requires_drivers_license) parts.push("Rijbewijs vereist: ja");
  if (v.description) parts.push(`\nOmschrijving:\n${v.description}`);
  return parts.join("\n");
}

// deno-lint-ignore no-explicit-any
function buildDossier(c: any): string {
  const lines: string[] = [];
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  if (name) lines.push(`Naam: ${name}`);
  if (c.ai_function_group) lines.push(`Functiegroep: ${c.ai_function_group}`);
  if (c.ai_classification) lines.push(`Classificatie: ${c.ai_classification}`);
  if (Array.isArray(c.ai_target_functions) && c.ai_target_functions.length) lines.push(`Doelfuncties: ${c.ai_target_functions.join(", ")}`);
  if (Array.isArray(c.skills) && c.skills.length) lines.push(`Vaardigheden: ${c.skills.join(", ")}`);
  if (Array.isArray(c.certifications) && c.certifications.length) lines.push(`Certificaten: ${c.certifications.join(", ")}`);
  if (Array.isArray(c.languages) && c.languages.length) lines.push(`Talen: ${c.languages.join(", ")}`);
  if (c.address_city) lines.push(`Woonplaats: ${c.address_city}`);
  if (c.availability_notes) lines.push(`Beschikbaarheid: ${c.availability_notes}`);
  // Samenvatting + sterke/zwakke punten uit de CV-analyse — de vakinhoudelijke nuance die de
  // tags (skills/certs) niet vangen. Eerst de slanke first-class kolommen (cv-write synct ze uit
  // ai_analysis), met de jsonb-samenvatting als fallback voor oudere/VPS-analyses.
  const ai = c.ai_analysis;
  const nestedSummary = ai && typeof ai === "object"
    ? (ai.samenvatting?.profiel || ai.samenvatting || ai.summary || ai.dossier || ai.toelichting)
    : null;
  const summary = (typeof c.ai_summary === "string" && c.ai_summary.trim()) ? c.ai_summary : nestedSummary;
  if (typeof summary === "string" && summary.trim()) lines.push(`AI-samenvatting: ${summary.trim().slice(0, 1200)}`);

  const strList = (v: unknown, n: number) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, n) : [];
  const positives = strList(c.ai_positive_signals, 6);
  if (positives.length) lines.push(`Sterke punten (AI-analyse): ${positives.join("; ")}`);
  const concerns = [...strList(c.ai_red_flags, 6), ...strList(c.ai_risk_factors, 4)];
  if (concerns.length) lines.push(`Aandachtspunten/risico's (AI-analyse): ${concerns.join("; ")}`);
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);
    const userId = user.id;

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY ontbreekt" }, 500);
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const vacancyId = typeof body.vacancy_id === "string" ? body.vacancy_id : null;
    const candidateIds: string[] = Array.isArray(body.candidate_ids)
      ? Array.from(new Set(body.candidate_ids.filter((x): x is string => typeof x === "string"))).slice(0, MAX_CANDIDATES)
      : [];
    const force = body.force === true;
    const model = (typeof body.model === "string" && body.model) || Deno.env.get("GEMINI_MODEL") || GEMINI_DEFAULT_MODEL;
    if (!vacancyId) return json({ error: "vacancy_id required" }, 400);
    if (candidateIds.length === 0) return json({ error: "candidate_ids required" }, 400);

    // Vacature via RLS (eigen org) → impliciete autorisatie.
    const { data: vacancy, error: vacErr } = await userClient
      .from("vacancies")
      .select("id, organization_id, title, description, location, required_skills, required_certifications, requires_drivers_license")
      .eq("id", vacancyId)
      .single();
    if (vacErr || !vacancy) return json({ error: "Vacancy not found" }, 404);
    const orgId = vacancy.organization_id;
    const vacancyText = buildVacancyText(vacancy);

    // Kandidaten via RLS (eigen org).
    const { data: cands, error: candErr } = await userClient
      .from("candidates")
      .select("id, first_name, last_name, skills, certifications, languages, ai_function_group, ai_target_functions, ai_classification, availability_notes, address_city, ai_analysis, ai_summary, ai_positive_signals, ai_red_flags, ai_risk_factors")
      .eq("organization_id", orgId)
      .in("id", candidateIds);
    if (candErr) return json({ error: "Kon kandidaten niet laden" }, 500);
    const candidates = cands ?? [];
    if (candidates.length === 0) return json({ error: "Geen toegankelijke kandidaten" }, 404);

    const pricing = geminiPricingForModel(model);

    // Bestaande cache in één keer ophalen.
    const { data: cacheRows } = await admin
      .from("match_rerank_cache")
      .select("candidate_id, input_hash, fit_score, verdict, reasoning, strengths, concerns")
      .eq("vacancy_id", vacancyId)
      .in("candidate_id", candidateIds);
    // deno-lint-ignore no-explicit-any
    const cacheByCand = new Map<string, any>();
    for (const r of cacheRows ?? []) cacheByCand.set(r.candidate_id, r);

    const started = Date.now();
    let costTotal = 0, geminiCalls = 0, cachedCount = 0, failed = 0;
    let stopped = false;
    // deno-lint-ignore no-explicit-any
    const results: any[] = [];

    // deno-lint-ignore no-explicit-any
    async function processOne(c: any): Promise<void> {
      const dossier = buildDossier(c);
      const inputHash = await sha256Hex(`${model}\n${vacancyText}\n${dossier}`);
      const cached = cacheByCand.get(c.id);
      if (!force && cached && cached.input_hash === inputHash) {
        cachedCount++;
        results.push({
          candidate_id: c.id, first_name: c.first_name, last_name: c.last_name,
          fit_score: cached.fit_score, verdict: cached.verdict, reasoning: cached.reasoning,
          strengths: cached.strengths ?? [], concerns: cached.concerns ?? [], cached: true,
        });
        return;
      }

      const { data: credits } = await admin.from("organization_credits").select("balance_cents").eq("organization_id", orgId).single();
      if ((credits?.balance_cents ?? 0) < PREFLIGHT_RESERVATION_CENTS) { stopped = true; return; }

      let r;
      try {
        r = await rerankCandidateFit(vacancyText, dossier, GEMINI_API_KEY!, model);
      } catch (e) {
        failed++;
        results.push({ candidate_id: c.id, first_name: c.first_name, last_name: c.last_name, error: (e as Error).message.slice(0, 200) });
        return;
      }

      const costCents = calculateCostCents(r.inputTokens, r.outputTokens, pricing.inputCentsPerMtok, pricing.outputCentsPerMtok);
      const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", { p_org_id: orgId, p_amount_cents: costCents });
      const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
      if (consumeErr || !consume?.ok) { stopped = true; return; }
      costTotal += costCents; geminiCalls++;

      await admin.from("match_rerank_cache").upsert({
        organization_id: orgId, vacancy_id: vacancyId, candidate_id: c.id, input_hash: inputHash,
        fit_score: r.fitScore, verdict: r.verdict, reasoning: r.reasoning, strengths: r.strengths, concerns: r.concerns,
        model: r.model, updated_at: new Date().toISOString(),
      }, { onConflict: "vacancy_id,candidate_id" });

      try {
        await admin.from("ai_usage_log").insert({
          feature: "match_rerank", organization_id: orgId, user_id: userId, provider: "gemini", model: r.model,
          input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_cents: costCents, candidate_id: c.id, duration_ms: r.durationMs,
        });
      } catch (_e) { /* usage-log mag de flow niet breken */ }

      results.push({
        candidate_id: c.id, first_name: c.first_name, last_name: c.last_name,
        fit_score: r.fitScore, verdict: r.verdict, reasoning: r.reasoning,
        strengths: r.strengths, concerns: r.concerns, cached: false,
      });
    }

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      if (Date.now() - started > SOFT_DEADLINE_MS) { stopped = true; break; }
      await Promise.all(candidates.slice(i, i + CONCURRENCY).map(processOne));
      if (stopped) break;
    }

    results.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
    return json({
      vacancy_id: vacancyId, model,
      requested: candidateIds.length, scored: results.length,
      gemini_calls: geminiCalls, cached: cachedCount, failed,
      cost_cents: costTotal, stopped, results,
    });
  } catch (err) {
    console.error("rerank-matches error:", err);
    return json({ error: "Interne fout bij rerank" }, 500);
  }
});
