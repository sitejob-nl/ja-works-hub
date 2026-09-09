import { AiAccountingError, type AiAccountingResult } from './ai-accounting.ts';
import {
  HOURS_READABLE_SCAN_TYPES, interpretScanReading, type ScanContext, type ScanReading,
} from './hours-scan.ts';

/**
 * The HTTP boundary of reading a scan or photo into proposals.
 *
 * Everything that decides is behind a port, so the whole boundary is testable
 * without a session, a bucket or a paid call. Two things are deliberately not
 * negotiable from the outside: the browser sends one source identifier and
 * nothing else, and the storage path, media type and week come back from the
 * database. A caller can therefore never point this at a file of its choosing.
 *
 * This endpoint writes nothing. The reading is returned for review; recording
 * it as proposals is a separate act, and applying a proposal another one.
 */
export interface HoursScanAuth { userId: string; organizationId: string }
export interface HoursScanRpcResult { data: unknown; error: null | { code?: string; message?: string } }

/** What one paid reading needs. The week's names are deliberately absent. */
export interface HoursScanRequest {
  organizationId: string;
  userId: string;
  file: { mimeType: string; bytes: Uint8Array; fileName: string };
  /** The work dates of this week, so a written "maandag" can be normalised. */
  weekDates: string[];
  pageCount: number | null;
}
export interface HoursScanOutcome {
  output: unknown; model: string; requestId: string;
  costCents: number; balanceCents: number; durationMs: number;
}

export interface HoursScanPorts {
  authorize(req: Request): Promise<HoursScanAuth | Response>;
  userRpc(req: Request, name: string, args: Record<string, unknown>): PromiseLike<HoursScanRpcResult>;
  download(path: string): Promise<Uint8Array>;
  read(request: HoursScanRequest): Promise<HoursScanOutcome>;
}

/**
 * Above this the request would be refused by the provider or cost more than the
 * reading is worth. The bucket allows 25 MiB, so this is a real limit a user can
 * hit; it has to say what still works.
 */
export const HOURS_SCAN_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** One identifier and nothing else; the body has no reason to be larger. */
const MAX_REQUEST_BYTES = 1024;

/**
 * Reads the body while counting, and stops at the bound.
 *
 * A declared length is a hint, not a promise: it is absent on a chunked request,
 * where `Number(null)` is zero and a header check would wave anything through
 * to be buffered whole. Counting the bytes as they arrive refuses the same
 * oversized body without ever holding it.
 */
async function readBounded(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

interface ReadingContext {
  storagePath: string; contentType: string; byteSize: number; fileName: string;
  pageCount: number | null; scan: ScanContext;
}

function readContext(value: unknown, auth: HoursScanAuth, sourceId: string): ReadingContext | null {
  if (!isRecord(value) || value.organization_id !== auth.organizationId || value.source_id !== sourceId
    || typeof value.storage_path !== 'string' || !value.storage_path
    || typeof value.content_type !== 'string' || typeof value.file_name !== 'string'
    || !Number.isSafeInteger(value.byte_size) || (value.byte_size as number) < 1
    || !Array.isArray(value.members) || !Array.isArray(value.days)) return null;
  const pageCount = value.page_count === null ? null
    : Number.isSafeInteger(value.page_count) && (value.page_count as number) > 0 ? value.page_count as number : undefined;
  if (pageCount === undefined) return null;
  const members: ScanContext['members'] = [];
  for (const member of value.members) {
    if (!isRecord(member) || !uuid(member.id) || typeof member.name !== 'string') return null;
    members.push({ id: member.id, name: member.name });
  }
  const days: ScanContext['days'] = [];
  for (const day of value.days) {
    if (!isRecord(day) || !uuid(day.id) || !uuid(day.member_id)
      || typeof day.work_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.work_date)) return null;
    days.push({ id: day.id, memberId: day.member_id, workDate: day.work_date });
  }
  return {
    storagePath: value.storage_path, contentType: value.content_type, byteSize: value.byte_size as number,
    fileName: value.file_name, pageCount, scan: { members, days, pageCount },
  };
}

