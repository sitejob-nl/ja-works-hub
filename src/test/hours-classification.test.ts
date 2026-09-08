import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyStoredHoursDay, createHoursClassificationHandler, HOURS_CLASSIFICATION_ENGINE_VERSION,
  type HoursClassificationContext,
} from '../../supabase/functions/_shared/hours-classification';
import type { HoursMatrixVersion } from '../../supabase/functions/_shared/hours-calculation';

const DAY = '11111111-1111-4111-8111-111111111111';
const REVISION = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
const MATRIX = '55555555-5555-4555-8555-555555555555';
const CLASSIFICATION = '66666666-6666-4666-8666-666666666666';
afterEach(() => vi.unstubAllGlobals());
const flat = (overrides: Partial<HoursMatrixVersion> = {}): HoursMatrixVersion => ({
  schemaVersion: 1, id: MATRIX, scope: 'client', validFrom: '2026-01-01', validUntil: null,
  confirmed: true, timeBasis: 'wall_clock', categories: [{ code: 'NORMAAL', factor: '1.0' }],
  categoryMappings: [], automaticRules: { kind: 'flat', rule: { id: 'normal', categoryCode: 'NORMAAL' } }, ...overrides,
});
const context = (overrides: Partial<HoursClassificationContext> = {}): HoursClassificationContext => ({
  day_id: DAY, revision_id: REVISION, week_id: DAY, company_id: DAY, organization_id: ORG,
  work_date: '2026-09-07', total_minutes: 480, no_hours_reason: null, source_input: null,
  context_hash: 'trusted-snapshot-hash', client_matrices: [flat()], cao_matrices: [], pinned_matrix: null, ...overrides,
});
const shift = { start: '22:00', end: '06:30', endDayOffset: 1, breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1, endDayOffset: 1 }] };

