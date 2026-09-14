import { createAdminClient, jsonResponse, requireInternalProfile } from '../_shared/auth.ts';
import { decodeFeedbackScreenshot, FEEDBACK_RECIPIENT, isFeedbackUuid, validateFeedbackInput, validateFeedbackResolution, type FeedbackReport } from '../_shared/feedback-contract.ts';
import { deliverFeedback } from './delivery.ts';
import { loadBrandTheme } from '../_shared/email-layout.ts';
import { loadDefaultOrganizationSender } from '../_shared/outlook-accounts.ts';
import { isOutboundPaused } from '../_shared/outbound-pause.ts';
import { sendViaOutlookAccount } from '../_shared/outlook-send.ts';
import { acknowledgeFeedback, changeFeedbackStatus, MY_FEEDBACK_COLUMNS } from './resolution.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BODY_BYTES = 3 * 1024 * 1024;

// Enforce a bound even for chunked requests without Content-Length.
async function readJson(req: Request): Promise<unknown> {
  if (!req.body) throw new Error('Lege melding.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('De melding is te groot.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('Ongeldige melding.'); }
}

async function requireSuperadmin(req: Request, admin: ReturnType<typeof createAdminClient>) {
  const bearer = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return false;
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return false;
  const result = await admin.from('superadmins').select('id').eq('user_id', data.user.id).maybeSingle();
  return !result.error && result.data ? data.user.id : null;
}

