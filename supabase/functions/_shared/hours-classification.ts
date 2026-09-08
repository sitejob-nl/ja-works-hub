import {
  classifyHoursDay, selectEffectiveHoursMatrix,
  type HoursAllocation, type HoursDayInput, type HoursIssue, type HoursMatrixVersion,
} from './hours-calculation.ts';

/** Bump together with the database allowlist when persisted calculation semantics change. */
export const HOURS_CLASSIFICATION_ENGINE_VERSION = 'hours-calculation-v1';

export interface HoursClassificationContext {
  day_id: string;
  revision_id: string;
  week_id: string;
  company_id: string;
  organization_id: string;
  work_date: string;
  total_minutes: number;
  no_hours_reason: string | null;
  source_input: unknown;
  context_hash: string;
  client_matrices: HoursMatrixVersion[];
  cao_matrices: HoursMatrixVersion[];
  pinned_matrix: null | { matrix_version_id: string; definition: HoursMatrixVersion };
}

export interface HoursClassificationResult {
  status: 'classified' | 'blocked' | 'no_hours';
  matrix_version_id: string | null;
  allocations: HoursAllocation[];
  issues: HoursIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const blocked = (issues: HoursIssue[], matrixVersionId: string | null = null): HoursClassificationResult =>
  ({ status: 'blocked', matrix_version_id: matrixVersionId, allocations: [], issues });
const issue = (code: string, message: string): HoursIssue => ({ code, message });

/**
 * The caller supplies only a canonical database context, never browser calculation data.
 * Selection and classification use the same kernel as the matrix preview. A valid matrix
 * is retained even when missing source facts block classification; absence is never pinned.
 * A pinned basis takes precedence over every later publication or CAO binding.
 */
export function classifyStoredHoursDay(context: HoursClassificationContext): HoursClassificationResult {
  if (context.total_minutes === 0) {
    if (typeof context.no_hours_reason !== 'string' || !context.no_hours_reason.trim()) {
      return blocked([issue('MISSING_NO_HOURS_REASON', 'Bevestig waarom op deze dag geen uren zijn gewerkt.')]);
    }
    if (context.source_input !== null) {
      return blocked([issue('INVALID_ZERO_SOURCE', 'Nul uren bevat nog diensttijden of uurcategorieën. Beoordeel de bron en leg een consistente revisie vast.')]);
    }
    // A reported non-working day is not a fabricated normal-hours or payroll allocation.
    return { status: 'no_hours', matrix_version_id: null, allocations: [], issues: [] };
  }

  const pinned = context.pinned_matrix;
  if (pinned !== null && (!isRecord(pinned) || !isRecord(pinned.definition) || pinned.matrix_version_id !== pinned.definition.id)) {
    return blocked([issue('INVALID_PINNED_MATRIX', 'De vastgelegde matrixbasis is ongeldig. Laat deze controleren.')]);
  }
  const selected = selectEffectiveHoursMatrix({
    workDate: context.work_date,
    clientVersions: pinned ? (pinned.definition.scope === 'client' ? [pinned.definition] : []) : context.client_matrices,
    caoVersions: pinned ? (pinned.definition.scope === 'cao' ? [pinned.definition] : []) : context.cao_matrices,
  });
  if (selected.ok === false) return blocked(selected.issues);

  const source = context.source_input;
  if (source !== null && (!isRecord(source) || source.schemaVersion !== 1 ||
      Object.keys(source).some(key => !['schemaVersion', 'shifts', 'categories'].includes(key)))) {
    return blocked([issue('INVALID_SOURCE_INPUT', 'De opgeslagen brongegevens bevatten een onbekende versie of ongeldige velden.')], selected.value.id);
  }
  if (context.no_hours_reason !== null) {
    return blocked([issue('INVALID_NO_HOURS_REASON', 'Gewerkte minuten en een reden voor nul uren kunnen niet samen worden ingedeeld.')], selected.value.id);
  }
  const sourceFields = isRecord(source) ? source : {};
  const day: HoursDayInput = {
    workDate: context.work_date,
    totalMinutes: context.total_minutes,
    // Preserve both sources: valid categories must not hide an invalid or conflicting shift.
    ...(hasOwn(sourceFields, 'shifts') ? { shifts: sourceFields.shifts as HoursDayInput['shifts'] } : {}),
    ...(hasOwn(sourceFields, 'categories') ? { categories: sourceFields.categories as HoursDayInput['categories'] } : {}),
  };
  const result = classifyHoursDay(day, selected.value);
  return result.ok === true
    ? { status: 'classified', matrix_version_id: selected.value.id, allocations: result.value.allocations, issues: [] }
    : blocked(result.issues, selected.value.id);
}

export interface HoursClassificationRpcResult { data: unknown; error: null | { code?: string; message?: string } }
export interface HoursClassificationPorts {
  authorize(req: Request): Promise<{ userId: string; organizationId: string } | Response>;
  userRpc(req: Request, name: string, args: Record<string, unknown>): PromiseLike<HoursClassificationRpcResult>;
  serviceRpc(name: string, args: Record<string, unknown>): PromiseLike<HoursClassificationRpcResult>;
}

const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Testable HTTP boundary; the production entrypoint wires verified auth and separate DB clients. */
export function createHoursClassificationHandler(ports: HoursClassificationPorts, corsHeaders: Record<string, string> = {}) {
  const headers = { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const rpcError = (error: { code?: string }) => {
    switch (error.code) {
      case '40001': return json({ error: 'De dag of matrixbasis is gewijzigd. Vernieuw de week en controleer de nieuwste gegevens.', code: '40001' }, 409);
      case '42501': return json({ error: 'Geen toegang tot deze dag of onvoldoende rechten.', code: '42501' }, 403);
      case '22023': case '22P02': case '23514':
        return json({ error: 'De gegevens voor deze classificatie zijn ongeldig.', code: error.code }, 400);
      default: return json({ error: 'De urenindeling kon niet worden opgeslagen. Probeer het opnieuw.', code: 'classification_unavailable' }, 503);
    }
  };
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Gebruik POST voor urenindeling.', code: 'method_not_allowed' }, 405);
    try {
      const auth = await ports.authorize(req);
      if (auth instanceof Response) return auth;
      // Only two UUIDs are accepted. Actors, tenants, sources, matrices and results are server-owned.
      if (Number(req.headers.get('content-length')) > 1024) return json({ error: 'De aanvraag is te groot.', code: 'invalid_input' }, 400);
      const text = await req.text();
      if (text.length > 1024) return json({ error: 'De aanvraag is te groot.', code: 'invalid_input' }, 400);
      let input: unknown;
      try { input = JSON.parse(text); } catch { return json({ error: 'Ongeldige JSON-aanvraag.', code: 'invalid_input' }, 400); }
      if (!isRecord(input) || Object.keys(input).length !== 2 ||
          Object.keys(input).some(key => !['day_id', 'expected_revision_id'].includes(key)) ||
          !uuid(input.day_id) || !uuid(input.expected_revision_id)) {
        return json({ error: 'Alleen day_id en expected_revision_id zijn toegestaan en moeten geldige identificaties zijn.', code: 'invalid_input' }, 400);
      }
      const args = { p_day_id: input.day_id, p_expected_revision_id: input.expected_revision_id };
      const contextResponse = await ports.userRpc(req, 'hours_get_day_classification_context', args);
      if (contextResponse.error) return rpcError(contextResponse.error);
      const context = contextResponse.data;
      if (!isRecord(context) || context.day_id !== input.day_id || context.revision_id !== input.expected_revision_id ||
          context.organization_id !== auth.organizationId || typeof context.context_hash !== 'string' || !context.context_hash ||
          typeof context.work_date !== 'string' || !Number.isSafeInteger(context.total_minutes) ||
          (context.total_minutes as number) < 0 || (context.total_minutes as number) > 1440 ||
          !hasOwn(context, 'source_input') || !hasOwn(context, 'no_hours_reason') ||
          !hasOwn(context, 'pinned_matrix') || !Array.isArray(context.client_matrices) || !Array.isArray(context.cao_matrices)) {
        return json({ error: 'De opgeslagen dagcontext is ongeldig. Er is geen indeling vastgelegd.', code: 'invalid_context' }, 500);
      }
      const result = classifyStoredHoursDay(context as unknown as HoursClassificationContext);
      const finalized = await ports.serviceRpc('hours_finalize_day_classification', {
        p_actor_id: auth.userId,
        ...args,
        p_expected_context_hash: context.context_hash,
        p_engine_version: HOURS_CLASSIFICATION_ENGINE_VERSION,
        p_result: result,
      });
      if (finalized.error) return rpcError(finalized.error);
      if (!isRecord(finalized.data) || finalized.data.revision_id !== input.expected_revision_id ||
          finalized.data.status !== result.status || !uuid(finalized.data.id)) {
        return json({ error: 'De opslagbevestiging is onvolledig. Vernieuw de week om de indeling te controleren.', code: 'invalid_confirmation' }, 503);
      }
      return json({ classification: finalized.data });
    } catch {
      // Never expose JWTs, provider payloads, DB details or source notes in logs/errors.
      return json({ error: 'De urenindeling is tijdelijk niet beschikbaar. Probeer het opnieuw.', code: 'classification_unavailable' }, 503);
    }
  };
}
