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
  applyApprovedUpdates,
  buildUpdatePreviews,
  loadPreviewSelection,
  type PreviewSelection,
  UPDATE_TARGETS,
} from '../_shared/carerix/preview.ts';
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

  // Een onvolledige preload zou elke bestaande koppeling als "nieuw" laten
  // tellen — in een live run dus duplicaten. Faalt hij, markeer dan deze entiteit
  // als failed en ga door naar de volgende, i.p.v. de job te laten hangen.
  const idMapper = new IdMapper(admin, orgId);
  try {
    await idMapper.preload(REQUIRED_MAPPINGS[nextEntity]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('carerix_import_entity_runs')
      .update({
        status: 'failed',
        last_error: msg,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('job_id', job_id)
      .eq('entity', nextEntity);
    runBackgroundTask(selfTrigger(job_id), 'carerix worker self-trigger');
    return jsonOk({ ok: true, entity_failed: nextEntity, error: msg });
  }

  // Live run gekoppeld aan een dry-run: laad wat de gebruiker daar heeft
  // uitgevinkt. Mislukt dat, dan stoppen we deze entiteit — doorgaan zou records
  // importeren die bewust waren weggevinkt.
  let previewSelection: PreviewSelection | null = null;
  if (job.mode !== 'dry_run' && job.preview_job_id) {
    try {
      previewSelection = await loadPreviewSelection(admin, job.preview_job_id as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin
        .from('carerix_import_entity_runs')
        .update({
          status: 'failed',
          last_error: msg,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', job_id)
        .eq('entity', nextEntity);
      runBackgroundTask(selfTrigger(job_id), 'carerix worker self-trigger');
      return jsonOk({ ok: true, entity_failed: nextEntity, error: msg });
    }
  }

  const ctx: RunnerContext = {
    admin,
    gql,
    idMapper,
    organizationId: orgId,
    dryRun: job.mode === 'dry_run',
    modifiedSince: job.modified_since ?? null,
    createdByUserId: job.created_by ?? null,
    previewSelection,
  };

  const { data: run } = await admin
    .from('carerix_import_entity_runs')
    .select('page_cursor, status')
    .eq('job_id', job_id)
    .eq('entity', nextEntity)
    .single();

  if (run?.status === 'queued') {
    // Aangevinkte update-regels uit de dry-run toepassen — één keer per
    // entiteit, vóór de eerste pagina. Dit is preview-gestuurd (los van de
    // Carerix-paginering): de gebruiker heeft die exacte waarden goedgekeurd.
    // Bewust VÓÓR de statuswissel naar 'running': crasht de worker middenin,
    // dan staat de entiteit nog op 'queued' en wordt de (idempotente) apply
    // bij de herstart gewoon opnieuw gedaan — stil verlies is hier het
    // gevaarlijkst.
    if (job.mode !== 'dry_run' && job.preview_job_id && UPDATE_TARGETS[nextEntity]) {
      try {
        const result = await applyApprovedUpdates(
          admin,
          job.preview_job_id as string,
          UPDATE_TARGETS[nextEntity],
          orgId,
        );
        if (result.failures.length > 0) {
          await admin.from('carerix_import_failures').insert(
            result.failures.map((f) => ({
              job_id,
              entity: nextEntity,
              carerix_id: f.carerix_id,
              error: f.error,
              payload: null,
            })),
          );
        }
        if (result.applied > 0 || result.failures.length > 0) {
          await admin
            .from('carerix_import_entity_runs')
            .update({
              changed: result.applied,
              failed: result.failures.length,
              updated_at: new Date().toISOString(),
            })
            .eq('job_id', job_id)
            .eq('entity', nextEntity);
        }
      } catch (err) {
        // Niet stil doorgaan: de gebruiker rekent op zijn goedgekeurde
        // updates. Zichtbaar maken als failure-regel, de import zelf mag door.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[carerix] goedgekeurde updates toepassen mislukt (${nextEntity}): ${msg}`);
        await admin.from('carerix_import_failures').insert({
          job_id,
          entity: nextEntity,
          carerix_id: 'preview-updates',
          error: `goedgekeurde updates toepassen mislukt: ${msg}`,
          payload: null,
        });
      }
    }

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

    // Voorvertoning van deze pagina persistent maken. Dit pad spiegelt de
    // id-mapper-les uit PR #230: half wegschrijven is erger dan hard falen.
    // Een dry-run die als 'completed' eindigt terwijl er pagina's previewregels
    // ontbreken, laat de gekoppelde live run records ongezien passeren — dus
    // elke schrijffout hier markeert de entiteit als failed, waarna de dry-run
    // niet als selectiebron gebruikt kan worden (sync-start eist 'completed').
    let changedThisPage = 0;
    try {
      let previewRows = stats.previews;
      if (ctx.dryRun && stats.updates.length > 0) {
        const updateRows = await buildUpdatePreviews(admin, stats.updates, orgId);
        changedThisPage = updateRows.length;
        previewRows = [...stats.previews, ...updateRows];
      }

      // `upsert` met ignoreDuplicates omdat de worker een pagina opnieuw kan
      // verwerken na een crash vóór de cursor-update; de unieke sleutel
      // (job, entiteit, carerix-id) vangt dat af.
      if (previewRows.length > 0) {
        const { error: previewErr } = await admin
          .from('carerix_import_previews')
          .upsert(
            previewRows.map((p) => ({
              job_id,
              organization_id: orgId,
              entity: p.entity,
              carerix_id: p.carerix_id,
              action: p.action,
              label: p.label,
              details: p.details,
              diff: p.diff,
              existing_id: p.existing_id,
              spam_reason: p.spam_reason,
              excluded: p.excluded,
            })),
            { onConflict: 'job_id,entity,carerix_id', ignoreDuplicates: true },
          );
        if (previewErr) {
          throw new Error(`voorvertoning wegschrijven mislukt: ${previewErr.message}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin
        .from('carerix_import_entity_runs')
        .update({
          status: 'failed',
          last_error: msg,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
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
      .select('created, skipped, failed, found, changed')
      .eq('job_id', job_id)
      .eq('entity', nextEntity)
      .single();

    // Bij afronden van een dry-run-entiteit: de teller vervangen door het échte
    // aantal previewregels. De per-pagina-accumulatie kan driften (een record
    // dat door Carerix-paginatieverschuiving twee keer voorbijkomt wordt door
    // de upsert gededupt maar zou dubbel tellen).
    let changedFinal = (current?.changed ?? 0) + changedThisPage;
    if (done && ctx.dryRun && UPDATE_TARGETS[nextEntity]) {
      const { count } = await admin
        .from('carerix_import_previews')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', job_id)
        .eq('entity', UPDATE_TARGETS[nextEntity].entityType)
        .eq('action', 'update');
      if (typeof count === 'number') changedFinal = count;
    }

    await admin
      .from('carerix_import_entity_runs')
      .update({
        page_cursor: pageCursor,
        total_elements: stats.totalElements,
        created: (current?.created ?? 0) + stats.created,
        skipped: (current?.skipped ?? 0) + stats.skipped,
        failed: (current?.failed ?? 0) + stats.failed,
        changed: changedFinal,
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
    .select('entity, created, skipped, failed, changed, found, status, last_error')
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
      // Dry-run: aantal records met afwijkende Carerix-data in de voorvertoning.
      // Live run: aantal daadwerkelijk toegepaste (aangevinkte) updates.
      changed: r.changed ?? 0,
      missing_scope: errorText.includes('scope') || errorText.includes('query rejected'),
      dependency_missing: errorText.includes('dependency not imported') || errorText.includes('not yet imported'),
      top_failure_reasons: topFailureReasons,
    };
  }

  const { data: job } = await admin
    .from('carerix_import_jobs')
    .select('organization_id, mode')
    .eq('id', jobId)
    .single();

  // Bytes-fase: de sync-worker maakt alleen document-metadata (file_path NULL);
  // de bytes komen uit carerix-attachment-download. Die functie werd door niets
  // aangeroepen, waardoor kandidaten documentrijen kregen die je niet kon openen
  // ("Bestand nog niet gedownload uit bron"). Daarom starten we hem hier.
  let shouldTriggerBytes = false;
  if (job?.organization_id) {
    // Tellen met head+count, niet door rijen op te halen: PostgREST kapt een gewone
    // select STIL af op 1000 rijen. Deze view heeft er bij JA Werkt al 4.238, dus een
    // rijen-telling gaf `total: 1000` en een willekeurige `pending` — waardoor de
    // trigger hieronder kon uitblijven terwijl er honderden documenten zonder bestand
    // stonden. Dat is precies de bug die deze code moet oplossen.
    const countByStatus = async (status?: string) => {
      let query = admin
        .from('v_carerix_document_validation')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', job.organization_id);
      if (status) query = query.eq('download_status', status);
      const { count } = await query;
      return count ?? 0;
    };

    const [total, downloaded, failed] = await Promise.all([
      countByStatus(),
      countByStatus('downloaded'),
      countByStatus('failed'),
    ]);

    const documentBytes: {
      downloaded: number;
      pending: number;
      failed: number;
      total: number;
      trigger_started_at?: string;
    } = {
      downloaded,
      // Alles wat niet downloaded of failed is, wacht nog op bytes. Afgeleid i.p.v.
      // apart geteld, zodat een extra statuswaarde in de view niet stil wegvalt.
      pending: Math.max(0, total - downloaded - failed),
      failed,
      total,
    };

    // Alleen bij een live import: `pending` wordt org-breed geteld (niet per job),
    // dus een dry-run zou anders een echte byte-download over de hele organisatie
    // starten — precies wat een voorvertoning niet mag doen.
    shouldTriggerBytes = job.mode === 'live' && documentBytes.pending > 0;
    if (shouldTriggerBytes) {
      documentBytes.trigger_started_at = new Date().toISOString();
    }

    summary._document_bytes = documentBytes;
  }

  // Deze update is tegelijk de claim: finalizeJob draait bij elke worker-invocatie
  // die geen volgende entiteit vindt, en carerix-attachment-download claimt zelf
  // geen documentrijen. Zonder `.is('finished_at', null)` zouden twee gelijktijdige
  // ketens dezelfde batch pakken → dubbele Carerix-calls. Alleen de invocatie die
  // de job daadwerkelijk van niet-afgerond naar afgerond zet, mag triggeren.
  const { data: claimed } = await admin
    .from('carerix_import_jobs')
    .update({
      status: anyFailed ? 'failed' : 'completed',
      finished_at: new Date().toISOString(),
      summary,
    })
    .eq('id', jobId)
    .is('finished_at', null)
    .select('id');

  const justFinalized = (claimed?.length ?? 0) > 0;
  if (justFinalized && shouldTriggerBytes && job?.organization_id) {
    runBackgroundTask(
      triggerAttachmentDownload(admin, jobId, job.organization_id as string),
      'carerix attachment download trigger',
    );
  }
}

// Start de byte-download non-blocking; een falende download mag de
// job-finalisatie niet omverhalen, maar moet wel zichtbaar zijn in de summary.
async function triggerAttachmentDownload(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  orgId: string,
): Promise<void> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carerix-attachment-download`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        ...internalFunctionHeaders(),
      },
      body: JSON.stringify({ organization_id: orgId }),
    });
    if (!res.ok) {
      await recordBytesTriggerError(admin, jobId, `${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordBytesTriggerError(admin, jobId, msg.slice(0, 300));
  }
}

async function recordBytesTriggerError(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  message: string,
): Promise<void> {
  const { data: job } = await admin
    .from('carerix_import_jobs')
    .select('summary')
    .eq('id', jobId)
    .single();
  if (!job) return;

  const summary = (job.summary ?? {}) as Record<string, unknown>;
  const bytes = (summary._document_bytes ?? {}) as Record<string, unknown>;
  summary._document_bytes = { ...bytes, trigger_error: message };

  await admin.from('carerix_import_jobs').update({ summary }).eq('id', jobId);
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
