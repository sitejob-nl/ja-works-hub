import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute the real edge handlers while replacing their Deno/HTTP imports.
// Database/auth/accounting are local doubles; the raw network is always forbidden.
const ORGANIZATION_ID = "org-from-auth";
const USER_ID = "user-from-auth";
const endpointNames = ["cv-rewrite", "recruiter-priorities", "validate-timesheets", "exa-people-search"] as const;
type EndpointName = typeof endpointNames[number];

class AccountingFailure extends Error {
  constructor(public code = "insufficient_credits", public status = 402) {
    super("Onvoldoende AI-tegoed.");
  }
}

function timesheet(id: string, candidateId: string) {
  return {
    id, candidate_id: candidateId, work_date: "2026-09-07", hours: 8,
    overtime_hours: 0, status: "concept", candidates: { candidate_employment: [] }, placements: {},
  };
}

function createHarness(name: EndpointName, options: {
  denied?: boolean;
  accountingFailure?: AccountingFailure;
  timesheets?: ReturnType<typeof timesheet>[];
  gatewayStatus?: number;
} = {}) {
  const mutations: Array<{ table: string; operation: string; values: unknown }> = [];
  const fixture: Record<string, unknown> = {
    candidates: name === "cv-rewrite" ? { id: "candidate-1", skills: ["lassen"] } : [],
    profiles: { full_name: "Recruiter" },
    employees: name === "cv-rewrite" ? null : [],
    timesheets: options.timesheets ?? [timesheet("timesheet-1", "candidate-1")],
  };
  function client(label: string) {
    return {
      label,
      rpc: vi.fn(),
      from(table: string) {
        const result = { data: fixture[table] ?? [], error: null };
        const builder: Record<string, any> = {
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
        };
        for (const method of ["select", "eq", "neq", "lte", "gte", "lt", "is", "in", "order", "limit", "single", "maybeSingle"]) {
          builder[method] = () => builder;
        }
        for (const operation of ["insert", "update", "delete", "upsert"]) {
          builder[operation] = (values: unknown) => {
            mutations.push({ table, operation, values });
            return builder;
          };
        }
        return builder;
      },
    };
  }
  const admin = client("service-role");
  const user = client("user-rls");
  const rawFetch = vi.fn(() => { throw new Error("Unmetered network access forbidden"); });
  const meteredAiFetch = vi.fn(async (_accounting, request) => {
    if (options.accountingFailure) throw options.accountingFailure;
    if (options.gatewayStatus) return { response: new Response("Rejected", { status: options.gatewayStatus }) };
    const result = request.provider === "exa"
      ? { results: [{ id: "result-1", url: "https://example.test/person", title: "Lasser" }], costDollars: { total: 0.027 } }
      : {
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({
          summary: "Professioneel profiel", tasks: [],
          entries: [{ work_date: "2026-09-07", status: "groen", issues: [] }],
        }) } }] } }],
      };
    return { response: Response.json(result), requestId: `ledger-${meteredAiFetch.mock.calls.length}` };
  });
  let handler: (req: Request) => Promise<Response>;
  const serve = (callback: typeof handler) => { handler = callback; };
  const source = readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), "utf8");
  const executable = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  runInNewContext(executable, {
    serve,
    Deno: { serve, env: { get: (key: string) => key } },
    requireRolePermission: async () => options.denied
      ? new Response("Forbidden", { status: 403 })
      : { userId: USER_ID, organizationId: ORGANIZATION_ID },
    createAdminClient: () => admin,
    createClient: (_url: string, key: string) => key === "SUPABASE_SERVICE_ROLE_KEY" ? admin : user,
    pseudonymizeCv: (text: string) => ({ text }),
    meteredAiFetch,
    AiAccountingError: AccountingFailure,
    corsHeaders: {},
    fetch: rawFetch,
    Response, Request, console, Date, JSON, Map, Set,
  });
  const requestBody = name === "cv-rewrite" ? { candidate_id: "candidate-1", organization_id: "attacker-org" }
    : name === "validate-timesheets" ? { timesheet_ids: ["timesheet-1", "timesheet-2"], organization_id: "attacker-org" }
    : name === "exa-people-search" ? { query: "lasser Eindhoven", numResults: 20, organization_id: "attacker-org" }
    : { organization_id: "attacker-org" };
  return {
    admin, user, mutations, meteredAiFetch, rawFetch,
    call: (body: Record<string, unknown> = requestBody) => handler(new Request("https://edge.test", {
      method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })),
  };
}

