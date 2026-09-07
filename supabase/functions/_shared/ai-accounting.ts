/** All paid AI HTTP requests pass here: reserve -> one provider request -> settle.
 * Settlement runs before callers parse generated JSON. Unknown outcomes keep their
 * reservation; a timeout or failed ledger write must never become a free retry.
 * Provider USD is an estimate at the recorded tariff, separate from customer credits.
 */
export interface AiAccountingContext {
  admin: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
  organizationId: string;
  userId: string | null;
  feature: string;
  candidateId?: string | null;
}
export type AiProvider = "gemini" | "anthropic" | "lovable" | "exa";
export interface MeteredAiRequest {
  provider: AiProvider;
  model: string;
  url: string;
  headers: HeadersInit;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}
export interface AiAccountingResult {
  requestId: string;
  costCents: number;
  balanceCents: number;
  inputTokens: number;
  outputTokens: number; // Includes thinking, where the provider bills it as output.
  thinkingTokens: number;
  providerCostUsd: number;
  providerAttempted: true;
}
export interface MeteredAiResponse extends AiAccountingResult { response: Response }
export class AiAccountingError extends Error {
  requestId?: string;
  costCents?: number;
  balanceCents?: number;
  providerAttempted = false;
  constructor(public code: string, message: string, public status = 503) {
    super(message);
    this.name = "AiAccountingError";
  }
}
export function attachAiAccounting(error: unknown, result: AiAccountingResult): Error & AiAccountingResult {
  // JSON.parse errors can quote a fragment of generated candidate information.
  const safeError = error instanceof SyntaxError ? new Error("AI gaf ongeldige JSON terug.")
    : error instanceof Error ? error : new Error("AI-verwerking is mislukt");
  return Object.assign(safeError, {
    requestId: result.requestId, costCents: result.costCents, balanceCents: result.balanceCents,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    thinkingTokens: result.thinkingTokens, providerCostUsd: result.providerCostUsd,
    providerAttempted: true as const,
  });
}

interface Pricing { input: number; output: number; cacheRead: number }
// USD per million tokens, standard synchronous tier, verified 2026-09-07.
// https://ai.google.dev/gemini-api/docs/pricing
// https://platform.claude.com/docs/en/about-claude/pricing
// https://docs.lovable.dev/features/ai (underlying provider pricing)
const GEMINI_PRICING: Record<string, Pricing> = {
  "gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: .15 },
  "gemini-3-flash-preview": { input: .5, output: 3, cacheRead: .05 },
  "gemini-3.1-flash-lite": { input: .25, output: 1.5, cacheRead: .025 },
  "gemini-2.5-flash": { input: .3, output: 2.5, cacheRead: .03 },
  "gemini-2.5-flash-lite": { input: .1, output: .4, cacheRead: .01 },
};
const ANTHROPIC_PRICING: Record<string, Pricing> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: .1 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: .1 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: .3 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheRead: .3 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: .3 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: .2 },
};
const PRICING_VERSION = "2026-09-07-standard-v1";
const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const tokens = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const usd = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function aiPricing(provider: AiProvider, model: string): Pricing {
  const pricing = provider === "gemini" ? GEMINI_PRICING[model]
    : provider === "lovable" && model.startsWith("google/") ? GEMINI_PRICING[model.slice(7)]
    : provider === "anthropic" ? ANTHROPIC_PRICING[model] : undefined;
  if (!pricing) throw new AiAccountingError("unsupported_ai_model", "Voor dit AI-model is geen gecontroleerd tarief ingesteld.", 400);
  return pricing;
}
// Existing credit contract: one customer euro-cent per USD cent, rounded up for
// nonzero calls. This is a credit tariff, NOT a USD/EUR currency conversion.
export function aiCreditCents(providerCostUsd: number): number {
  if (usd(providerCostUsd) === null) throw new Error("Ongeldige AI-kosten");
  return providerCostUsd === 0 ? 0 : Math.max(1, Math.ceil(providerCostUsd * 100 - 1e-10));
}

