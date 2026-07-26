// AI-vacaturetekstgenerator (synchroon, Anthropic Claude Sonnet standaard).
//
// Input = de 16 recruitervragen uit de masterprompt (frontend vult ze voor uit de
// vacature + opdrachtgever). Output = complete SEO-/marketingset (website-tekst,
// titelvarianten, meta description, slug, FAQ, JobPosting JSON-LD, social, preview,
// CTA-varianten, matchingprofiel, zoekwoorden) → opgeslagen in vacancy_seo_content.
//
// Auth: interne gebruiker met vacancies.edit (admin/intercedent). Verrijking gebeurt
// via de service-role admin-client; RLS wordt daarnaast defensief gecheckt op org.
// Billing: preflight saldo → LLM → consume_ai_credits → upsert → ai_usage_log.

import {
  createAdminClient,
  jsonResponse,
  requireRolePermission,
} from "../_shared/auth.ts";
import { sanitizeOrgPrompt, VACANCY_PROMPT_MAX_LENGTH } from "../_shared/sanitize-org-prompt.ts";
import { stripMarkdownInline } from "../_shared/rich-text.ts";
import {
  anthropicPricingForModel,
  calculateCostCents,
  generateVacancyContent,
  VACANCY_DEFAULT_MODEL,
  type VacancyAnswers,
} from "../_shared/vacancy-generate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sonnet is duurder dan Gemini/Haiku; reserveer ruimer bij de preflight (idem cloud-pad).
const PREFLIGHT_RESERVATION_CENTS = 25;

