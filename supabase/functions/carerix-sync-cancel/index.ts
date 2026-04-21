// Cancel a running Carerix import job.

import {
  corsHeaders,
  createAdminClient,
  getCallerProfile,
  jsonError,
  jsonOk,
} from '../_shared/carerix/helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonError('Unauthorized', 401);
  if (caller.profile.role !== 'admin') return jsonError('Alleen admins', 403);

  const body = (await req.json().catch(() => ({}))) as { job_id?: string };
  if (!body.job_id) return jsonError('job_id is verplicht', 400);

  const admin = createAdminClient();

  // Verify the job belongs to caller's org
  const { data: job } = await admin
    .from('carerix_import_jobs')
    .select('id, organization_id, status')
    .eq('id', body.job_id)
    .maybeSingle();
  if (!job) return jsonError('Job niet gevonden', 404);
  if (job.organization_id !== caller.profile.organization_id) return jsonError('Forbidden', 403);
  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return jsonOk({ ok: true, already: job.status });
  }

  await admin
    .from('carerix_import_jobs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', body.job_id);

  return jsonOk({ ok: true });
});
