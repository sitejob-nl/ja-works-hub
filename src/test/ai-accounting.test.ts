import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiCreditCents, aiPricing, attachAiAccounting, extractAiUsage, meteredAiFetch,
  type AiAccountingContext, type MeteredAiRequest,
} from "../../supabase/functions/_shared/ai-accounting";
import { analyzeWithGemini, GEMINI_DEFAULT_MODEL } from "../../supabase/functions/_shared/gemini-cv";
import { analyzeWithAnthropic } from "../../supabase/functions/_shared/anthropic-cv";
import { VACANCY_DEFAULT_MODEL } from "../../supabase/functions/_shared/vacancy-generate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const request = (overrides: Partial<MeteredAiRequest> = {}): MeteredAiRequest => ({
  provider: "gemini", model: "gemini-3.5-flash",
  url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  headers: { "x-goog-api-key": "test-only" },
  body: { contents: [{ parts: [{ text: "A short anonymized dossier" }] }],
    generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 512 } } },
  ...overrides,
});
const usageResponse = (overrides = {}) => ({
  responseId: "provider-request-123",
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50 },
  candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }], ...overrides,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function ledger() {
  const events: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    events.push(name);
    return { error: null, data: name === "reserve_ai_usage"
      ? { ok: true, status: "reserved", already_exists: false, balance_cents: 5000 }
      : { ok: true, charged_cents: args.p_charged_cents ?? 0, balance_cents: 4999 } };
  });
  const context: AiAccountingContext = {
    admin: { rpc }, organizationId: "org-1", userId: "user-1", feature: "cv_analysis", candidateId: "candidate-1",
  };
  return { context, rpc, events };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("AI cost extraction", () => {
  it("counts Gemini thought tokens once and keeps USD separate from rounded credits", () => {
    const usage = extractAiUsage("gemini", "gemini-3.5-flash", usageResponse());
    expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 150, thinkingTokens: 50, providerCostUsd: .00285 });
    expect(aiCreditCents(usage!.providerCostUsd)).toBe(1);
    expect(aiCreditCents(0)).toBe(0);
    expect(aiCreditCents(.01)).toBe(1);
  });
  it("does not conflate missing or invalid usage with free usage", () => {
    expect(extractAiUsage("gemini", "gemini-3.5-flash", {})).toBeNull();
    expect(extractAiUsage("gemini", "gemini-3.5-flash", { usageMetadata: { promptTokenCount: -1, candidatesTokenCount: 4 } })).toBeNull();
    expect(extractAiUsage("gemini", "gemini-3.5-flash", { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } })?.providerCostUsd).toBe(0);
  });
  it("prices Anthropic cache creation and reads separately, including one-hour writes", () => {
    const usage = extractAiUsage("anthropic", "claude-haiku-4-5", { usage: {
      input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 3000, cache_creation: { ephemeral_1h_input_tokens: 1000 },
    } });
    expect(usage).toMatchObject({ inputTokens: 6000, outputTokens: 100, providerCostUsd: .00505 });
  });
  it("does not double bill OpenAI-compatible reasoning included in completion_tokens", () => {
    const usage = extractAiUsage("lovable", "google/gemini-3-flash-preview", { usage: {
      prompt_tokens: 1000, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 150 },
    } });
    expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 200, thinkingTokens: 150, providerCostUsd: .0011 });
  });
  it("takes actual Exa costDollars instead of a fixed guessed search charge", () => {
    expect(extractAiUsage("exa", "exa-search", { costDollars: { total: .047 } })?.providerCostUsd).toBe(.047);
    expect(extractAiUsage("exa", "exa-search", {})).toBeNull();
  });
  it("rejects unknown pricing models rather than charging a fallback tariff", () => {
    expect(() => aiPricing("gemini", "gemini-unpriced-pro")).toThrow(/tarief/);
  });
  it("has verified tariffs for actual helper and endpoint model defaults", () => {
    expect(aiPricing("gemini", GEMINI_DEFAULT_MODEL)).toBeDefined();
    expect(aiPricing("anthropic", VACANCY_DEFAULT_MODEL)).toMatchObject({ input: 2, output: 10 });
    for (const path of ["_shared/anthropic-cv.ts", "rerank-matches/index.ts", "generate-call-questions/index.ts"]) {
      const source = readFileSync(resolve("supabase/functions", path), "utf8");
      const defaults = [...source.matchAll(/const [A-Z_]*MODEL = "((?:gemini|claude)-[^"]+)"/g)];
      expect(defaults.length).toBeGreaterThan(0);
      for (const [, model] of defaults) {
        expect(aiPricing(model.startsWith("claude-") ? "anthropic" : "gemini", model)).toBeDefined();
      }
    }
  });
  it("does not expose generated personal data in JSON parse errors", () => {
    const error = attachAiAccounting(new SyntaxError('Unexpected token: "sensitive candidate data"'), {
      requestId: "request-1", costCents: 1, balanceCents: 4999, inputTokens: 100, outputTokens: 10,
      thinkingTokens: 0, providerCostUsd: .001, providerAttempted: true,
    });
    expect(error.message).toBe("AI gaf ongeldige JSON terug.");
    expect(error).toMatchObject({ requestId: "request-1", costCents: 1 });
  });
});