function validateRequest(request: MeteredAiRequest): void {
  const { provider, model, body } = request;
  const url = new URL(request.url);
  const expected = provider === "gemini"
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    : provider === "anthropic" ? "https://api.anthropic.com/v1/messages"
    : provider === "lovable" ? "https://ai.gateway.lovable.dev/v1/chat/completions"
    : "https://api.exa.ai/search";
  if (url.href !== expected || body.stream === true) {
    throw new AiAccountingError("unsupported_ai_request", "Dit AI-verzoek heeft geen ondersteunde kostenbewaking.", 400);
  }
  if (provider === "exa") {
    const count = body.numResults ?? 10;
    // Exa's ordinary search includes text/highlights. Deep/research and summaries
    // have different tariffs and must receive their own reservation policy first.
    if (model !== "exa-search" || !Number.isInteger(count) || Number(count) < 1 || Number(count) > 100
      || ![undefined, "auto", "neural", "fast"].includes(body.type as string)
      || object(body.contents).summary || object(body.contents).subpages || body.additionalQueries || body.subpages) {
      throw new AiAccountingError("unsupported_ai_request", "Voor deze Exa-zoekopties is geen kostenlimiet ingesteld.", 400);
    }
    return;
  }
  aiPricing(provider, model); // Unknown model must fail before any request.
  if (provider !== "gemini" && body.model !== model) {
    throw new AiAccountingError("ai_model_mismatch", "AI-model en kostenregistratie komen niet overeen.", 400);
  }
  const config = object(body.generationConfig);
  const outputLimit = tokens(provider === "gemini" ? config.maxOutputTokens : body.max_tokens ?? body.max_completion_tokens);
  if (!outputLimit || outputLimit > 65536 || (config.candidateCount !== undefined && config.candidateCount !== 1)) {
    throw new AiAccountingError("ai_output_limit_required", "Een geldige maximale AI-antwoordlengte is verplicht.", 400);
  }
  if (body.n !== undefined && body.n !== 1 || body.speed !== undefined) {
    throw new AiAccountingError("unsupported_ai_request", "Meerdere antwoorden en versnelde facturatie hebben een eigen kostenlimiet nodig.", 400);
  }
  if (body.cachedContent || body.service_tier && body.service_tier !== "auto" || body.serviceTier
    || object(config).responseModalities?.some((mode: string) => mode !== "TEXT")) {
    throw new AiAccountingError("unsupported_ai_request", "Deze AI-facturatievorm is nog niet ondersteund.", 400);
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.some((tool) => provider === "gemini"
    ? Object.keys(object(tool)).some((key) => key !== "functionDeclarations")
    : provider === "anthropic" ? object(tool).type && object(tool).type !== "custom" : object(tool).type !== "function")) {
    throw new AiAccountingError("unsupported_ai_tools", "Extra betaalde AI-tools hebben eerst een eigen kostenlimiet nodig.", 400);
  }
  // The byte bound below is text-only. Gemini image/PDF parts use its own tokenizer.
  if (provider !== "gemini") {
    const textContent = (content: unknown): boolean => typeof content === "string" || Array.isArray(content)
      && content.every((part) => object(part).type === "text" && typeof object(part).text === "string");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.every((message) => textContent(object(message).content))
      || body.system !== undefined && !textContent(body.system)) {
      throw new AiAccountingError("unsupported_ai_media", "Gebruik voor beeldinvoer de gecontroleerde Gemini-route.", 400);
    }
  }
  if (provider === "gemini") {
    const parts = [...(Array.isArray(body.contents) ? body.contents : []), object(body.systemInstruction)]
      .flatMap((content) => Array.isArray(object(content).parts) ? object(content).parts : []);
    if (parts.some((part) => object(part).fileData || (object(part).inlineData
      && !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].includes(object(object(part).inlineData).mimeType)))) {
      throw new AiAccountingError("unsupported_ai_media", "Alleen gecontroleerde afbeeldingen en PDF-bestanden zijn toegestaan.", 400);
    }
  }
}

