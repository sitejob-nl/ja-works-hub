// Create a new import job and kick off the worker.

import {
  corsHeaders,
  createAdminClient,
  getCallerProfile,
  jsonError,
  jsonOk,
  runBackgroundTask,
} from '../_shared/carerix/helpers.ts';
import { internalFunctionHeaders } from '../_shared/auth.ts';
import { ALL_ENTITIES, type EntityName } from '../_shared/carerix/types.ts';

interface StartBody {
  mode?: 'dry_run' | 'live';
  only?: EntityName[];
  skip?: EntityName[];
  modified_since?: string | null;
  // Dry-run-job waarvan de record-selectie gerespecteerd moet worden.
  preview_job_id?: string | null;
}

async function triggerWorker(jobId: string): Promise<void> {
  const workerUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carerix-sync-worker`;
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      ...internalFunctionHeaders(),
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  if (!res.ok) {
    throw new Error(`worker trigger failed (${res.status}): ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonError('Unauthorized', 401);
  if (caller.profile.role !== 'admin') return jsonError('Alleen admins', 403);

  const body = (await req.json().catch(() => ({}))) as StartBody;
  const mode = body.mode === 'dry_run' ? 'dry_run' : 'live';
  const only = body.only?.filter((e) => ALL_ENTITIES.includes(e)) ?? null;
  const skip = body.skip?.filter((e) => ALL_ENTITIES.includes(e)) ?? [];

  const admin = createAdminClient();
  const orgId = caller.profile.organization_id;

  // Refuse if there is already an active job for this org.
  const { data: active } = await admin
    .from('carerix_import_jobs')
    .select('id, status')
    .eq('organization_id', orgId)
    .in('status', ['queued', 'running'])
    .maybeSingle();
  if (active) return jsonError(`Er loopt al een import (job ${active.id})`, 409);

  // Check config exists
  const { data: cfg } = await admin
    .from('carerix_config')
    .select('is_connected')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!cfg?.is_connected) return jsonError('Carerix is niet gekoppeld', 400);

  // Een selectie mag alleen van een afgeronde dry-run van de eigen organisatie
  // komen. Zonder deze controle zou een live run de selectie van een andere
  // tenant kunnen aanhalen, of die van een run die nog niet klaar is en dus een
  // onvolledige voorvertoning heeft.
  let previewJobId: string | null = null;
  if (body.preview_job_id) {
    if (mode !== 'live') return jsonError('Een selectie geldt alleen voor een live import', 400);

    const { data: previewJob } = await admin
      .from('carerix_import_jobs')
      .select('id, mode, status, organization_id')
      .eq('id', body.preview_job_id)
      .maybeSingle();

    if (!previewJob || previewJob.organization_id !== orgId) {
      return jsonError('Onbekende dry-run', 404);
    }
    if (previewJob.mode !== 'dry_run') {
      return jsonError('De geselecteerde job is geen dry-run', 400);
    }
    if (previewJob.status !== 'completed') {
      return jsonError('De dry-run is nog niet afgerond', 400);
    }
    previewJobId = previewJob.id as string;
  }

  // Create job
  const { data: job, error: jobErr } = await admin
    .from('carerix_import_jobs')
    .insert({
      organization_id: orgId,
      created_by: caller.profile.id,
      mode,
      status: 'queued',
      only_entities: only,
      skip_entities: skip,
      modified_since: body.modified_since ?? null,
      preview_job_id: previewJobId,
    })
    .select('id')
    .single();
  if (jobErr || !job) return jsonError(`Kon job niet aanmaken: ${jobErr?.message}`, 500);

  // Create entity_runs rows. Skip = skipped status, only = respect filter.
  const runsToInsert = ALL_ENTITIES.map((entity) => {
    let status: 'queued' | 'skipped' = 'queued';
    if (only && !only.includes(entity)) status = 'skipped';
    if (skip.includes(entity)) status = 'skipped';
    return { job_id: job.id, entity, status };
  });
  const { error: runsErr } = await admin.from('carerix_import_entity_runs').insert(runsToInsert);
  if (runsErr) return jsonError(`Kon entity_runs niet aanmaken: ${runsErr.message}`, 500);

  runBackgroundTask(triggerWorker(job.id), 'carerix worker trigger');

  return jsonOk({ job_id: job.id });
});