export function createHoursScanHandler(ports: HoursScanPorts, corsHeaders: Record<string, string> = {}) {
  const headers = { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const rpcError = (error: { code?: string }) => {
    switch (error.code) {
      case '42501': return json({ error: 'Geen toegang tot deze bron of onvoldoende rechten.', code: '42501' }, 403);
      case '22023': case '22P02': case '23514':
        return json({ error: 'Deze bron kan niet worden uitgelezen.', code: error.code }, 400);
      case 'PT409': case '40001':
        return json({ error: 'De week is ondertussen gewijzigd. Vernieuw en probeer het opnieuw.', code: error.code }, 409);
      default: return json({ error: 'Uitlezen is tijdelijk niet beschikbaar. Probeer het opnieuw.', code: 'scan_unavailable' }, 503);
    }
  };

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Gebruik POST om een bron uit te lezen.', code: 'method_not_allowed' }, 405);
    try {
      const auth = await ports.authorize(req);
      if (auth instanceof Response) return auth;
      // Only one identifier is accepted. The model, the tenant, the file and the
      // week are server-owned; a caller may not choose any of them.
      const raw = await readBounded(req, MAX_REQUEST_BYTES);
      if (raw === null) return json({ error: 'De aanvraag is te groot.', code: 'invalid_input' }, 400);
      let input: unknown;
      try { input = JSON.parse(raw); } catch { return json({ error: 'Ongeldige JSON-aanvraag.', code: 'invalid_input' }, 400); }
      if (!isRecord(input) || Object.keys(input).length !== 1 || !uuid(input.source_id)) {
        return json({ error: 'Alleen source_id is toegestaan en moet een geldige identificatie zijn.', code: 'invalid_input' }, 400);
      }
      const sourceId = input.source_id;

      const response = await ports.userRpc(req, 'hours_get_source_reading_context', { p_source_id: sourceId });
      if (response.error) return rpcError(response.error);
      const context = readContext(response.data, auth, sourceId);
      if (!context) {
        return json({ error: 'De brongegevens zijn onvolledig. Er is niets uitgelezen.', code: 'invalid_context' }, 500);
      }
      if (!(HOURS_READABLE_SCAN_TYPES as readonly string[]).includes(context.contentType)) {
        return json({ error: 'Alleen een PDF of foto kan worden uitgelezen.', code: 'unsupported_source' }, 400);
      }
      if (!context.scan.days.length) {
        return json({ error: 'Deze week heeft nog geen werkdagen om aan te herkennen. Voeg eerst de medewerkers toe.',
          code: 'week_without_days' }, 400);
      }
      if (context.byteSize > HOURS_SCAN_MAX_FILE_BYTES) {
        return json({ error: 'Dit bestand is te groot om te laten uitlezen. Bekijk het zelf en leg de uren handmatig als voorstel vast.',
          code: 'source_too_large' }, 400);
      }
      let bytes: Uint8Array;
      try {
        bytes = await ports.download(context.storagePath);
      } catch {
        return json({ error: 'De bewaarde bron kon niet worden opgehaald. Er is niets uitgelezen.', code: 'source_unavailable' }, 503);
      }
      if (!bytes?.byteLength || bytes.byteLength > HOURS_SCAN_MAX_FILE_BYTES) {
        return json({ error: 'De bewaarde bron kon niet worden opgehaald. Er is niets uitgelezen.', code: 'source_unavailable' }, 503);
      }

      let outcome: HoursScanOutcome;
      try {
        outcome = await ports.read({
          organizationId: auth.organizationId, userId: auth.userId,
          file: { mimeType: context.contentType, bytes, fileName: context.fileName },
          // Only the dates travel. Sending the names would let the model pull a
          // scrawled name towards the list, and a corrected name would arrive
          // here looking certain.
          weekDates: [...new Set(context.scan.days.map(day => day.workDate))].sort(),
          pageCount: context.pageCount,
        });
      } catch (failure) {
        if (failure instanceof AiAccountingError) {
          const message = failure.status === 402
            ? 'Het AI-budget van deze maand is op, dus uitlezen kan nu niet. Handmatig een voorstel vastleggen werkt gewoon.'
            : failure.message;
          console.error('hours_scan_failed', JSON.stringify({ code: failure.code, status: failure.status,
            request_id: failure.requestId, cost_cents: failure.costCents }));
          return json({ error: message, code: failure.code, request_id: failure.requestId,
            cost_cents: failure.costCents, balance_cents: failure.balanceCents }, failure.status);
        }
        // The provider was already paid and settled: attachAiAccounting hangs
        // the settlement on a plain error, so this is the only place the cost
        // and the request id can still reach the office. Telling someone to try
        // again here would charge them a second time for the same refusal.
        const settled = failure as Partial<AiAccountingResult> & { message?: string };
        if (settled?.providerAttempted === true) {
          console.error('hours_scan_settled_failure', JSON.stringify({ request_id: settled.requestId,
            cost_cents: settled.costCents, input_tokens: settled.inputTokens, output_tokens: settled.outputTokens }));
          return json({ error: `${settled.message ?? 'Het uitlezen is mislukt.'} `
            + 'Deze uitlezing is wel in rekening gebracht; leg de uren handmatig vast of pas de bron aan.',
            code: 'scan_reading_unusable', request_id: settled.requestId,
            cost_cents: settled.costCents, balance_cents: settled.balanceCents }, 502);
        }
        return json({ error: 'Het uitlezen is mislukt. Probeer het opnieuw of leg de uren handmatig vast.',
          code: 'scan_failed' }, 503);
      }

      // A paid call happened, so its cost is reported even when the answer turns
      // out to be unusable. An unusable answer is a blocked reading, never half
      // a set of proposals.
      const reading: ScanReading = interpretScanReading(outcome.output, context.scan);
      return json({ reading, model: outcome.model, request_id: outcome.requestId,
        cost_cents: outcome.costCents, balance_cents: outcome.balanceCents, duration_ms: outcome.durationMs });
    } catch {
      // Never expose JWTs, provider payloads, database details or source content.
      return json({ error: 'Uitlezen is tijdelijk niet beschikbaar. Probeer het opnieuw.', code: 'scan_unavailable' }, 503);
    }
  };
}