describe('stored day classification uses the production deterministic kernel', () => {
  it('classifies a total under an explicitly confirmed flat matrix without inferring wages', () => {
    expect(classifyStoredHoursDay(context())).toEqual({ status: 'classified', matrix_version_id: MATRIX,
      allocations: [{ categoryCode: 'NORMAAL', factor: '1.0', minutes: 480, ruleId: 'normal' }], issues: [] });
  });
  it('preserves overnight break minutes and explicit OV1 through OV5 source codes', () => {
    const codes = ['OV1', 'OV2', 'OV3', 'OV4', 'OV5'];
    const matrix = flat({ categories: codes.map((code, index) => ({ code, factor: `1.${index + 1}` })),
      categoryMappings: codes.map(code => ({ id: `map-${code}`, sourceCode: code, categoryCode: code })), automaticRules: { kind: 'explicit_only' } });
    const result = classifyStoredHoursDay(context({ client_matrices: [matrix], source_input: {
      schemaVersion: 1, shifts: [shift], categories: codes.map(sourceCode => ({ sourceCode, minutes: 96 })),
    } }));
    expect(result.status).toBe('classified');
    expect(result.allocations.map(row => [row.sourceCategory, row.minutes, row.factor])).toEqual(codes.map((code, index) => [code, 96, `1.${index + 1}`]));
  });
  it('does not use valid categories to hide a conflicting shift control total', () => {
    const result = classifyStoredHoursDay(context({ client_matrices: [flat({ categoryMappings: [{ id: 'source', sourceCode: 'N', categoryCode: 'NORMAAL' }] })],
      source_input: { schemaVersion: 1, shifts: [{ ...shift, end: '07:30' }], categories: [{ sourceCode: 'N', minutes: 480 }] } }));
    expect(result).toMatchObject({ status: 'blocked', matrix_version_id: MATRIX, allocations: [], issues: [{ code: 'TOTAL_MISMATCH', expectedMinutes: 540, actualMinutes: 480 }] });
  });
  it('keeps overlapping shifts blocked even when categories total correctly', () => {
    const result = classifyStoredHoursDay(context({ source_input: { schemaVersion: 1, shifts: [shift, shift], categories: [{ sourceCode: 'N', minutes: 480 }] } }));
    expect(result.issues[0].code).toBe('OVERLAPPING_SHIFTS');
  });
  it('keeps clock-change shifts blocked', () => {
    const result = classifyStoredHoursDay(context({ work_date: '2026-10-25', source_input: { schemaVersion: 1,
      shifts: [{ start: '01:00', end: '09:00', endDayOffset: 0, breaks: [] }] } }));
    expect(result.issues[0].code).toBe('DST_REQUIRES_REVIEW');
  });
  it('retains a selected basis when time windows need missing shift facts', () => {
    const matrix = flat({ automaticRules: { kind: 'time_windows', rules: [{ id: 'window', categoryCode: 'NORMAAL', daysOfWeek: [1], start: '00:00', end: '24:00' }] } });
    expect(classifyStoredHoursDay(context({ client_matrices: [matrix] }))).toMatchObject({ status: 'blocked', matrix_version_id: MATRIX, issues: [{ code: 'MISSING_SHIFT_TIMES' }] });
  });
  it('does not pin missing matrices so later configuration can resolve the day', () => {
    expect(classifyStoredHoursDay(context({ client_matrices: [] }))).toMatchObject({ status: 'blocked', matrix_version_id: null, issues: [{ code: 'MISSING_MATRIX' }] });
    expect(classifyStoredHoursDay(context()).status).toBe('classified');
  });
  it('blocks overlapping matrices without pinning either candidate', () => {
    expect(classifyStoredHoursDay(context({ client_matrices: [flat(), flat({ id: 'other' })] }))).toMatchObject({ status: 'blocked', matrix_version_id: null, issues: [{ code: 'OVERLAPPING_MATRIX_VERSIONS' }] });
  });
  it('uses only the already pinned CAO basis after client publication or a CAO change', () => {
    const pinned = flat({ scope: 'cao', categories: [{ code: 'OUD', factor: '1.25' }], automaticRules: { kind: 'flat', rule: { id: 'old-rule', categoryCode: 'OUD' } } });
    const result = classifyStoredHoursDay(context({ pinned_matrix: { matrix_version_id: MATRIX, definition: pinned },
      client_matrices: [flat({ id: 'new-client' })], cao_matrices: [flat({ id: 'new-cao', scope: 'cao' })] }));
    expect(result).toMatchObject({ status: 'classified', matrix_version_id: MATRIX, allocations: [{ categoryCode: 'OUD', factor: '1.25' }] });
  });
  it('rejects a corrupt pinned identity instead of falling back to live configuration', () => {
    expect(classifyStoredHoursDay(context({ pinned_matrix: { matrix_version_id: 'different', definition: flat() } })).issues[0].code).toBe('INVALID_PINNED_MATRIX');
  });
  it('handles an explicit non-working day without a matrix, pin or fabricated allocation', () => {
    expect(classifyStoredHoursDay(context({ total_minutes: 0, no_hours_reason: 'Vrij', client_matrices: [] })))
      .toEqual({ status: 'no_hours', matrix_version_id: null, allocations: [], issues: [] });
  });
  it.each([null, '', '  '])('blocks zero without an explicit reason (%s)', no_hours_reason => {
    expect(classifyStoredHoursDay(context({ total_minutes: 0, no_hours_reason })).issues[0].code).toBe('MISSING_NO_HOURS_REASON');
  });
  it.each([{ schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 60 }] }, { schemaVersion: 1, shifts: [shift] }, { schemaVersion: 1 }])('does not erase rich sources through the zero shortcut', source_input => {
    expect(classifyStoredHoursDay(context({ total_minutes: 0, no_hours_reason: 'Vrij', source_input })))
      .toMatchObject({ status: 'blocked', matrix_version_id: null, issues: [{ code: 'INVALID_ZERO_SOURCE' }] });
  });
  it.each([{}, { schemaVersion: 2 }, { schemaVersion: 1, allocations: [] }, [], 'text'])('rejects unsupported source envelopes', source_input => {
    expect(classifyStoredHoursDay(context({ source_input })).issues[0].code).toBe('INVALID_SOURCE_INPUT');
  });
  it.each([0.5, '480', null, -1])('rejects non-integer category minutes (%s)', minutes => {
    expect(classifyStoredHoursDay(context({ source_input: { schemaVersion: 1, categories: [{ sourceCode: 'N', minutes }] } })).issues[0].code).toBe('INVALID_SOURCE_CATEGORY');
  });
  it('keeps case-sensitive OV source codes rather than silently normalizing them', () => {
    expect(classifyStoredHoursDay(context({ client_matrices: [flat({ categoryMappings: [{ id: 'ov', sourceCode: 'OV1', categoryCode: 'NORMAAL' }] })],
      source_input: { schemaVersion: 1, categories: [{ sourceCode: 'ov1', minutes: 480 }] } })).issues[0].code).toBe('UNMAPPED_SOURCE_CATEGORY');
  });
});