function json(body: unknown, status = 200) {
  return jsonResponse(body, status, corsHeaders);
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// Platte-tekstvelden: markdown-resten eruit vóór het opslaan. Het model krijgt de instructie
// dat alleen body_markdown markdown mag zijn, maar zet er alsnog **vet** of een #-kop in —
// en dat komt letterlijk in beeld bij kandidaat en opdrachtgever (meeting 27-07).
function asPlainText(v: unknown): string | null {
  return asString(stripMarkdownInline(v));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // --- Auth: interne gebruiker met vacancies.edit ---
  const auth = await requireRolePermission(req, "vacancies.edit", corsHeaders);
  if (auth instanceof Response) return auth;
  const orgId = auth.organizationId;
  const userId = auth.userId;

  // --- Body ---
  let body: { vacancy_id?: string; answers?: VacancyAnswers; provider?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ongeldige JSON" }, 400);
  }

  const vacancyId = asString(body.vacancy_id);
  if (!vacancyId) return json({ error: "vacancy_id verplicht" }, 400);
  const answers = (body.answers && typeof body.answers === "object" ? body.answers : {}) as VacancyAnswers;
  if (!answers || Object.keys(answers).length === 0) {
    return json({ error: "answers verplicht" }, 400);
  }

  const admin = createAdminClient();

  // --- Vacature ophalen (defensieve org-check) ---
  const { data: vac, error: vacErr } = await admin
    .from("vacancies")
    .select("id, organization_id, title")
    .eq("id", vacancyId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (vacErr) return json({ error: `Vacature laden mislukt: ${vacErr.message}` }, 500);
  if (!vac) return json({ error: "Vacature niet gevonden of geen toegang" }, 404);

  // --- Org-settings: masterprompt + model/provider-override ---
  const { data: org } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const orgSettings = (org?.settings as Record<string, unknown> | null) ?? {};

  const rawPrompt = typeof orgSettings.vacancy_generation_prompt === "string"
    ? orgSettings.vacancy_generation_prompt
    : "";
  const sanitized = sanitizeOrgPrompt(rawPrompt, VACANCY_PROMPT_MAX_LENGTH);
  if (sanitized.removed > 0 || sanitized.truncated) {
    console.warn(
      `[generate-vacancy] Org-masterprompt gesanitized voor org=${orgId}: removed=${sanitized.removed} truncated=${sanitized.truncated}`,
    );
  }

  const model = asString(body.model)
    ?? (typeof orgSettings.vacancy_ai_model === "string" ? orgSettings.vacancy_ai_model : null)
    ?? VACANCY_DEFAULT_MODEL;

  // Alleen de Anthropic-provider is geïmplementeerd (Sonnet standaard, Haiku via model).
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI-provider niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)" }, 500);

  // --- Credits preflight (niet markeren → retry na bijladen) ---
  const { data: credits } = await admin
    .from("organization_credits")
    .select("balance_cents")
    .eq("organization_id", orgId)
    .maybeSingle();
  const balance = credits?.balance_cents ?? 0;
  if (balance < PREFLIGHT_RESERVATION_CENTS) {
    return json({ error: "Saldo onvoldoende voor AI-generatie", balance_cents: balance, required_cents: PREFLIGHT_RESERVATION_CENTS }, 402);
  }

  // --- LLM ---
  let result;
  try {
    result = await generateVacancyContent(answers, apiKey, {
      masterprompt: sanitized.text || undefined,
      model,
    });
  } catch (e) {
    return json({ error: `AI-generatie mislukt: ${(e as Error).message.slice(0, 300)}` }, 502);
  }

  // --- Kosten + afschrijven ---
  const pricing = anthropicPricingForModel(result.model);
  const costCents = calculateCostCents(result.inputTokens, result.outputTokens, pricing.inputCentsPerMtok, pricing.outputCentsPerMtok);
  const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", {
    p_org_id: orgId,
    p_amount_cents: costCents,
  });
  if (consumeErr) return json({ error: `Saldo-afschrijving mislukt: ${consumeErr.message}` }, 500);
  const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
  if (!consume?.ok) {
    return json({ error: "Saldo onvoldoende — generatie niet opgeslagen, geen kosten in rekening gebracht", balance_cents: consume?.new_balance_cents ?? 0, required_cents: costCents }, 402);
  }

  // --- Output splitsen: eerste-klas tekstvelden vs content jsonb ---
  const c = result.content;
  const contentJson = {
    title_variants: c.title_variants ?? [],
    faq: c.faq ?? [],
    job_posting_jsonld: c.job_posting_jsonld ?? {},
    cta_variants: c.cta_variants ?? [],
    matching_profile: c.matching_profile ?? {},
    keywords: c.keywords ?? [],
    seo_reasoning: c.seo_reasoning ?? {},
  };

  const generatedAt = new Date().toISOString();
  const row = {
    vacancy_id: vacancyId,
    organization_id: orgId,
    seo_title: asPlainText(c.seo_title),
    slug: asString(c.slug),
    meta_description: asPlainText(c.meta_description),
    // Enige veld waar markdown wél hoort: dit is de websitetekst met H2's en bullets.
    body_markdown: asString(c.body_markdown),
    vacaturebank_variant: asPlainText(c.vacaturebank_variant),
    social_text: asPlainText(c.social_text),
    preview_text: asPlainText(c.preview_text),
    content: contentJson,
    input_answers: answers,
    provider: "anthropic",
    model: result.model,
    generated_at: generatedAt,
    generated_by: userId,
  };

  const { error: upsertErr } = await admin
    .from("vacancy_seo_content")
    .upsert(row, { onConflict: "vacancy_id" });
  if (upsertErr) return json({ error: `Opslaan mislukt: ${upsertErr.message}` }, 500);

  // De kandidaatomschrijving hoort op de vacature zelf, niet in de SEO-tabel: het portaal en
  // het matchvoorstel lezen `vacancies`, niet `vacancy_seo_content`. Best-effort — een
  // mislukte update mag de zojuist afgeschreven generatie niet ongeldig maken.
  const candidateDescription = asPlainText(c.candidate_description);
  if (candidateDescription) {
    const { error: descErr } = await admin
      .from("vacancies")
      .update({ candidate_description: candidateDescription })
      .eq("id", vacancyId)
      .eq("organization_id", orgId);
    if (descErr) console.error("candidate_description opslaan mislukt:", descErr.message);
  }

  // --- Usage-log (best-effort) ---
  try {
    await admin.from("ai_usage_log").insert({
      feature: "vacancy_generate",
      organization_id: orgId,
      user_id: userId,
      provider: "cloud",
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_cents: costCents,
      candidate_id: null,
      duration_ms: result.durationMs,
    });
  } catch (_e) {
    // usage-log mag de flow nooit breken
  }

  return json({
    success: true,
    result: {
      status: "ok",
      cost_cents: costCents,
      new_balance_cents: consume.new_balance_cents,
      generated_at: generatedAt,
      model: result.model,
      content: c,
    },
  });
});