async function reservationFor(request: MeteredAiRequest): Promise<{ cents: number; metadata: Record<string, unknown> }> {
  validateRequest(request);
  const { provider, model, body } = request;
  if (provider === "exa") {
    // https://exa.ai/docs/reference/pricing — /search, no summary/deep search.
    const maximumUsd = .007 + Math.max(0, Number(body.numResults ?? 10) - 10) * .001;
    return { cents: aiCreditCents(maximumUsd), metadata: { maximum_provider_cost_usd: maximumUsd, bound: "exa_search_results", pricing_version: PRICING_VERSION } };
  }
  const pricing = aiPricing(provider, model);
  const config = object(body.generationConfig);
  let inputBound = new TextEncoder().encode(JSON.stringify(body)).length + 8192;
  let bound = "utf8_bytes_plus_protocol";
  // Counting is non-billable and does not generate content. It includes system
  // instructions, schema and media; a counting failure stops the paid request.
  if (provider === "gemini" && JSON.stringify(body).includes('"inlineData"')) {
    let countResponse: Response;
    try {
      countResponse = await fetch(request.url.replace(":generateContent", ":countTokens"), {
        method: "POST", headers: request.headers,
        body: JSON.stringify({ generateContentRequest: { ...body, model: `models/${model}` } }),
        signal: request.signal ?? AbortSignal.timeout(30000),
      });
      const count = object(await countResponse.json());
      if (!countResponse.ok || tokens(count.totalTokens) === null) throw new Error("count failed");
      inputBound = Number(count.totalTokens) + 8192;
      bound = "gemini_count_tokens_plus_protocol";
    } catch {
      throw new AiAccountingError("ai_token_count_failed", "De bestandsgrootte kon niet betrouwbaar worden berekend; er is geen AI-analyse gestart.");
    }
  }
  const outputBound = Number(provider === "gemini" ? config.maxOutputTokens : body.max_tokens ?? body.max_completion_tokens);
  const thinking = object(config.thinkingConfig).thinkingBudget;
  // maxOutputTokens caps the entire Gemini generation. Add any explicit budget
  // conservatively as well; dynamic thinking remains inside maxOutputTokens.
  const thinkingBound = provider === "gemini" && tokens(thinking) !== null ? Number(thinking) : 0;
  // Anthropic cache writes can cost up to 2x input (one-hour TTL).
  const maximumUsd = (inputBound * pricing.input * (provider === "anthropic" ? 2 : 1)
    + (outputBound + thinkingBound) * pricing.output) / 1_000_000;
  return { cents: aiCreditCents(maximumUsd), metadata: {
    maximum_provider_cost_usd: maximumUsd, input_token_bound: inputBound,
    output_token_bound: outputBound + thinkingBound, bound, pricing_version: PRICING_VERSION,
    customer_credit_tariff: "usd_cent_parity_ceil", provider_cost_kind: "tariff_estimate",
  } };
}