export async function handleFeedback(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Gebruik POST.' }, 405, cors);
  if (!req.headers.get('Authorization')?.startsWith('Bearer ')) return jsonResponse({ error: 'Log opnieuw in.' }, 401, cors);
  let body: Record<string, unknown>;
  try {
    body = await readJson(req) as Record<string, unknown>;
    if (!body || typeof body !== 'object') throw new Error('Ongeldige melding.');
  } catch (error) { return jsonResponse({ error: (error as Error).message }, 400, cors); }
  const admin = createAdminClient();
  const deliveryDeps = { loadBrandTheme, loadDefaultOrganizationSender, isOutboundPaused, sendViaOutlookAccount, appUrl: Deno.env.get('APP_URL') };

  try {
    if (['mine', 'my-detail', 'my-notifications', 'acknowledge'].includes(String(body.action))) {
      const auth = await requireInternalProfile(req, cors);
      if (auth instanceof Response) return auth;
      if (body.action === 'acknowledge') {
        if (!isFeedbackUuid(body.id) || !Number.isInteger(body.revision) || Number(body.revision) < 0 || typeof body.dismiss !== 'boolean') return jsonResponse({ error: 'Ongeldige notificatie.' }, 400, cors);
        return jsonResponse(await acknowledgeFeedback(admin, auth.userId, auth.organizationId, body.id, Number(body.revision), body.dismiss), 200, cors);
      }
      const query = admin.from('feedback_reports').select(MY_FEEDBACK_COLUMNS).eq('submitted_by', auth.userId).eq('organization_id', auth.organizationId);
      if (body.action === 'my-detail') {
        if (!isFeedbackUuid(body.id)) return jsonResponse({ error: 'Ongeldige melding.' }, 400, cors);
        const { data, error } = await query.eq('id', body.id).maybeSingle();
        if (error) throw error;
        return data ? jsonResponse({ report: data }, 200, cors) : jsonResponse({ error: 'Melding niet gevonden.' }, 404, cors);
      }
      if (body.action === 'my-notifications') {
        const { data, error } = await query.eq('status', 'resolved').is('resolution_dismissed_at', null).order('resolved_at', { ascending: false }).limit(50);
        if (error) throw error;
        return jsonResponse({ reports: data }, 200, cors);
      }
      const page = Number.isInteger(body.page) && Number(body.page) >= 0 ? Math.min(Number(body.page), 10000) : 0;
      const { data, error } = await query.order('created_at', { ascending: false }).range(page * 50, page * 50 + 49);
      if (error) throw error;
      return jsonResponse({ reports: data }, 200, cors);
    }

    if (body.action === 'list' || body.action === 'detail' || body.action === 'retry' || body.action === 'set-status') {
      const superadminId = await requireSuperadmin(req, admin);
      if (!superadminId) return jsonResponse({ error: 'Alleen toegankelijk voor SiteJob.' }, 403, cors);
      if (body.action === 'set-status') {
        try { validateFeedbackResolution(body); }
        catch (error) { return jsonResponse({ error: (error as Error).message }, 400, cors); }
        const result = await changeFeedbackStatus(admin, superadminId, body);
        if (!result) return jsonResponse({ error: 'Melding niet gevonden.' }, 404, cors);
        if ('conflict' in result) return jsonResponse({ error: 'De melding is intussen gewijzigd. Ververs de melding.' }, 409, cors);
        return jsonResponse({ status: result.report.status, resolution_revision: result.report.resolution_revision, changed: result.changed }, 200, cors);
      }
      if (body.action === 'list') {
        const page = Number.isInteger(body.page) && Number(body.page) >= 0 ? Math.min(Number(body.page), 10000) : 0;
        const { data, error } = await admin.from('feedback_reports')
          .select('id,number,kind,title,reporter_name,reporter_email,organization_id,created_at,email_status,has_screenshot,status')
          .order('created_at', { ascending: false }).range(page * 50, page * 50 + 49);
        if (error) throw error;
        return jsonResponse({ reports: data }, 200, cors);
      }
      if (!isFeedbackUuid(body.id)) return jsonResponse({ error: 'Ongeldige melding.' }, 400, cors);
      const { data: report, error } = await admin.from('feedback_reports').select('*').eq('id', body.id).maybeSingle();
      if (error) throw error;
      if (!report) return jsonResponse({ error: 'Melding niet gevonden.' }, 404, cors);
      if (body.action === 'retry') {
        // Never resend an ambiguous attempt; only retry work known not to have sent.
        if (!['pending', 'failed', 'paused'].includes(report.email_status) || (report.has_screenshot && !report.screenshot_path)) {
          return jsonResponse({ error: 'Deze melding kan niet veilig opnieuw worden verstuurd.' }, 409, cors);
        }
        return jsonResponse(await deliverFeedback(admin, report, null, deliveryDeps), 200, cors);
      }
      let screenshotUrl: string | null = null;
      if (report.screenshot_path) {
        const result = await admin.storage.from('feedback-screenshots').createSignedUrl(report.screenshot_path, 300);
        if (result.error) throw result.error;
        screenshotUrl = result.data.signedUrl;
      }
      const { request_hash: _hash, ...publicReport } = report;
      return jsonResponse({ report: publicReport, screenshotUrl }, 200, cors);
    }

    if (body.action !== 'submit') return jsonResponse({ error: 'Onbekende actie.' }, 400, cors);
    const auth = await requireInternalProfile(req, cors);
    if (auth instanceof Response) return auth;
    let input, screenshot: Uint8Array | null;
    try {
      input = validateFeedbackInput(body.report);
      screenshot = input.screenshot ? decodeFeedbackScreenshot(input.screenshot) : null;
    } catch (error) { return jsonResponse({ error: (error as Error).message }, 400, cors); }
    const { data: profile, error: profileError } = await admin.from('profiles').select('full_name,email').eq('id', auth.userId).single();
    if (profileError) throw profileError;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
    const requestHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const { screenshot: _image, ...fields } = input;
    // Authenticated identity and destination are never taken from the browser.
    const { data, error } = await admin.rpc('create_feedback_report', { p_report: {
      ...fields, organization_id: auth.organizationId, submitted_by: auth.userId,
      reporter_name: profile.full_name, reporter_email: auth.user.email || profile.email,
      diagnostics: { ...fields.diagnostics, role: auth.role },
      request_hash: requestHash, has_screenshot: !!screenshot,
    } });
    if (error) {
      if (error.message?.includes('feedback_rate_limited')) return jsonResponse({ error: 'Je hebt veel meldingen verstuurd. Probeer het over een uur opnieuw.' }, 429, cors);
      if (error.message?.includes('feedback_conflict')) return jsonResponse({ error: 'Deze melding is al opgeslagen met andere inhoud.' }, 409, cors);
      throw error;
    }
    const report = data?.[0] as FeedbackReport | undefined;
    if (!report) throw new Error('Missing feedback record');
    return jsonResponse(await deliverFeedback(admin, report, screenshot, deliveryDeps), 200, cors);
  } catch {
    // No payloads, addresses, tokens or raw provider errors in logs/responses.
    console.error('[feedback] request failed');
    return jsonResponse({ error: `De melding kon niet worden afgerond. Probeer opnieuw of neem contact op via ${FEEDBACK_RECIPIENT}.` }, 500, cors);
  }
}

Deno.serve(handleFeedback);