describe("AI reservation and settlement", () => {
  it("reserves before the only paid call, settles before exposing generated content", async () => {
    const { context, rpc, events } = ledger();
    const fetchMock = vi.fn(async () => { events.push("provider"); return json(usageResponse()); });
    vi.stubGlobal("fetch", fetchMock);
    const result = await meteredAiFetch(context, request());
    expect(events).toEqual(["reserve_ai_usage", "provider", "finalize_ai_usage"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_org_id: "org-1", p_user_id: "user-1", p_candidate_id: "candidate-1" });
    expect(Number(rpc.mock.calls[0][1].p_reserved_cents)).toBeGreaterThanOrEqual(3);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "succeeded", p_input_tokens: 1000,
      p_output_tokens: 150, p_thinking_tokens: 50, p_provider_cost_usd: .00285,
      p_provider_request_id: "provider-request-123", p_charged_cents: 1 });
    expect(result).toMatchObject({ costCents: 1, balanceCents: 4999, providerAttempted: true });
    expect(await result.response.json()).toMatchObject(usageResponse());
  });
  it("refuses generation when concurrent reservations leave insufficient available balance", async () => {
    const { context, rpc } = ledger();
    rpc.mockResolvedValueOnce({ error: null, data: { ok: false, status: "blocked", already_exists: false, balance_cents: 5 } });
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    await expect(meteredAiFetch(context, request())).rejects.toMatchObject({ code: "insufficient_credits", status: 402, providerAttempted: false });
    expect(provider).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not send if reservation acknowledgement is missing or already exists", async () => {
    const { context, rpc } = ledger();
    const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    rpc.mockRejectedValueOnce(new Error("database network interruption"));
    await expect(meteredAiFetch(context, request())).rejects.toMatchObject({ code: "ai_budget_unavailable", providerAttempted: false });
    rpc.mockResolvedValueOnce({ error: null, data: { ok: true, status: "reserved", already_exists: true, balance_cents: 5000 } });
    await expect(meteredAiFetch(context, request())).rejects.toMatchObject({ code: "ai_request_already_exists", status: 409 });
    expect(provider).not.toHaveBeenCalled();
  });
  it("leaves an unknown network outcome reserved instead of releasing or retrying it", async () => {
    const { context, rpc } = ledger();
    const provider = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", provider);
    await expect(meteredAiFetch(context, request())).rejects.toMatchObject({ code: "ai_provider_outcome_unknown", providerAttempted: true });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "unknown", p_error_code: "provider_transport_unknown" });
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_charged_cents");
  });
  it.each([200, 500, 503])("retains the reservation when HTTP %s has no usage", async (status) => {
    const { context, rpc } = ledger();
    vi.stubGlobal("fetch", vi.fn(async () => json({}, status)));
    await expect(meteredAiFetch(context, request())).rejects.toMatchObject({ code: "ai_usage_missing" });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "unknown", p_error_code: "provider_usage_missing" });
  });
  it("records an explicit rate rejection at zero cost", async () => {
    const { context, rpc } = ledger();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "limited" }, 429)));
    const result = await meteredAiFetch(context, request());
    expect(result.response.status).toBe(429);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "failed", p_charged_cents: 0, p_provider_cost_usd: 0 });
  });
  it("records Lovable's payment rejection at zero instead of reserving indefinitely", async () => {
    const { context, rpc } = ledger();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "payment required" }, 402)));
    const result = await meteredAiFetch(context, request({ provider: "lovable", model: "google/gemini-3-flash-preview",
      url: "https://ai.gateway.lovable.dev/v1/chat/completions", body: { model: "google/gemini-3-flash-preview", messages: [{ role: "user", content: "text" }], max_tokens: 100 } }));
    expect(result.response.status).toBe(402);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "failed", p_charged_cents: 0 });
  });
  it("settles valid usage even when provider blocks the generated answer", async () => {
    const { context, rpc } = ledger();
    vi.stubGlobal("fetch", vi.fn(async () => json(usageResponse({ promptFeedback: { blockReason: "SAFETY" } }))));
    await expect(analyzeWithGemini("text", "test-only", undefined, undefined, context)).rejects.toMatchObject({ requestId: expect.any(String), costCents: 1, providerAttempted: true });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "failed", p_charged_cents: 1 });
  });
  it("retains billed usage and error metadata when generated JSON cannot be parsed", async () => {
    const { context, rpc } = ledger();
    vi.stubGlobal("fetch", vi.fn(async () => json(usageResponse({ candidates: [{ content: { parts: [{ text: '{"invalid' }] }, finishReason: "MAX_TOKENS" }] }))));
    await expect(analyzeWithGemini("text", "test-only", undefined, undefined, context)).rejects.toMatchObject({ costCents: 1, balanceCents: 4999, providerAttempted: true });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "succeeded", p_charged_cents: 1 });
  });
  it("retains Anthropic usage when the expected tool result is missing", async () => {
    const { context, rpc } = ledger();
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "msg-test", content: [], usage: { input_tokens: 100, output_tokens: 50 } })));
    await expect(analyzeWithAnthropic("text", "test-only", undefined, context)).rejects.toMatchObject({ costCents: 1, requestId: expect.any(String) });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_status: "succeeded", p_provider_request_id: "msg-test" });
  });
  it("retries an identical settlement without repeating paid generation", async () => {
    const { context, rpc } = ledger();
    const original = rpc.getMockImplementation()!;
    let settlements = 0;
    rpc.mockImplementation(async (name, args) => {
      if (name === "finalize_ai_usage" && ++settlements < 3) throw new Error("temporary network failure");
      return original(name, args);
    });
    const provider = vi.fn(async () => json(usageResponse())); vi.stubGlobal("fetch", provider);
    await meteredAiFetch(context, request());
    expect(provider).toHaveBeenCalledTimes(1);
    const finalizations = rpc.mock.calls.filter(([name]) => name === "finalize_ai_usage");
    expect(finalizations).toHaveLength(3);
    expect(finalizations[0][1]).toEqual(finalizations[1][1]);
    expect(finalizations[1][1]).toEqual(finalizations[2][1]);
  });
  it("fails visibly with safe recovery data if all settlement writes fail", async () => {
    const { context, rpc } = ledger();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) => name === "finalize_ai_usage" ? Promise.reject(new Error("DB unavailable")) : original(name, args));
    const provider = vi.fn(async () => json(usageResponse())); vi.stubGlobal("fetch", provider);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(meteredAiFetch(context, request())).rejects.toMatchObject({ code: "ai_accounting_pending", providerAttempted: true });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toContain('"p_provider_cost_usd":0.00285');
    expect(log.mock.calls[0][1]).not.toContain("dossier");
    expect(log.mock.calls[0][1]).not.toContain("test-only");
  });
  it("counts image/PDF input including system/schema before reserving", async () => {
    const { context, rpc, events } = ledger();
    const provider = vi.fn(async (url: string, _init: RequestInit) => {
      events.push(url.endsWith(":countTokens") ? "tokenizer" : "provider");
      return json(url.endsWith(":countTokens") ? { totalTokens: 12000 } : usageResponse());
    }); vi.stubGlobal("fetch", provider);
    await meteredAiFetch(context, request({ body: { systemInstruction: { parts: [{ text: "read hours" }] },
      contents: [{ parts: [{ inlineData: { mimeType: "application/pdf", data: "smallBase64" } }] }],
      generationConfig: { maxOutputTokens: 1024, responseSchema: { type: "object" } } } }));
    expect(events).toEqual(["tokenizer", "reserve_ai_usage", "provider", "finalize_ai_usage"]);
    expect(rpc.mock.calls[0][1].p_metadata).toMatchObject({ input_token_bound: 20192, bound: "gemini_count_tokens_plus_protocol" });
    expect(JSON.parse(provider.mock.calls[0][1].body as string)).toMatchObject({ generateContentRequest: {
      model: "models/gemini-3.5-flash", systemInstruction: { parts: [{ text: "read hours" }] },
      generationConfig: { responseSchema: { type: "object" } },
    } });
  });
  it("stops before reserve/generation if the media tokenizer fails", async () => {
    const { context, rpc } = ledger();
    const provider = vi.fn(async () => json({}, 503)); vi.stubGlobal("fetch", provider);
    await expect(meteredAiFetch(context, request({ body: { contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data: "test" } }] }], generationConfig: { maxOutputTokens: 1024 } } })))
      .rejects.toMatchObject({ code: "ai_token_count_failed", providerAttempted: false });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { model: "gemini-unpriced" },
    { body: { contents: [], generationConfig: {} } },
    { body: { contents: [], generationConfig: { maxOutputTokens: 1024, candidateCount: 3 } } },
    { body: { contents: [], generationConfig: { maxOutputTokens: 1024 }, tools: [{ googleSearch: {} }] } },
  ])("fails closed for unsupported request configuration %j", async (overrides) => {
    const { context, rpc } = ledger(); const provider = vi.fn(); vi.stubGlobal("fetch", provider);
    await expect(meteredAiFetch(context, request(overrides))).rejects.toBeInstanceOf(Error);
    expect(provider).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("reserves Exa's full requested result bound and settles actual response cost", async () => {
    const { context, rpc } = ledger(); vi.stubGlobal("fetch", vi.fn(async () => json({ costDollars: { total: .007 }, results: [] })));
    const result = await meteredAiFetch(context, request({ provider: "exa", model: "exa-search", url: "https://api.exa.ai/search", body: { query: "role", type: "neural", numResults: 100, contents: { text: true } } }));
    expect(rpc.mock.calls[0][1].p_reserved_cents).toBe(10);
    expect(result.costCents).toBe(1);
  });
});
