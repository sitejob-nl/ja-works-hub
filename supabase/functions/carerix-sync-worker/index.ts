// Worker: processes the next ready entity_run page for a given job.
// Self-triggers for subsequent pages or the next entity.

import {
  corsHeaders,
  createAdminClient,
  jsonError,
  jsonOk,
  loadCarerixCredentials,
} from '../_shared/carerix/helpers.ts';
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
  notes: ['candidate', 'company', 'note'],
  employment: [],
};

function selfTrigger(jobId: string): Promise<Response> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carerix-sync-worker`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ job_id: jobId }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

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
    selfTrigger(job_id).catch(() => {});
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
      selfTrigger(job_id).catch(() => {});
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
      selfTrigger(job_id).catch(() => {});
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
    const processedSoFar = pageCursor * PAGE_SIZE;
    const skipped = Boolean(stats.skipReason);
    const done = skipped || stats.totalElements === 0 || processedSoFar >= stats.totalElements;

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
      selfTrigger(job_id).catch(() => {});
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
    .select('entity, created, skipped, failed, found, status')
    .eq('job_id', jobId);

  const anyFailed = runs?.some((r) => r.status === 'failed') ?? false;

  const summary: Record<string, unknown> = {};
  for (const r of runs ?? []) {
    summary[r.entity as string] = {
      status: r.status,
      found: r.found,
      created: r.created,
      skipped: r.skipped,
      failed: r.failed,
    };
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
