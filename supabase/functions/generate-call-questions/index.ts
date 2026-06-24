// Genereert AI vakinhoudelijke belvragen voor een kandidaat × vacature (de "AI"-tak van de
// hybride belscreening). Kosten worden ACCURAAT verrekend: echte Gemini-tokenusage →
// calculateCostCents → consume_ai_credits (atomair, van het org-budget) → ai_usage_log.
import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { calculateCostCents } from "../_shared/anthropic-cv.ts";
import { geminiPricingForModel } from "../_shared/gemini-cv.ts";
import { generateCallQuestions } from "../_shared/gemini-call-questions.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

// Vast, geprijsd model → de pricing-tabel (geminiPricingForModel) matcht exact wat we sturen,
// zodat de afgeschreven kosten kloppen. 2.5-flash = de live gekozen JA Werkt-modelklasse.
const MODEL = "gemini-2.5-flash";
const PREFLIGHT_RESERVATION_CENTS = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const orgId = auth.organizationId;

    const { candidate_id, vacancy_id } = await req.json().catch(() => ({}));
    if (!candidate_id || !vacancy_id) return json({ error: "candidate_id en vacancy_id zijn vereist" }, 400);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "AI niet geconfigureerd (GEMINI_API_KEY ontbreekt)" }, 503);

    const admin = createAdminClient();

    // Preflight: genoeg saldo om te starten? (definitieve afschrijving gebeurt na de call op echte tokens)
    const { data: credits } = await admin
      .from("organization_credits")
      .select("balance_cents")
      .eq("organization_id", orgId)
      .single();
    const balance = credits?.balance_cents ?? 0;
    if (balance < PREFLIGHT_RESERVATION_CENTS) {
      return json({ error: "Saldo onvoldoende voor AI-vragen", balance_cents: balance }, 402);
    }

    // Vacature + match + kandidaat (org-scoped). We sturen GEEN PII naar Gemini — alleen vak-content + gaten.
    const { data: vacancy } = await admin
      .from("vacancies")
      .select("id, title, description, required_skills, required_certifications")
      .eq("id", vacancy_id).eq("organization_id", orgId).single();
    if (!vacancy) return json({ error: "Vacature niet gevonden" }, 404);

    const { data: candidate } = await admin
      .from("candidates")
      .select("skills, certifications, most_recent_role, ai_function_group")
      .eq("id", candidate_id).eq("organization_id", orgId).single();
    if (!candidate) return json({ error: "Kandidaat niet gevonden" }, 404);

    const { data: match } = await admin
      .from("matches")
      .select("match_breakdown")
      .eq("candidate_id", candidate_id).eq("vacancy_id", vacancy_id).eq("organization_id", orgId)
      .maybeSingle();
    const missing = Array.isArray((match?.match_breakdown as any)?.missing) ? (match!.match_breakdown as any).missing as string[] : [];

    const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : []);
    const contextText = [
      `Functie: ${vacancy.title}`,
      arr(vacancy.required_skills).length ? `Vereiste vaardigheden: ${arr(vacancy.required_skills).join(", ")}` : null,
      arr(vacancy.required_certifications).length ? `Vereiste certificaten: ${arr(vacancy.required_certifications).join(", ")}` : null,
      vacancy.description ? `Functieomschrijving: ${String(vacancy.description).slice(0, 4000)}` : null,
      arr(candidate.skills).length ? `Vaardigheden volgens kandidaat: ${arr(candidate.skills).join(", ")}` : null,
      candidate.most_recent_role ? `Meest recente rol: ${candidate.most_recent_role}` : null,
      candidate.ai_function_group ? `Functiegroep (AI): ${candidate.ai_function_group}` : null,
      missing.length ? `Aandachtspunten/gaten uit de match (verifiëren): ${missing.join("; ")}` : null,
    ].filter(Boolean).join("\n");

    const result = await generateCallQuestions(contextText, apiKey, MODEL);
    if (result.questions.length === 0) return json({ error: "AI gaf geen vragen terug" }, 502);

    // Kosten exact uit de echte tokenusage van dit model.
    const pricing = geminiPricingForModel(MODEL);
    const costCents = calculateCostCents(result.inputTokens, result.outputTokens, pricing.inputCentsPerMtok, pricing.outputCentsPerMtok);

    // Atomair afschrijven van het org-budget.
    const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", { p_org_id: orgId, p_amount_cents: costCents });
    if (consumeErr) return json({ error: "Saldo-afschrijving mislukt" }, 500);
    const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
    if (!consume?.ok) {
      return json({ error: "Saldo onvoldoende — geen kosten in rekening gebracht", balance_cents: consume?.new_balance_cents ?? 0 }, 402);
    }

    // Verbruik loggen (silent-fail, mag de flow nooit breken).
    try {
      await admin.from("ai_usage_log").insert({
        feature: "call_questions",
        organization_id: orgId,
        user_id: auth.userId,
        provider: "gemini",
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_cents: costCents,
        candidate_id,
        duration_ms: result.durationMs,
      });
    } catch (e) {
      console.error("[generate-call-questions] ai_usage_log faalde:", (e as Error).message);
    }

    return json({ questions: result.questions, cost_cents: costCents, balance_cents: consume.new_balance_cents });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Onbekende fout" }, 500);
  }
});