type HarnessOptions = {
  role?: string; active?: boolean; invalidJwt?: boolean; permissionDenied?: boolean; context?: unknown;
  contextError?: { code: string; message?: string }; finalizeError?: { code: string; message?: string }; throwRpc?: boolean;
};

/** Execute actual auth and entrypoint source with DB/network doubles; calculations remain real. */
function harness(options: HarnessOptions = {}) {
  const network = vi.fn(() => { throw new Error('Network forbidden'); });
  vi.stubGlobal('fetch', network);
  const dbContext = options.context === undefined ? context() : options.context;
  const getUser = vi.fn(async () => ({ data: { user: options.invalidJwt ? null : { id: ACTOR } }, error: options.invalidJwt ? { message: 'bad JWT' } : null }));
  const serviceRpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    if (options.throwRpc) throw new Error('Secret database detail');
    const result = args.p_result as Record<string, unknown>;
    return { error: options.finalizeError ?? null, data: { id: CLASSIFICATION, revision_id: REVISION, ...result,
      matrix_name: result.matrix_version_id ? 'Testmatrix' : null, matrix_scope: result.matrix_version_id ? 'client' : null,
      engine_version: HOURS_CLASSIFICATION_ENGINE_VERSION, created_at: '2026-09-08T10:00:00Z', basis_pinned: result.matrix_version_id !== null } };
  });
  const userRpc = vi.fn(async () => ({ data: dbContext, error: options.contextError ?? null }));
  const profileReads: string[] = [];
  const admin = {
    auth: { getUser }, rpc: serviceRpc,
    from(table: string) {
      profileReads.push(table);
      const data = table === 'profiles' ? { id: ACTOR, organization_id: ORG, role: options.role ?? 'finance', is_active: options.active ?? true }
        : table === 'organizations' ? { settings: { role_permissions: { finance: { 'finance.manage': !options.permissionDenied }, intercedent: { 'finance.manage': false } } } } : null;
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data, error: null }) };
      return builder;
    },
  };
  const clientCalls: Array<{ key: string; options: unknown }> = [];
  const createClient = (_url: string, key: string, clientOptions: unknown) => {
    clientCalls.push({ key, options: clientOptions });
    return key === 'anon-key' ? { rpc: userRpc } : admin;
  };
  const source = (path: string) => ts.transpileModule(readFileSync(resolve('supabase/functions', path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [() => file => ts.factory.updateSourceFile(file, file.statements.filter(statement => !ts.isImportDeclaration(statement)))] },
  }).outputText.replace(/export \{\};?/g, '');
  let handler: (req: Request) => Promise<Response>;
  const runtime = { Request, Response, fetch: network, createClient,
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CARERIX_WORKER_SECRET: 'worker-secret' })[key] } } };
  const authExports: Record<string, unknown> = {};
  runInNewContext(source('_shared/auth.ts').replace(/^export /gm, '') +
    '\nObject.assign(exports, { requireRolePermission, createAdminClient });', { ...runtime, exports: authExports });
  runInNewContext(source('hours-classify-day/index.ts'), { ...runtime, ...authExports, createHoursClassificationHandler,
    CORS_HEADERS: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  const call = (body: unknown = { day_id: DAY, expected_revision_id: REVISION }, token: string | null = 'valid-user-token', method = 'POST') => handler(new Request('https://edge.test', {
    method, headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  }));
  return { call, getUser, userRpc, serviceRpc, profileReads, clientCalls, network };
}

describe('trusted hours classification HTTP boundary', () => {
  it('verifies the live user, reads via the exact JWT, and finalizes only the server-generated result via service role', async () => {
    const h = harness();
    const response = await h.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ classification: { revision_id: REVISION, status: 'classified', basis_pinned: true } });
    expect(h.getUser).toHaveBeenCalledWith('valid-user-token');
    expect(h.clientCalls.find(row => row.key === 'anon-key')).toMatchObject({ options: { global: { headers: { Authorization: 'Bearer valid-user-token' } }, auth: { persistSession: false } } });
    expect(h.userRpc).toHaveBeenCalledWith('hours_get_day_classification_context', { p_day_id: DAY, p_expected_revision_id: REVISION });
    expect(h.serviceRpc).toHaveBeenCalledWith('hours_finalize_day_classification', { p_actor_id: ACTOR,
      p_day_id: DAY, p_expected_revision_id: REVISION, p_expected_context_hash: 'trusted-snapshot-hash',
      p_engine_version: 'hours-calculation-v1', p_result: classifyStoredHoursDay(context()) });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(h.network).not.toHaveBeenCalled();
  });
  it.each([
    ['missing JWT', {}, null, 401], ['invalid JWT', { invalidJwt: true }, 'expired', 401],
    ['service key', {}, 'service-key', 401], ['inactive', { active: false }, 'valid', 403],
    ['employee portal', { role: 'medewerker' }, 'valid', 403], ['client portal', { role: 'opdrachtgever' }, 'valid', 403],
    ['missing permission', { role: 'intercedent' }, 'valid', 403], ['revoked permission', { permissionDenied: true }, 'valid', 403],
  ] as const)('rejects %s before any context or finalization RPC', async (_label, options, token, status) => {
    const h = harness(options);
    expect((await h.call(undefined, token)).status).toBe(status);
    expect(h.userRpc).not.toHaveBeenCalled(); expect(h.serviceRpc).not.toHaveBeenCalled(); expect(h.network).not.toHaveBeenCalled();
  });
  it.each([
    {}, [], null, 'not json', { day_id: DAY }, { day_id: 'bad', expected_revision_id: REVISION },
    ...['organization_id', 'actor_id', 'source_input', 'matrix_version_id', 'p_result', 'status', '__proto__', 'constructor'].map(key => ({ day_id: DAY, expected_revision_id: REVISION, [key]: 'injected' })),
    'x'.repeat(1025),
  ])('rejects malformed or injected browser input', async body => {
    const h = harness();
    expect((await h.call(body)).status).toBe(400);
    expect(h.userRpc).not.toHaveBeenCalled(); expect(h.serviceRpc).not.toHaveBeenCalled();
  });
  it.each([context({ organization_id: 'other-tenant' }), context({ revision_id: DAY }), context({ day_id: REVISION }), context({ context_hash: '' }), null])('does not finalize an inconsistent database context', async invalid => {
    const h = harness({ context: invalid });
    expect((await h.call()).status).toBe(500); expect(h.serviceRpc).not.toHaveBeenCalled();
  });
  it.each(['contextError', 'finalizeError'] as const)('returns stale context/revision as 409 from %s', async key => {
    const h = harness({ [key]: { code: '40001', message: 'Private SQL detail' } });
    const response = await h.call();
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: '40001' });
    expect(h.serviceRpc).toHaveBeenCalledTimes(key === 'contextError' ? 0 : 1);
  });
  it('persists missing facts as a successful blocked result rather than an HTTP failure', async () => {
    const h = harness({ context: context({ client_matrices: [] }) });
    const response = await h.call();
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ classification: { status: 'blocked', matrix_version_id: null, issues: [{ code: 'MISSING_MATRIX' }] } });
    expect(h.serviceRpc).toHaveBeenCalledTimes(1);
  });
  it('persists zero and a reason without any category, matrix or provider lookup', async () => {
    const h = harness({ context: context({ total_minutes: 0, no_hours_reason: 'Vrij', client_matrices: [] }) });
    const response = await h.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ classification: { status: 'no_hours', matrix_version_id: null, allocations: [], issues: [] } });
    expect(h.network).not.toHaveBeenCalled();
  });
  it('persists contradictory zero sources as blocked without a matrix pin', async () => {
    const h = harness({ context: context({ total_minutes: 0, no_hours_reason: 'Vrij', source_input: { schemaVersion: 1, shifts: [shift] } }) });
    const response = await h.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ classification: { status: 'blocked', matrix_version_id: null, allocations: [], issues: [{ code: 'INVALID_ZERO_SOURCE' }] } });
  });
  it('honors finalization refusal after the actor loses rights', async () => {
    const h = harness({ finalizeError: { code: '42501' } });
    expect((await h.call()).status).toBe(403);
  });
  it('does not expose DB details when storage fails', async () => {
    const h = harness({ throwRpc: true });
    const response = await h.call();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('Secret');
  });
  it('preflights and rejects non-POST methods without authentication or DB calls', async () => {
    const h = harness();
    expect((await h.call(undefined, null, 'OPTIONS')).status).toBe(204);
    expect((await h.call(undefined, null, 'GET')).status).toBe(405);
    expect(h.getUser).not.toHaveBeenCalled(); expect(h.userRpc).not.toHaveBeenCalled(); expect(h.serviceRpc).not.toHaveBeenCalled();
  });
});
