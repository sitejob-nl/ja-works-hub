// Worker: processes the next ready entity_run page for a given job.
// Self-triggers for subsequent pages or the next entity.

import {
  corsHeaders,
  createAdminClient,
  jsonError,
  jsonOk,
  loadCarerixCredentials,
  runBackgroundTask,
} from '../_shared/carerix/helpers.ts';
import { internalFunctionHeaders, isServiceRoleRequest } from '../_shared/auth.ts';
import { fetchCarerixAccessToken } from '../_shared/carerix/auth.ts';
import { CarerixGraphQLClient } from '../_shared/carerix/client.ts';
import { IdMapper } from '../_shared/carerix/id-mapper.ts';
import { ENTITY_RUNNERS, type RunnerContext } from '../_shared/carerix/runner.ts';
import {
  ALL_ENTITIES,
  ENTITY_DEPENDENCIES,
  SUPPORTED_ENTITIES,
  UNSUPPORTED_REASONS,
  type EntityName,
} from '../_shared/carerix/types.ts';

const PAGE_SIZE = 100;
const SOFT_DEADLINE_MS = 90_000;

const REQUIRED_MAPPINGS: Record<EntityName, string[]> = {
  companies: ['company'],
  contacts: ['company', 'contact'],
  candidates: ['candidate'],
  vacancies: ['company', 'vacancy'],
  matches: ['candidate', 'vacancy', 'match'],
  placements: ['candidate', 'company', 'vacancy', 'match', 'placement'],
  documents: ['candidate', 'document'],
  notes: ['candidate', 'company', 'match', 'vacancy', 'contact', 'note'],
  employment: [],
};