describe("legacy AI endpoints use the tenant ledger before applying results", () => {
  it.each(endpointNames)("%s rejects an unauthorized request without accounting or network", async (name) => {
    const harness = createHarness(name, { denied: true });
    expect((await harness.call()).status).toBe(403);
    expect(harness.meteredAiFetch).not.toHaveBeenCalled();
    expect(harness.rawFetch).not.toHaveBeenCalled();
    expect(harness.mutations).toEqual([]);
  });

  it.each(endpointNames)("%s uses trusted organization/user and a service client", async (name) => {
    const harness = createHarness(name);
    expect((await harness.call()).status).toBe(200);
    expect(harness.meteredAiFetch).toHaveBeenCalledOnce();
    const [accounting, request] = harness.meteredAiFetch.mock.calls[0];
    expect(accounting).toMatchObject({ admin: harness.admin, organizationId: ORGANIZATION_ID, userId: USER_ID });
    expect(request.provider).toBe(name === "exa-people-search" ? "exa" : "lovable");
    if (request.provider === "lovable") {
      expect(request.body.max_tokens).toBeGreaterThan(0);
      expect(request.body.max_tokens).toBeLessThanOrEqual(8192);
      expect(request.model).toBe(request.body.model);
    }
    expect(harness.rawFetch).not.toHaveBeenCalled();
  });

  it.each(endpointNames)("%s reports insufficient budget and performs no domain writes", async (name) => {
    const harness = createHarness(name, { accountingFailure: new AccountingFailure() });
    const response = await harness.call();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "insufficient_credits" });
    expect(harness.mutations).toEqual([]);
    expect(harness.rawFetch).not.toHaveBeenCalled();
  });

  it.each(endpointNames)("%s fails closed when accounting cannot settle", async (name) => {
    const harness = createHarness(name, { accountingFailure: new AccountingFailure("accounting_pending", 503) });
    const response = await harness.call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "accounting_pending" });
    expect(harness.mutations).toEqual([]);
    expect(harness.rawFetch).not.toHaveBeenCalled();
  });

  it("meters each candidate validation independently before changing that candidate's hours", async () => {
    const harness = createHarness("validate-timesheets", {
      timesheets: [timesheet("timesheet-1", "candidate-1"), timesheet("timesheet-2", "candidate-2")],
    });
    expect((await harness.call()).status).toBe(200);
    expect(harness.meteredAiFetch.mock.calls.map(([accounting]) => accounting.candidateId)).toEqual(["candidate-1", "candidate-2"]);
    expect(harness.meteredAiFetch.mock.calls.every(([accounting]) => accounting.feature === "timesheet_validation")).toBe(true);
    expect(harness.mutations.filter((mutation) => mutation.table === "timesheets")).toHaveLength(2);
  });

  it("does not meter or change hours that have already been approved", async () => {
    const approved = { ...timesheet("timesheet-1", "candidate-1"), status: "goedgekeurd" };
    const harness = createHarness("validate-timesheets", { timesheets: [approved] });
    expect((await harness.call()).status).toBe(200);
    expect(harness.meteredAiFetch).not.toHaveBeenCalled();
    expect(harness.mutations).toEqual([]);
  });

  it("rejects oversized validation batches before reserving credits", async () => {
    const harness = createHarness("validate-timesheets");
    expect((await harness.call({ timesheet_ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) })).status).toBe(400);
    expect(harness.meteredAiFetch).not.toHaveBeenCalled();
  });

  it("meters Exa's actual over-fetch request, and preserves its reported cost", async () => {
    const harness = createHarness("exa-people-search");
    const response = await harness.call();
    const [accounting, request] = harness.meteredAiFetch.mock.calls[0];
    expect(accounting.feature).toBe("people_search");
    expect(request.body.numResults).toBe(30);
    expect(await response.json()).toMatchObject({ cost: { total: 0.027 } });
  });

  it("rejects non-numeric Exa limits before reserving credits", async () => {
    const harness = createHarness("exa-people-search");
    expect((await harness.call({ query: "lasser", numResults: "unbounded" })).status).toBe(400);
    expect(harness.meteredAiFetch).not.toHaveBeenCalled();
  });
});