interface Usage { inputTokens: number; outputTokens: number; thinkingTokens: number; providerCostUsd: number; metadata: Record<string, unknown> }
export function extractAiUsage(provider: AiProvider, model: string, data: unknown): Usage | null {
  const payload = object(data);
  if (provider === "exa") {
    const cost = usd(object(payload.costDollars).total);
    return cost === null ? null : { inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
      providerCostUsd: cost, metadata: { provider_cost_kind: "provider_reported", pricing_version: PRICING_VERSION } };
  }
  const pricing = aiPricing(provider, model);
  const usage = object(provider === "gemini" ? payload.usageMetadata : payload.usage);
  const input = tokens(provider === "gemini" ? usage.promptTokenCount : provider === "anthropic" ? usage.input_tokens : usage.prompt_tokens);
  const output = tokens(provider === "gemini" ? usage.candidatesTokenCount ?? (payload.promptFeedback?.blockReason ? 0 : undefined)
    : provider === "anthropic" ? usage.output_tokens : usage.completion_tokens);
  if (input === null || output === null) return null;
  const thinking = tokens(provider === "gemini" ? usage.thoughtsTokenCount ?? 0
    : provider === "lovable" ? object(usage.completion_tokens_details).reasoning_tokens ?? 0 : 0);
  if (thinking === null) return null;
  const cacheRead = tokens(provider === "gemini" ? usage.cachedContentTokenCount ?? 0
    : provider === "anthropic" ? usage.cache_read_input_tokens ?? 0
    : object(usage.prompt_tokens_details).cached_tokens ?? 0);
  if (cacheRead === null) return null;
  const cacheWrite = provider === "anthropic" ? tokens(usage.cache_creation_input_tokens ?? 0) : 0;
  if (cacheWrite === null) return null;
  const hourWrite = provider === "anthropic" ? tokens(object(usage.cache_creation).ephemeral_1h_input_tokens ?? 0) : 0;
  if (hourWrite === null || hourWrite > cacheWrite || provider !== "anthropic" && cacheRead > input) return null;
  const billedOutput = output + (provider === "gemini" ? thinking : 0); // OpenAI-compatible reasoning already included.
  const nonCachedInput = provider === "anthropic" ? input : input - cacheRead;
  const totalInput = provider === "anthropic" ? input + cacheRead + cacheWrite : input;
  const providerCostUsd = (nonCachedInput * pricing.input + cacheRead * pricing.cacheRead
    + (cacheWrite - hourWrite) * pricing.input * 1.25 + hourWrite * pricing.input * 2
    + billedOutput * pricing.output) / 1_000_000;
  return { inputTokens: totalInput, outputTokens: billedOutput, thinkingTokens: thinking, providerCostUsd,
    metadata: { cache_read_input_tokens: cacheRead, cache_write_input_tokens: cacheWrite,
      cache_write_1h_input_tokens: hourWrite, pricing_version: PRICING_VERSION, provider_cost_kind: "tariff_estimate" } };
}

async function settle(context: AiAccountingContext, payload: Record<string, unknown>): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data, error } = await context.admin.rpc("finalize_ai_usage", payload);
      if (!error && data?.ok) return data;
    } catch { /* Retry this immutable settlement only; never replay provider HTTP. */ }
  }
  // Safe recovery evidence: only IDs, token totals and costs, never prompts,
  // generated output, keys or a provider error body containing customer data.
  console.error("ai_settlement_pending", JSON.stringify(payload));
  const error = new AiAccountingError("ai_accounting_pending", "AI-verbruik wacht op registratie. De reservering blijft staan; start deze opdracht niet opnieuw.");
  error.requestId = String(payload.p_request_id);
  error.providerAttempted = true;
  throw error;
}

