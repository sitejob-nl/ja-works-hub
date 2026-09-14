import { describe, expect, it, vi } from 'vitest';
import { deliverFeedback } from '../../supabase/functions/feedback/delivery';

function fixture() {
  const report = {
    id: '11111111-1111-4111-8111-111111111111', number: 123, organization_id: 'org-a', submitted_by: 'user-a',
    reporter_name: 'Testmelder', reporter_email: 'reporter@example.nl', title: '<script>bug</script>',
    kind: 'bug', description: 'Beschrijving', steps: '', expected: '', diagnostics: { page: '/kandidaten' },
    has_screenshot: false, screenshot_path: null, email_status: 'pending',
  } as any;
  const communications: Record<string, unknown> = {};
  const admin = {
    from(table: string) {
      let patch: any = null, statuses: string[] | undefined;
      const chain: any = {
        update(v: any) { patch = v; return chain; },
        upsert(v: any) { Object.assign(communications, v); return Promise.resolve({ error: null }); },
        eq() { return chain; }, in(_key: string, values: string[]) { statuses = values; return chain; },
        select() { return chain; },
        maybeSingle() { return execute(); }, single() { return execute(); },
        then(resolve: any) { return execute().then(resolve); },
      };
      const execute = async () => {
        const target = table === 'feedback_reports' ? report : communications;
        if (statuses && !statuses.includes(report.email_status)) return { data: null, error: null };
        if (patch) Object.assign(target, patch);
        return { data: { ...target }, error: null };
      };
      return chain;
    },
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }) },
  } as any;
  const deps = {
    loadBrandTheme: vi.fn().mockResolvedValue({ organizationName: 'JA Werkt', accentColor: '#F97415', headingColor: '#0C4D78' }),
    loadDefaultOrganizationSender: vi.fn().mockResolvedValue({ id: 'sender', status: 'connected' }),
    isOutboundPaused: vi.fn().mockResolvedValue(false),
    sendViaOutlookAccount: vi.fn().mockResolvedValue({ success: true, from: 'system@example.nl' }),
  } as any;
  return { report, communications, admin, deps };
}
describe('persisted feedback delivery', () => {
  it('uses the fixed recipient, reporter reply-to, escaped HTML and a protected screenshot link', async () => {
    const { report, admin, deps, communications } = fixture();
    report.has_screenshot = true;
    const result = await deliverFeedback(admin, report, new Uint8Array([1]), deps);
    expect(result.email_status).toBe('sent');
    expect(result.screenshot_path).toBe(`org-a/${report.id}.png`);
    const mail = deps.sendViaOutlookAccount.mock.calls[0][0];
    expect(mail.to).toBe('info@sitejob.nl');
    expect(mail.replyToEmail).toBe('reporter@example.nl');
    expect(mail.htmlBody).toContain('&lt;script&gt;');
    expect(mail.htmlBody).not.toContain('<script>');
    expect(mail.htmlBody).toContain(`/superadmin/feedback/${report.id}`);
    expect(mail.htmlBody).not.toContain('storage/v1/object');
    expect(communications.message_type).toBe('email');
    expect(communications.body).not.toContain('Beschrijving');
  });
  it('saves a concept and never invokes mail while the outbound pause is active', async () => {
    const { report, admin, deps, communications } = fixture();
    deps.isOutboundPaused.mockResolvedValue(true);
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('paused');
    expect(communications.message_type).toBe('concept');
    expect(deps.sendViaOutlookAccount).not.toHaveBeenCalled();
  });
  it('does not lose a report when storage or sender preparation fails, and allows a safe retry', async () => {
    const { report, admin, deps } = fixture();
    deps.loadDefaultOrganizationSender.mockResolvedValueOnce(null);
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('failed');
    expect(report.email_error_code).toBe('mailbox_unavailable');
    expect(deps.sendViaOutlookAccount).not.toHaveBeenCalled();
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('sent');
    expect(deps.sendViaOutlookAccount).toHaveBeenCalledTimes(1);
  });
  it('marks an uncertain provider result and does not send twice on retry', async () => {
    const { report, admin, deps } = fixture();
    deps.sendViaOutlookAccount.mockRejectedValue(new Error('timeout'));
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('unknown');
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('unknown');
    expect(deps.sendViaOutlookAccount).toHaveBeenCalledTimes(1);
  });
  it('atomically prevents a second request from sending while the first is in progress', async () => {
    const { report, admin, deps } = fixture();
    let release: (v: unknown) => void;
    deps.sendViaOutlookAccount.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = deliverFeedback(admin, report, null, deps);
    await vi.waitFor(() => expect(report.email_status).toBe('sending'));
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('sending');
    release!({ success: true });
    await first;
    expect(deps.sendViaOutlookAccount).toHaveBeenCalledTimes(1);
  });
  it('keeps missing screenshots visible and never sends an incomplete screenshot report', async () => {
    const { report, admin, deps } = fixture();
    report.has_screenshot = true;
    expect((await deliverFeedback(admin, report, null, deps)).email_status).toBe('failed');
    expect(report.email_error_code).toBe('screenshot_missing');
    expect(deps.sendViaOutlookAccount).not.toHaveBeenCalled();
  });
});
