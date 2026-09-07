import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const orgId = "trusted-org";
const userId = "trusted-user";
const names = ["analyze-cv", "analyze-cv-batch", "extract-cv-profile", "enrich-vacancies", "generate-call-questions", "generate-vacancy", "rerank-matches"] as const;
type Name = typeof names[number];
class AccountingFailure extends Error {
  providerAttempted = false;
  constructor(public code = "insufficient_credits", public status = 402) { super("Onvoldoende AI-tegoed"); }
}

// Run actual edge handler source with local import doubles. Network is forbidden.
function harness(name: Name, options: { blocked?: boolean; paidParseFailure?: boolean; pendingSettlement?: boolean; deadlineAfterCall?: boolean; denied?: boolean } = {}) {
  const mutations: Array<{ table: string; values: Record<string, unknown> }> = [];
  const rows: Record<string, any[]> = {
    organizations: [{ id: orgId, settings: {} }],
    profiles: [{ id: userId, organization_id: orgId, role: "admin", is_active: true }],
    skills: [{ organization_id: orgId, name: "Lassen", is_active: true }],
    candidates: Array.from({ length: 6 }, (_, i) => ({ id: `c-${i}`, organization_id: orgId, ai_status: null, first_name: "Test", skills: ["Lassen"], notes: "Ervaren lasser met bruikbare werkervaring." })),
    vacancies: Array.from({ length: 6 }, (_, i) => ({ id: `v-${i}`, organization_id: orgId, title: "Lasser", description: "Lassen en controleren", status: "open", skills_enriched_at: null })),
    matches: [], match_rerank_cache: [], vacancy_seo_content: [],
  };
  let clock = 0;
  const rpc = vi.fn(async (method: string) => {
    if (method === "is_superadmin") return { data: false, error: null };
    throw new Error(`Unexpected legacy accounting RPC: ${method}`);
  });
  const admin = {
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table: string) {
      let filter = (_row: any) => true;
      let single = false;
      let limit = Infinity;
      let mutation: { values: Record<string, any>; upsert: boolean } | undefined;
      const where = (predicate: (row: any) => boolean) => { const previous = filter; filter = (row) => previous(row) && predicate(row); return builder; };
      const builder: Record<string, any> = {
        select: () => builder,
        eq: (key: string, value: unknown) => where((row) => row[key] === value),
        in: (key: string, values: unknown[]) => where((row) => values.includes(row[key])),
        is: (key: string, value: unknown) => where((row) => (row[key] ?? null) === value),
        not: (key: string, _operator: string, value: unknown) => where((row) => (row[key] ?? null) !== value),
        or: (value: string) => value.startsWith("ai_status.")
          ? where((row) => row.ai_status === null || row.ai_status === "idle" || value.includes("eq.failed") && row.ai_status === "failed")
          : builder,
        order: () => builder,
        limit: (value: number) => { limit = value; return builder; },
        single: () => { single = true; return builder; },
        maybeSingle: () => { single = true; return builder; },
        update: (values: Record<string, any>) => { mutation = { values, upsert: false }; return builder; },
        insert: (values: Record<string, any>) => { mutation = { values, upsert: true }; return builder; },
        upsert: (values: Record<string, any>) => { mutation = { values, upsert: true }; return builder; },
        then(resolveResult: (result: unknown) => unknown) {
          const selected = (rows[table] ?? []).filter(filter).slice(0, limit);
          if (mutation) {
            mutations.push({ table, values: mutation.values });
            if (mutation.upsert) (rows[table] ??= []).push(mutation.values);
            else selected.forEach((row) => Object.assign(row, mutation!.values));
          }
          return Promise.resolve({ data: single ? selected[0] ?? null : selected, error: null }).then(resolveResult);
        },
      };
      return builder;
    },
  };
  const calls: Array<{ helper: string; accounting: Record<string, any> }> = [];
  const provider = (helper: string) => vi.fn(async (...args: any[]) => {
    const accounting = args[args.length - 1];
    calls.push({ helper, accounting });
    if (options.blocked) throw new AccountingFailure();
    if (options.pendingSettlement) throw Object.assign(new AccountingFailure("ai_accounting_pending", 503), { providerAttempted: true, requestId: "pending-request" });
    if (options.deadlineAfterCall) clock = 200000;
    if (options.paidParseFailure) throw Object.assign(new Error("Invalid generated JSON"), { requestId: `request-${calls.length}`, costCents: 3, providerAttempted: true });
    return { requestId: `request-${calls.length}`, costCents: 3, balanceCents: 4997, model: "tested-model", inputTokens: 10, outputTokens: 10, durationMs: 1,
      analysis: {}, fields: { first_name: "Test" }, questions: ["Wat kun je lassen?"], content: { body_markdown: "Vacaturetekst" },
      requiredSkills: ["Lassen"], requiredCertifications: [], requiresDriversLicense: true, fitScore: 80, verdict: "goed", reasoning: "Passende ervaring", strengths: [], concerns: [] };
  });
  const network = vi.fn(async () => { throw new Error("Raw network forbidden"); });
  const auth = async () => options.denied ? new Response("Forbidden", { status: 403 }) : { organizationId: orgId, userId, user: { id: userId } };
  let handler: (request: Request) => Promise<Response>;
  const source = readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), "utf8");
  const executable = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [() => (file) => ts.factory.updateSourceFile(file, file.statements.filter((statement) => !ts.isImportDeclaration(statement)))] },
  }).outputText.replace(/export \{\};?/g, "");
  runInNewContext(executable, {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => key === "GEMINI_MODEL" ? undefined : key } },
    createClient: () => admin, createAdminClient: () => admin, requireRolePermission: auth, requireInternalProfile: auth,
    isServiceRoleRequest: () => false, internalFunctionHeaders: () => ({}),
    AiAccountingError: AccountingFailure,
    analyzeWithGemini: provider("gemini-cv"), analyzeWithAnthropic: provider("anthropic-cv"), extractCvProfile: provider("cv-extract"),
    generateCallQuestions: provider("questions"), generateVacancyContent: provider("vacancy"), extractVacancySkills: provider("skills"), rerankCandidateFit: provider("rerank"),
    GEMINI_DEFAULT_MODEL: "gemini-2.5-flash", VACANCY_DEFAULT_MODEL: "claude-sonnet-5", VACANCY_PROMPT_MAX_LENGTH: 1000,
    sanitizeOrgPrompt: (value: string) => ({ text: value, removed: 0, truncated: false }), stripMarkdownInline: (value: string) => value,
    pseudonymizeCv: (text: string) => ({ text, meta: {} }),
    buildCandidateDossier: async () => ({ dossierText: "Ervaring als lasser. ".repeat(10), cvText: "Ervaring als lasser. ".repeat(10), counts: {}, warnings: [], visionFile: null }),
    writeCvAnalysisToCandidate: async (_admin: unknown, id: string) => { rows.candidates.find((row) => row.id === id).ai_status = "completed"; },
    jsonResponse: (data: unknown, status: number) => Response.json(data, { status }),
    CORS_HEADERS: {}, corsHeaders: {}, fetch: network, crypto: webcrypto, TextEncoder,
    Request, Response, console, Date: class extends Date { static now() { return clock; } },
  });
  const defaults = { candidate_id: "c-0", vacancy_id: "v-0", cv_text: "Bruikbare CV tekst. ".repeat(10), answers: { functie: "Lasser" }, organization_id: "attacker-org", candidate_ids: ["c-0", "c-1"] };
  const call = async (body: Record<string, unknown> = defaults) => handler(new Request("https://edge.test", {
    method: "POST", headers: { Authorization: "Bearer fake", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { call, calls, rpc, mutations, network, admin, defaults };
}

describe("modern AI endpoint accounting boundaries", () => {
  it.each(names)("%s passes trusted tenant/user context and removes legacy accounting", async (name) => {
    const h = harness(name);
    const body = name === "analyze-cv-batch" ? { max_candidates: 1 } : h.defaults;
    expect((await h.call(body)).status).toBe(200);
    expect(h.calls.length).toBeGreaterThan(0);
    for (const { accounting } of h.calls) {
      expect(accounting).toMatchObject({ admin: h.admin, organizationId: orgId, userId });
      expect(accounting.feature).toBeTruthy();
    }
    expect(h.rpc.mock.calls.every(([name]) => name === "is_superadmin")).toBe(true);
    expect(h.mutations.some(({ table }) => table === "ai_usage_log")).toBe(false);
    expect(h.network).not.toHaveBeenCalled();
  });

  it.each(["extract-cv-profile", "generate-call-questions", "generate-vacancy", "analyze-cv"] as const)("%s gives a budget error rather than invoking legacy debit", async (name) => {
    const h = harness(name, { blocked: true });
    const response = await h.call();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "insufficient_credits" });
    expect(h.calls).toHaveLength(1);
    expect(h.network).not.toHaveBeenCalled();
  });

  it("accounts a dry-run enrichment while leaving vacancy data untouched", async () => {
    const h = harness("enrich-vacancies");
    const response = await h.call({ vacancy_id: "v-0", dry_run: true });
    expect(await response.json()).toMatchObject({ result: { cost_cents: 3, status: "done" } });
    expect(h.calls).toHaveLength(1);
    expect(h.mutations).toHaveLength(0);
  });

  it("returns cached reranking without another provider call or charge", async () => {
    const h = harness("rerank-matches");
    await h.call();
    const firstCount = h.calls.length;
    const data = await (await h.call()).json();
    expect(data).toMatchObject({ gemini_calls: 0, cost_cents: 0, cached: 2 });
    expect(h.calls).toHaveLength(firstCount);
  });

  it("rerank includes paid failures in costs/call counts without claiming a score", async () => {
    const h = harness("rerank-matches", { paidParseFailure: true });
    expect(await (await h.call()).json()).toMatchObject({ scored: 0, failed: 2, gemini_calls: 2, cost_cents: 6 });
  });

  it("accounts Anthropic batch calls explicitly", async () => {
    const h = harness("analyze-cv-batch");
    await h.call({ provider: "cloud", max_candidates: 1 });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ helper: "anthropic-cv", accounting: { candidateId: "c-0" } });
  });

  it("rejects retired VPS selection before queuing any analysis", async () => {
    const h = harness("analyze-cv-batch");
    expect((await h.call({ provider: "vps" })).status).toBe(410);
    expect(h.calls).toHaveLength(0);
    expect(h.mutations).toHaveLength(0);
  });

  for (const [name, cap] of [["analyze-cv-batch", "max_candidates"], ["enrich-vacancies", "max_vacancies"]] as const) {
    it(`${name} refuses fractional limits`, async () => {
      const h = harness(name);
      expect((await h.call({ [cap]: 0.5 })).status).toBe(400);
      expect(h.calls).toHaveLength(0);
    });
    it(`${name} respects a one-record limit with concurrency enabled`, async () => {
      const h = harness(name);
      const data = await (await h.call({ [cap]: 1 })).json();
      expect(h.calls).toHaveLength(1);
      expect(data.cost_cents).toBe(3);
    });
    it(`${name} stops its chain when budget reservation is denied`, async () => {
      const h = harness(name, { blocked: true });
      const data = await (await h.call({ [cap]: 6 })).json();
      expect(h.calls).toHaveLength(4);
      expect(data).toMatchObject({ stopped_reason: "insufficient_credits", cost_cents: 0, costs_pending: 0 });
      expect(h.network).not.toHaveBeenCalled();
    });
    it(`${name} reports unresolved settlement separately and stops the batch`, async () => {
      const h = harness(name, { pendingSettlement: true });
      const data = await (await h.call({ [cap]: 6 })).json();
      expect(h.calls).toHaveLength(4);
      expect(data).toMatchObject({ stopped_reason: "ai_accounting_pending", cost_cents: 0, costs_pending: 4 });
      expect(h.network).not.toHaveBeenCalled();
    });
    it(`${name} retains paid costs on parse failures`, async () => {
      const h = harness(name, { paidParseFailure: true });
      const data = await (await h.call({ [cap]: 1 })).json();
      expect(data).toMatchObject({ failed: 1, cost_cents: 3, costs_pending: 0 });
      expect(h.calls).toHaveLength(1);
    });
    it(`${name} does not self-trigger an unlimited run after a capped deadline`, async () => {
      const h = harness(name, { deadlineAfterCall: true });
      const data = await (await h.call({ [cap]: 6 })).json();
      expect(data.stopped_reason).toBe("deadline");
      expect(h.calls).toHaveLength(4);
      expect(h.network).not.toHaveBeenCalled();
    });
  }
});