export async function meteredAiFetch(context: AiAccountingContext, request: MeteredAiRequest): Promise<MeteredAiResponse> {
  if (!context?.admin || !context.organizationId || !context.feature || context.userId === undefined) {
    throw new AiAccountingError("ai_accounting_context_required", "AI-verwerking mist de organisatiecontext.", 400);
  }
  const reservation = await reservationFor(request);
  const requestId = crypto.randomUUID();
  let reserved: Record<string, any>;
  try {
    const result = await context.admin.rpc("reserve_ai_usage", {
      p_request_id: requestId, p_org_id: context.organizationId, p_user_id: context.userId,
      p_feature: context.feature, p_provider: request.provider, p_model: request.model,
      p_reserved_cents: reservation.cents, p_candidate_id: context.candidateId ?? null,
      p_metadata: reservation.metadata,
    });
    if (result.error || !result.data) throw new Error("reservation unavailable");
    reserved = result.data;
  } catch {
    const error = new AiAccountingError("ai_budget_unavailable", "Het AI-budget kon niet worden gereserveerd. Er is geen AI-opdracht gestart.");
    error.requestId = requestId;
    throw error;
  }
  if (!reserved.ok || reserved.status !== "reserved" || reserved.already_exists) {
    const error = new AiAccountingError(reserved.already_exists ? "ai_request_already_exists" : "insufficient_credits",
      reserved.already_exists ? "Deze AI-opdracht is al geregistreerd en wordt niet opnieuw verstuurd." : "Onvoldoende beschikbaar AI-tegoed voor deze opdracht.",
      reserved.already_exists ? 409 : 402);
    error.requestId = requestId;
    error.balanceCents = reserved.balance_cents;
    throw error;
  }
  const started = Date.now();
  let response: Response;
  let raw: string;
  try {
    response = await fetch(request.url, { method: "POST", headers: request.headers,
      body: JSON.stringify(request.body), signal: request.signal ?? AbortSignal.timeout(120000) });
    raw = await response.text();
  } catch {
    await settle(context, { p_request_id: requestId, p_status: "unknown", p_error_code: "provider_transport_unknown",
      p_duration_ms: Date.now() - started, p_metadata: { pricing_version: PRICING_VERSION } });
    const error = new AiAccountingError("ai_provider_outcome_unknown", "De AI-provider heeft geen volledig antwoord gegeven. Het gereserveerde tegoed blijft staan voor controle.");
    error.requestId = requestId;
    error.providerAttempted = true;
    throw error;
  }
  let data: Record<string, any> = {};
  try { data = object(JSON.parse(raw)); } catch { /* Missing/invalid usage is unknown, not free. */ }
  const usage = extractAiUsage(request.provider, request.model, data);
  const providerRequestId = typeof data.responseId === "string" ? data.responseId : typeof data.id === "string" ? data.id
    : typeof data.requestId === "string" ? data.requestId : response.headers.get("request-id") ?? response.headers.get("x-request-id");
  // Explicit input/auth/rate rejections have not generated content. Server errors
  // without usage are ambiguous and retain the reservation for reconciliation.
  const knownRejection = !response.ok && ([400, 401, 403, 404, 413, 422, 429].includes(response.status)
    || request.provider === "lovable" && response.status === 402);
  if (!usage && !knownRejection) {
    await settle(context, { p_request_id: requestId, p_status: "unknown", p_provider_request_id: providerRequestId,
      p_error_code: "provider_usage_missing", p_duration_ms: Date.now() - started,
      p_metadata: { http_status: response.status, pricing_version: PRICING_VERSION } });
    const error = new AiAccountingError("ai_usage_missing", "De AI-provider gaf geen controleerbaar verbruik terug. De reservering blijft staan voor controle.");
    error.requestId = requestId;
    error.providerAttempted = true;
    throw error;
  }
  const actual = usage ?? { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, providerCostUsd: 0, metadata: {} };
  const settlement = await settle(context, {
    p_request_id: requestId, p_status: response.ok && !data.promptFeedback?.blockReason ? "succeeded" : "failed",
    p_input_tokens: actual.inputTokens, p_output_tokens: actual.outputTokens, p_thinking_tokens: actual.thinkingTokens,
    p_provider_cost_usd: actual.providerCostUsd, p_charged_cents: aiCreditCents(actual.providerCostUsd),
    p_provider_request_id: providerRequestId, p_error_code: response.ok ? data.promptFeedback?.blockReason ? "provider_blocked" : null : `provider_http_${response.status}`,
    p_duration_ms: Date.now() - started, p_metadata: { ...actual.metadata, http_status: response.status },
  });
  return { response: new Response(raw, { status: response.status, statusText: response.statusText, headers: response.headers }),
    requestId, costCents: settlement.charged_cents, balanceCents: settlement.balance_cents,
    inputTokens: actual.inputTokens, outputTokens: actual.outputTokens, thinkingTokens: actual.thinkingTokens,
    providerCostUsd: actual.providerCostUsd, providerAttempted: true };
}