async function selfTrigger(jobId: string): Promise<void> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carerix-sync-worker`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      ...internalFunctionHeaders(),
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  if (!res.ok) {
    throw new Error(`worker self-trigger failed (${res.status}): ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);
  if (!isServiceRoleRequest(req)) return jsonError('Unauthorized', 401);

  const started = Date.now();
  const admin = createAdminClient();
  const { job_id } = (await req.json().catch(() => ({}))) as { job_id?: string };
  if (!job_id) return jsonError('job_id is verplicht', 400);

  const { data: job, error: jobErr } = await admin
    .from('carerix_import_jobs')
    .select('*')
    .eq('id', job_id)
    .single();
  if (jobErr || !job) return jsonError(`Job niet gevonden: ${jobErr?.message}`, 404);

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return jsonOk({ ok: true, status: job.status });
  }

  const orgId = job.organization_id as string;

  if (job.status === 'queued') {
    await admin
      .from('carerix_import_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', job_id);

    // Immediately mark any unsupported entities as skipped with reason, so the
    // UI shows a clear explanation instead of leaving them "queued" forever.
    const unsupportedNow = ALL_ENTITIES.filter(
      (e) => UNSUPPORTED_REASONS[e] && !SUPPORTED_ENTITIES.includes(e),
    );
    for (const e of unsupportedNow) {
      await admin
        .from('carerix_import_entity_runs')
        .update({
          status: 'skipped',
          last_error: UNSUPPORTED_REASONS[e] ?? null,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', job_id)
        .eq('entity', e)
        .eq('status', 'queued');
    }
  }

  const nextEntity = await pickNextEntity(admin, job_id);
  if (!nextEntity) {
    await finalizeJob(admin, job_id);
    return jsonOk({ ok: true, done: true });
  }

  const runner = ENTITY_RUNNERS[nextEntity];
  if (!runner) {
    // Defensive: mark skipped if somehow an unsupported entity slipped through.
    await admin
      .from('carerix_import_entity_runs')
      .update({
        status: 'skipped',
        last_error: UNSUPPORTED_REASONS[nextEntity] ?? 'Niet ondersteund',
        finished_at: new Date().toISOString(),
      })
      .eq('job_id', job_id)
      .eq('entity', nextEntity);
    runBackgroundTask(selfTrigger(job_id), 'carerix worker self-trigger');
    return jsonOk({ ok: true, skipped_unsupported: nextEntity });
  }

  const creds = await loadCarerixCredentials(admin, orgId);
  if (!creds) {
    await markJobFailed(admin, job_id, 'Carerix config ontbreekt of niet verbonden');
    return jsonError('Carerix config ontbreekt', 400);
  }

  let token: string;
  try {
    token = await fetchCarerixAccessToken(creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markJobFailed(admin, job_id, `OAuth: ${msg}`);
    return jsonError(`OAuth mislukt: ${msg}`, 400);
  }
  const gql = new CarerixGraphQLClient(token);

  const idMapper = new IdMapper(admin, orgId);
  await idMapper.preload(REQUIRED_MAPPINGS[nextEntity]);

  const ctx: RunnerContext = {
    admin,
    gql,
    idMapper,
    organizationId: orgId,
    dryRun: job.mode === 'dry_run',
    modifiedSince: job.modified_since ?? null,
    createdByUserId: job.created_by ?? null,
  };

  const { data: run } = await admin
    .from('carerix_import_entity_runs')
    .select('page_cursor, status')
    .eq('job_id', job_id)
    .eq('entity', nextEntity)
    .single();

  if (run?.status === 'queued') {
    await admin
      .from('carerix_import_entity_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('job_id', job_id)
      .eq('entity', nextEntity);
  }

  let pageCursor = run?.page_cursor ?? 0;

  while (true) {
    const { data: check } = await admin
      .from('carerix_import_jobs')
      .select('status')
      .eq('id', job_id)
      .single();
    if (check?.status === 'cancelled') {
      return jsonOk({ ok: true, cancelled: true });
    }

    if (Date.now() - started > SOFT_DEADLINE_MS) {
      runBackgroundTask(selfTrigger(job_id), 'carerix worker self-trigger');
      return jsonOk({ ok: true, continued: true, entity: nextEntity, page: pageCursor });
    }

    let stats;
    try {
      stats = await runner(ctx, pageCursor, PAGE_SIZE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin
        .from('carerix_import_entity_runs')
        .update({
          status: 'failed',
          last_error: msg,
          finished_at: new Date().toISOString(),
        })
        .eq('job_id', job_id)
        .eq('entity', nextEntity);
      runBackgroundTask(selfTrigger(job_id), 'carerix worker self-trigger');
      return jsonOk({ ok: true, entity_failed: nextEntity, error: msg });
    }

    if (stats.failures.length > 0) {
      await admin.from('carerix_import_failures').insert(
        stats.failures.map((f) => ({
          job_id,
          entity: nextEntity,
          carerix_id: f.carerix_id,
          error: f.error,
          payload: f.payload ?? null,
        })),
      );
    }

    pageCursor += 1;
    const skipped = Boolean(stats.skipReason);
    // Runner signaleert zelf via stats.done wanneer hij klaar is. Fallback:
    // totalElements===0 betekent "niets te doen". Geen page-size arithmetic
    // meer — die werkte niet voor de candidate-batch-runner (documents).
    const done = skipped || stats.done === true || stats.totalElements === 0;

    const { data: current } = await admin
      .from('carerix_import_entity_runs')
      .select('created, skipped, failed, found')
      .eq('job_id', job_id)
      .eq('entity', nextEntity)
      .single();

    await admin
      .from('carerix_import_entity_runs')
      .update({
        page_cursor: pageCursor,
        total_elements: stats.totalElements,
        created: (current?.created ?? 0) + stats.created,
        skipped: (current?.skipped ?? 0) + stats.skipped,
        failed: (current?.failed ?? 0) + stats.failed,
        found: Math.max(current?.found ?? 0, stats.totalElements),
        status: skipped ? 'skipped' : done ? 'completed' : 'running',
        last_error: stats.skipReason ?? null,
        finished_at: done ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('job_id', job_id)
      .eq('entity', nextEntity);

    if (done) {
      runBackgroundTask(selfTrigger(job_id), 'carerix worker self-trigger');
      return jsonOk({ ok: true, entity_done: nextEntity, skipped });
    }
  }
});

async function pickNextEntity(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<EntityName | null> {
  const { data: runs } = await admin
    .from('carerix_import_entity_runs')
    .select('entity, status')
    .eq('job_id', jobId);
  if (!runs) return null;

  const byEntity = new Map<EntityName, string>();
  for (const r of runs) byEntity.set(r.entity as EntityName, r.status as string);

  for (const e of ALL_ENTITIES) {
    const status = byEntity.get(e);
    if (status === 'queued' || status === 'running') {
      const deps = ENTITY_DEPENDENCIES[e];
      const depsReady = deps.every((d) => {
        const s = byEntity.get(d);
        return s === 'completed' || s === 'skipped' || s === 'failed';
      });
      if (depsReady) return e;
    }
  }
  return null;
}

async function finalizeJob(admin: ReturnType<typeof createAdminClient>, jobId: string) {
  const { data: runs } = await admin
    .from('carerix_import_entity_runs')
    .select('entity, created, skipped, failed, found, status, last_error')
    .eq('job_id', jobId);

  const anyFailed = runs?.some((r) => r.status === 'failed') ?? false;

  const summary: Record<string, unknown> = {};
  for (const r of runs ?? []) {
    const { data: failures } = await admin
      .from('carerix_import_failures')
      .select('error')
      .eq('job_id', jobId)
      .eq('entity', r.entity);

    const topFailureReasons = summarizeFailureReasons((failures ?? []).map((f) => String(f.error ?? 'Onbekende fout')));
    const errorText = [r.last_error, ...((failures ?? []).map((f) => String(f.error ?? '')))].join('\n').toLowerCase();

    summary[r.entity as string] = {
      status: r.status,
      found: r.found,
      created: r.created,
      skipped: r.skipped,
      failed: r.failed,
      missing_scope: errorText.includes('scope') || errorText.includes('query rejected'),
      dependency_missing: errorText.includes('dependency not imported') || errorText.includes('not yet imported'),
      top_failure_reasons: topFailureReasons,
    };
  }

  const { data: job } = await admin
    .from('carerix_import_jobs')
    .select('organization_id')
    .eq('id', jobId)
    .single();

  if (job?.organization_id) {
    const { data: docs } = await admin
      .from('v_carerix_document_validation')
      .select('download_status')
      .eq('organization_id', job.organization_id);

    const documentBytes = {
      downloaded: 0,
      pending: 0,
      failed: 0,
      total: docs?.length ?? 0,
    };
    for (const d of docs ?? []) {
      if (d.download_status === 'downloaded') documentBytes.downloaded += 1;
      else if (d.download_status === 'failed') documentBytes.failed += 1;
      else documentBytes.pending += 1;
    }

    summary._document_bytes = documentBytes;
  }

  await admin
    .from('carerix_import_jobs')
    .update({
      status: anyFailed ? 'failed' : 'completed',
      finished_at: new Date().toISOString(),
      summary,
    })
    .eq('id', jobId);
}

function summarizeFailureReasons(errors: string[]) {
  const counts = new Map<string, number>();
  for (const raw of errors) {
    const normalized = normalizeFailureReason(raw);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function normalizeFailureReason(error: string) {
  const lower = error.toLowerCase();
  if (lower.includes('scope') || lower.includes('query rejected')) return 'Ontbrekende Carerix CR*-scope';
  if (lower.includes('dependency not imported') || lower.includes('not yet imported')) return 'Dependency niet geïmporteerd';
  if (lower.includes('duplicate') || lower.includes('unique')) return 'Dubbel record';
  if (lower.includes('document') || lower.includes('attachment')) return 'Document/attachment fout';
  if (lower.includes('required') || lower.includes('zonder')) return 'Verplicht veld ontbreekt';
  return error.slice(0, 160);
}

async function markJobFailed(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  err: string,
) {
  await admin
    .from('carerix_import_jobs')
    .update({
      status: 'failed',
      last_error: err,
      finished_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}
