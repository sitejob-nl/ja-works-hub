import { escapeHtml, renderBrandedEmail, type BrandTheme } from '../_shared/email-layout.ts';
import { FEEDBACK_RECIPIENT, type FeedbackReceipt, type FeedbackReport } from '../_shared/feedback-contract.ts';

// Small dependency boundary: the delivery state machine is testable without a
// Deno runtime, a real mailbox, or remote Supabase imports.
interface Admin { from: (table: string) => any; storage: { from: (bucket: string) => any } }
interface DeliveryDependencies {
  appUrl?: string;
  loadBrandTheme: (admin: any, orgId: string) => Promise<BrandTheme>;
  loadDefaultOrganizationSender: (admin: any, orgId: string) => Promise<{ id: string; status: string | null } | null>;
  isOutboundPaused: (admin: any, orgId: string, channel: 'email') => Promise<boolean>;
  sendViaOutlookAccount: (params: {
    orgId: string; accountId: string; to: string; replyToEmail: string; subject: string; htmlBody: string;
    senderName: null; sentBy: string; logCommunication: false;
  }) => Promise<{ success: boolean; from?: string | null; communicationPaused?: boolean }>;
}
export function feedbackReceipt(report: FeedbackReport): FeedbackReceipt {
  return { id: report.id, number: report.number, email_status: report.email_status,
    screenshot_path: report.screenshot_path, has_screenshot: report.has_screenshot };
}

export async function deliverFeedback(
  admin: Admin, initial: FeedbackReport, screenshot: Uint8Array | null,
  deps: DeliveryDependencies,
): Promise<FeedbackReceipt> {
  const claim = await admin.from('feedback_reports').update({ email_status: 'preparing', updated_at: new Date().toISOString(), email_error_code: null })
    .eq('id', initial.id).in('email_status', ['pending', 'failed', 'paused']).select('*').maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) {
    const latest = await admin.from('feedback_reports').select('*').eq('id', initial.id).single();
    if (latest.error) throw latest.error;
    return feedbackReceipt(latest.data as FeedbackReport);
  }
  let report = claim.data as FeedbackReport;
  let mailAttempted = false;
  const save = async (patch: Record<string, unknown>) => {
    const result = await admin.from('feedback_reports').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', report.id).select('*').single();
    if (result.error) throw result.error;
    report = result.data as FeedbackReport;
  };
  try {
    if (report.has_screenshot && !report.screenshot_path) {
      if (!screenshot) throw new Error('screenshot_missing');
      const path = `${report.organization_id}/${report.id}.png`;
      const upload = await admin.storage.from('feedback-screenshots').upload(path, screenshot, { contentType: 'image/png', upsert: true });
      if (upload.error) throw new Error('screenshot_upload_failed');
      await save({ screenshot_path: path });
    }
    const appUrl = (deps.appUrl || 'https://ja-works-hub.vercel.app').replace(/\/$/, '');
    const reportUrl = `${appUrl}/superadmin/feedback/${report.id}`;
    const kind = report.kind === 'bug' ? 'Bug' : 'Verbeteridee';
    const subject = `[JA Werkt][${kind} #${report.number}] ${report.title.replace(/[\r\n]/g, ' ')}`;
    const block = (label: string, text: string) => text ? `<h3>${escapeHtml(label)}</h3><p style="white-space:pre-wrap">${escapeHtml(text)}</p>` : '';
    const theme = await deps.loadBrandTheme(admin, report.organization_id);
    const htmlBody = renderBrandedEmail({ theme, contentHtml:
      `<h2>${escapeHtml(subject)}</h2><p>Van ${escapeHtml(report.reporter_name)} (${escapeHtml(report.reporter_email)})</p>` +
      block('Omschrijving', report.description) + block('Stappen', report.steps) + block('Verwacht resultaat', report.expected) +
      `<h3>Technische context</h3><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify({ organizationId: report.organization_id, userId: report.submitted_by, ...report.diagnostics }, null, 2))}</pre>` +
      `<p><a href="${escapeHtml(reportUrl)}">Melding${report.screenshot_path ? ' en screenshot' : ''} bekijken (inloggen bij SiteJob)</a></p>`,
    });
    // Only a reference goes into the org-wide communication log, not private feedback.
    const concept = await admin.from('communications').upsert({
      id: report.id, organization_id: report.organization_id, feedback_report_id: report.id,
      channel: 'email', direction: 'outbound', message_type: 'concept',
      subject: `SiteJob-melding #${report.number}`, body: reportUrl,
      email_to: [FEEDBACK_RECIPIENT], sent_by: report.submitted_by,
    }, { onConflict: 'id' });
    if (concept.error) throw new Error('concept_save_failed');
    if (await deps.isOutboundPaused(admin, report.organization_id, 'email')) {
      await save({ email_status: 'paused' });
      return feedbackReceipt(report);
    }
    const sender = await deps.loadDefaultOrganizationSender(admin, report.organization_id);
    if (!sender || sender.status !== 'connected') throw new Error('mailbox_unavailable');
    await save({ email_status: 'sending' });
    mailAttempted = true;
    const sent = await deps.sendViaOutlookAccount({
      orgId: report.organization_id, accountId: sender.id, to: FEEDBACK_RECIPIENT,
      replyToEmail: report.reporter_email, subject, htmlBody, senderName: null,
      sentBy: report.submitted_by, logCommunication: false,
    });
    if (sent.communicationPaused) {
      await save({ email_status: 'paused' });
    } else if (sent.success) {
      await save({ email_status: 'sent', sent_at: new Date().toISOString() });
      // Delivery is already recorded; a failed secondary log update must never resend mail.
      const logged = await admin.from('communications').update({ message_type: 'email', email_from: sent.from, sent_at: new Date().toISOString() }).eq('id', report.id);
      if (logged.error) console.error('[feedback] sent communication log update failed');
    } else {
      await save({ email_status: 'unknown', email_error_code: 'delivery_unconfirmed' });
    }
  } catch (error) {
    const knownCodes = ['screenshot_missing', 'screenshot_upload_failed', 'concept_save_failed', 'mailbox_unavailable'];
    const code = knownCodes.includes((error as Error).message) ? (error as Error).message : 'preparation_failed';
    // A provider timeout might have sent the mail. Never automatically retry it.
    try { await save({ email_status: mailAttempted ? 'unknown' : 'failed', email_error_code: mailAttempted ? 'delivery_unconfirmed' : code }); }
    catch { report = { ...report, email_status: mailAttempted ? 'unknown' : 'preparing' }; }
  }
  return feedbackReceipt(report);
}
