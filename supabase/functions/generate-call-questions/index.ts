// Genereert AI vakinhoudelijke belvragen voor een kandidaat × vacature (de "AI"-tak van de
// hybride belscreening). Iedere provider-aanroep reserveert en verantwoordt kosten
// via het gedeelde AI-grootboek, ook bij onbruikbare modeloutput.
import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { generateCallQuestions } from "../_shared/gemini-call-questions.ts";
import { AiAccountingError } from "../_shared/ai-accounting.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

// Vast, geprijsd model → de pricing-tabel (geminiPricingForModel) matcht exact wat we sturen,
// zodat de afgeschreven kosten kloppen. 2.5-flash = de live gekozen JA Werkt-modelklasse.
const MODEL = "gemini-2.5-flash";

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

    const result = await generateCallQuestions(contextText, apiKey, MODEL, {
      admin, organizationId: orgId, userId: auth.userId, feature: "call_questions", candidateId: candidate_id,
    });
    if (result.questions.length === 0) return json({ error: "AI gaf geen vragen terug", request_id: result.requestId, cost_cents: result.costCents, balance_cents: result.balanceCents }, 502);

    return json({ questions: result.questions, cost_cents: result.costCents, balance_cents: result.balanceCents, request_id: result.requestId });
  } catch (e) {
    if (e instanceof AiAccountingError) return json({ error: e.message, code: e.code, request_id: e.requestId, cost_cents: e.costCents, balance_cents: e.balanceCents }, e.status);
    return json({ error: e instanceof Error ? e.message : "Onbekende fout" }, 500);
  }
});
