import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCallQuestions } from "../../supabase/functions/_shared/gemini-call-questions";
import { extractCvProfile } from "../../supabase/functions/_shared/cv-extract";
import { generateVacancyContent } from "../../supabase/functions/_shared/vacancy-generate";
import { type AiAccountingContext, AiAccountingError } from "../../supabase/functions/_shared/ai-accounting";

const geminiModel = "gemini-2.5-flash";
const helpers = [
  { name: "call questions", run: (context: AiAccountingContext) => generateCallQuestions("Vereist: lassen", "fake", geminiModel, context), provider: "gemini" },
  { name: "CV field extraction", run: (context: AiAccountingContext) => extractCvProfile("Een ervaren lasser met relevante diploma's en jaren ervaring.", "fake", { model: geminiModel }, context), provider: "gemini" },
  { name: "vacancy generation", run: (context: AiAccountingContext) => generateVacancyContent({ functie: "Lasser" }, "fake", { model: "claude-sonnet-5" }, context), provider: "anthropic" },
];

function setup(options: { blocked?: boolean; invalidContent?: boolean; failedSettlement?: boolean } = {}) {
  const events: string[] = [];
  const rpc = vi.fn(async (name: string, values: Record<string, unknown>) => {
    events.push(name);
    if (name === "reserve_ai_usage") return { data: options.blocked ? { ok: false, balance_cents: 0 } : { ok: true, status: "reserved" }, error: null };
    if (options.failedSettlement) return { data: null, error: { message: "temporarily unavailable" } };
    return { data: { ok: true, charged_cents: values.p_charged_cents, balance_cents: 4980 }, error: null };
  });
  const network = vi.fn(async (url: string, init: RequestInit) => {
    events.push("provider");
    const request = JSON.parse(init.body as string);
    const data = url.includes("anthropic") ? {
      model: request.model, content: options.invalidContent ? [] : [{ type: "tool_use", name: request.tools[0].name, input: { seo_title: "Lasser gezocht" } }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 150, cache_creation_input_tokens: 10 },
    } : {
      candidates: [{ content: { parts: [{ text: options.invalidContent ? "{invalid" : JSON.stringify({ questions: ["Welke lasprocessen beheers je?"], first_name: "Test" }) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 20 },
    };
    return Response.json(data);
  });
  vi.stubGlobal("fetch", network);
  return { events, rpc, network, context: { admin: { rpc }, organizationId: "org-1", userId: "user-1", feature: "test", candidateId: null } };
}

afterEach(() => vi.unstubAllGlobals());

describe("modern domain helpers preserve the accounting transaction", () => {
  it.each(helpers)("$name reserves before HTTP and returns the settled usage", async ({ run, provider }) => {
    const h = setup();
    const result = await run(h.context);
    expect(h.events).toEqual(["reserve_ai_usage", "provider", "finalize_ai_usage"]);
    expect(h.network).toHaveBeenCalledOnce();
    expect(result.requestId).toBeTruthy();
    expect(result.costCents).toBeGreaterThan(0);
    expect(result.balanceCents).toBe(4980);
    expect(result.inputTokens).toBe(provider === "anthropic" ? 260 : 100);
    expect(result.outputTokens).toBe(provider === "anthropic" ? 50 : 70);
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_org_id: "org-1", p_user_id: "user-1", p_provider: provider, p_feature: "test" });
  });

  it.each(helpers)("$name does not call the provider when credit reservation fails", async ({ run }) => {
    const h = setup({ blocked: true });
    await expect(run(h.context)).rejects.toMatchObject({ status: 402, code: "insufficient_credits", providerAttempted: false });
    expect(h.network).not.toHaveBeenCalled();
    expect(h.events).toEqual(["reserve_ai_usage"]);
  });

  it.each(helpers)("$name preserves paid usage when domain output cannot be parsed", async ({ run }) => {
    const h = setup({ invalidContent: true });
    await expect(run(h.context)).rejects.toMatchObject({ requestId: expect.any(String), costCents: expect.any(Number), providerAttempted: true });
    expect(h.events).toEqual(["reserve_ai_usage", "provider", "finalize_ai_usage"]);
    expect(h.network).toHaveBeenCalledOnce();
  });

  it.each(helpers)("$name retries settlement, never the provider, after a database failure", async ({ run }) => {
    const h = setup({ failedSettlement: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(run(h.context)).rejects.toBeInstanceOf(AiAccountingError);
    expect(h.events).toEqual(["reserve_ai_usage", "provider", "finalize_ai_usage", "finalize_ai_usage", "finalize_ai_usage"]);
    expect(h.network).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
