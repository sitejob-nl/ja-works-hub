import { createAdminClient, jsonResponse, requireRolePermission } from '../_shared/auth.ts';
import { CORS_HEADERS } from '../_shared/http.ts';
import { loadBrandTheme } from '../_shared/email-layout.ts';
import { sendViaOutlookAccount } from '../_shared/outlook-send.ts';
import { createHoursOutboxHandler, type HoursOutboxAuth } from '../_shared/hours-outbox.ts';

/**
 * The outgoing hours mail, as a cron target and as a manual run.
 *
 * Two entrances, one body. The unattended run validates `x-cron-secret` exactly
 * like the five existing cron jobs and walks every organisation that has the
 * hours module switched on; a person with `finance.manage` runs the very same
 * code over their own tenant.
 *
 * There is exactly one way out of this function: `sendViaOutlookAccount`. That
 * is where the kill-switch lives, so a blocked message is logged as a concept in
 * `communications` instead of disappearing, and where the communication log and
 * the audit entry are written. The body it receives was already wrapped in the
 * brand layout when the draft was made, so what a person approved is what goes
 * out, byte for byte.
 */

const CORS = { ...CORS_HEADERS,
  'Access-Control-Allow-Headers': `${CORS_HEADERS['Access-Control-Allow-Headers']}, x-cron-secret` };

async function authorize(req: Request): Promise<HoursOutboxAuth | Response> {
  const secret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (provided) {
    // Zonder ingestelde sleutel is elke cron-aanroep onherkenbaar. Stil met 403
    // antwoorden zou de urenmail maandenlang laten stilstaan zonder dat iemand
    // het merkt; dit staat in de log en zegt wat er ontbreekt.
    if (!secret) {
      console.error('hours-outbox authorize_unconfigured detail=CRON_SECRET ontbreekt');
      return jsonResponse({
        error: 'De cron-sleutel is niet ingesteld; de urenmail kan niet onbemand draaien.',
        code: 'cron_secret_missing',
      }, 503, CORS);
    }
    if (provided === secret) return { mode: 'cron' };
    return jsonResponse({ error: 'Onbekende cron-sleutel' }, 403, CORS);
  }
  const auth = await requireRolePermission(req, 'finance.manage', CORS);
  if (auth instanceof Response) return auth;
  return { mode: 'user', organizationId: auth.organizationId };
}

Deno.serve(createHoursOutboxHandler({
  authorize,
  serviceRpc: (name, args) => createAdminClient().rpc(name, args),
  loadTheme: (organizationId) => loadBrandTheme(createAdminClient(), organizationId),
  sendMail: async (message) => {
    const result = await sendViaOutlookAccount({
      orgId: message.organizationId,
      to: message.to,
      subject: message.subject,
      htmlBody: message.htmlBody,
      companyId: message.companyId,
      companyContactId: message.companyContactId ?? undefined,
      candidateId: message.candidateId ?? undefined,
      // The body already carries the brand wrapper, so no signature is appended
      // on top of it; this is the same `senderName: null` every wrapped sender uses.
      senderName: null,
      // The reply has to be recognisable later, so the request reference can
      // learn which thread the client's answer will arrive in.
      captureIdentifiers: true,
      require: 'mail_send',
    });
    return {
      ok: result.success,
      paused: result.communicationPaused === true,
      // Aangemaakt maar de verzendopdracht faalde: niet opnieuw proberen.
      deliveryUncertain: result.deliveryUncertain === true,
      status: result.status,
      messageId: result.messageId ?? null,
      conversationId: result.conversationId ?? null,
      error: result.error,
    };
  },
}, CORS));
