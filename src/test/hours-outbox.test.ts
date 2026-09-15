import { describe, expect, it } from 'vitest';
import {
  createHoursOutboxHandler, type HoursOutboxPorts, type HoursSendOutcome,
} from '../../supabase/functions/_shared/hours-outbox';
import { JA_WERKT_BRAND } from '../../supabase/functions/_shared/email-layout';

/**
 * The whole boundary of the outgoing hours mail, without a mailbox, a session or
 * a clock. Everything that reaches outside sits behind a port, so these tests
 * exercise the real handler: what it plans, what it refuses to send, what it
 * writes back, and what a second run does.
 */

const THEME = {
  orgName: 'Demo Uitzendbureau', logoUrl: null, accentHex: JA_WERKT_BRAND.accentHex,
  navyHex: JA_WERKT_BRAND.navyHex, textHex: JA_WERKT_BRAND.textHex,
  mutedHex: JA_WERKT_BRAND.mutedHex, pageBgHex: JA_WERKT_BRAND.pageBgHex, tagline: '',
};

const RULE_REQUEST = {
  id: 'klant-uitvraag', enabled: true, mailType: 'hours_request', party: 'customer',
  recipientIds: ['contact-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
  templateId: 'uitvraag', language: 'nl',
};

function week(overrides: Record<string, unknown> = {}) {
  return {
    week_id: 'week-1', organization_id: 'org-1', company_id: 'company-1',
    company_name: 'Klant A', week_start: '2026-09-07',
    config: {
      timezone: 'Europe/Amsterdam',
      submissionDeadline: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '12:00' },
      approvalDeadline: { kind: 'week_time', weekOffset: 1, weekday: 3, time: '12:00' },
      lateApproval: { mode: 'require_review', minimumWindowMinutes: 60 },
      rules: [RULE_REQUEST],
    },
    recipient_states: [{ party: 'customer', recipientId: 'contact-a', submissionComplete: false }],
    correction_approvals: [],
    existing_actions: [],
    request: { id: 'req-1', code: 'UR-7K3M-2XQ9', revoked_at: null },
    recipients: { 'contact-a': { email: 'planner@klant-a.invalid', name: 'Planner A', kind: 'company_contact', company_contact_id: 'contact-a' } },
    templates: { 'uitvraag:nl': { subject: 'Uren week {{week}}', body: 'Beste {{ontvanger}},\n\nGraag de uren van {{opdrachtgever}}.' } },
    facts: { missing_members: ['Jan Kowalski'], submission_deadline_at: '2026-09-14T10:00:00Z', confirmation_deadline_at: '2026-09-16T10:00:00Z' },
    ...overrides,
  };
}

interface Recorded { rpc: [string, any][]; sent: any[] }

function ports(options: {
  weeks?: any[]; claim?: any[]; send?: (m: any) => Promise<HoursSendOutcome>; recorded?: Recorded;
  asOf?: string; mode?: 'cron' | 'user'; organizationId?: string;
  /** Makes one named RPC answer with an error instead of data. */
  rpcErrors?: Record<string, { code?: string; message?: string }>;
} = {}) {
  const recorded: Recorded = options.recorded ?? { rpc: [], sent: [] };
  let claimCalls = 0;
  const base: HoursOutboxPorts = {
    authorize: async () => options.mode === 'user'
      ? { mode: 'user', organizationId: options.organizationId ?? 'org-1' }
      : { mode: 'cron' },
    serviceRpc: async (name, args) => {
      recorded.rpc.push([name, args]);
      const failure = options.rpcErrors?.[name];
      if (failure) return { data: null, error: failure };
      switch (name) {
        case 'hours_outbox_due_weeks':
          return { data: options.weeks ?? [week()], error: null };
        case 'hours_outbox_sync':
          return { data: { ok: true, planned: 1 }, error: null };
        case 'hours_outbox_claim': {
          claimCalls += 1;
          if (claimCalls > 1) return { data: { ok: true, claim_token: 't', messages: [] }, error: null };
          return { data: { ok: true, claim_token: 'claim-1', messages: options.claim ?? [] }, error: null };
        }
        default:
          return { data: { ok: true }, error: null };
      }
    },
    loadTheme: async () => THEME,
    sendMail: async (message) => {
      recorded.sent.push(message);
      return options.send ? await options.send(message) : { ok: true, messageId: '<sent-1@jawerkt.invalid>', conversationId: 'AAQkConv' };
    },
    now: () => Date.parse(options.asOf ?? '2026-09-14T08:00:00Z'),
  };
  return { ports: base, recorded };
}

const claimable = (overrides: Record<string, unknown> = {}) => ({
  id: 'out-1', organization_id: 'org-1', company_id: 'company-1', week_id: 'week-1',
  mail_type: 'hours_request', party: 'customer', recipient_id: 'contact-a', channel: 'email',
  subject: 'Uren week 37 [UR-7K3M-2XQ9]', body_html: '<p>Beste Planner A,</p>',
  recipients: ['planner@klant-a.invalid'], company_contact_id: 'contact-a', candidate_id: null,
  request_id: 'req-1', ...overrides,
});

async function run(ports: HoursOutboxPorts, body: Record<string, unknown> = { mode: 'cron' }) {
  const handler = createHoursOutboxHandler(ports, { 'Access-Control-Allow-Origin': '*' });
  const response = await handler(new Request('https://edge.invalid/hours-outbox', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { response, payload: await response.json() };
}

const synced = (recorded: Recorded) => recorded.rpc.filter(([name]) => name === 'hours_outbox_sync');

describe('planning the outgoing hours mail', () => {
  it('plans nothing at all when every message type is switched off', async () => {
    const off = week({ config: { ...week().config, rules: [{ ...RULE_REQUEST, enabled: false }] } });
    const { ports: p, recorded } = ports({ weeks: [off] });
    await run(p);
    const calls = synced(recorded);
    expect(calls).toHaveLength(1);
    expect(calls[0][1].p_actions).toEqual([]);
    expect(recorded.sent).toHaveLength(0);
  });

  it('gives two clients with different schedules their own moments', async () => {
    const a = week();
    const b = week({
      week_id: 'week-2', company_id: 'company-2', company_name: 'Klant B',
      config: {
        ...week().config,
        rules: [{ ...RULE_REQUEST, at: { kind: 'week_time', weekOffset: 1, weekday: 3, time: '16:30' } }],
      },
    });
    const { ports: p, recorded } = ports({ weeks: [a, b] });
    await run(p);
    const [first, second] = synced(recorded).map(([, args]) => args.p_actions[0]);
    expect(first.scheduled_at).toBe('2026-09-14T07:00:00.000Z');
    expect(second.scheduled_at).toBe('2026-09-16T14:30:00.000Z');
  });

  it('never offers a deadline task to the sender', async () => {
    const task = week({
      config: {
        ...week().config,
        rules: [{
          id: 'interne-deadline', enabled: true, mailType: 'submission_deadline', party: 'internal',
          recipientIds: ['profile-a'], at: { kind: 'deadline_offset', deadline: 'submission', offsetMinutes: 0 },
        }],
      },
      recipient_states: [{ party: 'internal', recipientId: 'profile-a', submissionComplete: false }],
      recipients: { 'profile-a': { email: 'intercedent@ja-werkt.invalid', name: 'Intercedent', kind: 'profile' } },
    });
    const { ports: p, recorded } = ports({ weeks: [task] });
    await run(p);
    expect(synced(recorded)[0][1].p_actions).toEqual([]);
  });

  it('keeps a correction draft out of the sendable set until it is approved', async () => {
    const correction = week({
      config: {
        ...week().config,
        rules: [{
          id: 'navraag', enabled: true, mailType: 'correction_query', party: 'customer',
          recipientIds: ['contact-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
          templateId: 'uitvraag', language: 'nl',
        }],
      },
      correction_approvals: [{
        ruleId: 'navraag', recipientId: 'contact-a', contentHash: 'hash-1', sourceRevision: 'rev-1',
        approvedContentHash: null, approvedSourceRevision: null,
      }],
    });
    const { ports: p, recorded } = ports({ weeks: [correction] });
    await run(p);
    const action = synced(recorded)[0][1].p_actions[0];
    expect(action.status).toBe('requires_review');
    expect(action.approval_required).toBe(true);
  });
});

describe('sending what was approved', () => {
  it('wraps the stored draft in the brand layout and puts the request code in the subject', async () => {
    const { ports: p, recorded } = ports();
    await run(p);
    const action = synced(recorded)[0][1].p_actions[0];
    expect(action.subject).toBe('Uren week 37 [UR-7K3M-2XQ9]');
    expect(action.body_html).toContain('<!DOCTYPE html');
    expect(action.body_html).toContain(JA_WERKT_BRAND.navyHex);
    expect(action.body_html).toContain('Beste Planner A,');
    expect(action.recipients).toEqual(['planner@klant-a.invalid']);
  });

  it('sends exactly the bytes that were stored and writes the three fields back', async () => {
    const { ports: p, recorded } = ports({ claim: [claimable()] });
    await run(p);
    expect(recorded.sent).toHaveLength(1);
    // What a person approved is what leaves: the sender re-renders nothing.
    expect(recorded.sent[0].subject).toBe('Uren week 37 [UR-7K3M-2XQ9]');
    expect(recorded.sent[0].htmlBody).toBe('<p>Beste Planner A,</p>');
    const [, args] = recorded.rpc.find(([name]) => name === 'hours_outbox_record_sent')!;
    expect(args).toMatchObject({
      p_id: 'out-1', p_claim_token: 'claim-1',
      p_outbound_message_id: '<sent-1@jawerkt.invalid>', p_conversation_id: 'AAQkConv',
      p_recipients: ['planner@klant-a.invalid'],
    });
  });

  it('logs a concept and never marks it sent while outbound mail is paused', async () => {
    const { ports: p, recorded } = ports({
      claim: [claimable()],
      send: async () => ({ ok: false, paused: true, error: 'Uitgaande e-mail staat op pauze' }),
    });
    await run(p);
    expect(recorded.rpc.some(([name]) => name === 'hours_outbox_record_sent')).toBe(false);
    const [, args] = recorded.rpc.find(([name]) => name === 'hours_outbox_record_failure')!;
    expect(args).toMatchObject({ p_id: 'out-1', p_kind: 'paused' });
  });

  it('backs a provider 5xx off instead of retrying it without a bound', async () => {
    const { ports: p, recorded } = ports({
      claim: [claimable()],
      send: async () => ({ ok: false, status: 503, error: 'graph_503' }),
    });
    await run(p);
    const [, args] = recorded.rpc.find(([name]) => name === 'hours_outbox_record_failure')!;
    expect(args.p_kind).toBe('transient');
  });

  it('does not keep retrying what the provider refused for good', async () => {
    const { ports: p, recorded } = ports({
      claim: [claimable()],
      send: async () => ({ ok: false, status: 400, error: 'invalid recipient' }),
    });
    await run(p);
    const [, args] = recorded.rpc.find(([name]) => name === 'hours_outbox_record_failure')!;
    expect(args.p_kind).toBe('permanent');
  });

  it('sends nothing a second time when the claim comes back empty', async () => {
    const { ports: p, recorded } = ports({ claim: [] });
    await run(p);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.rpc.some(([name]) => name === 'hours_outbox_record_sent')).toBe(false);
  });

  it('does not call a send done when the database refused to record it', async () => {
    // `rpc()` resolves with {data, error} and never throws, so an unchecked call
    // reports a tidy success for a write that did not happen — and the row stays
    // claimable, which is how the same mail goes out twice.
    const { ports: p, recorded } = ports({
      claim: [claimable()],
      rpcErrors: { hours_outbox_record_sent: { code: 'PT409', message: 'claim verlopen' } },
    });
    const { payload } = await run(p);
    expect(payload.sent).toBe(0);
    expect(payload.errors).toContain('record_failed');
  });

  it('does not count a week as planned when the plan was refused', async () => {
    const { ports: p, recorded } = ports({
      rpcErrors: { hours_outbox_sync: { message: 'te veel acties' } },
    });
    const { payload } = await run(p);
    expect(payload.planned).toBe(0);
    expect(payload.errors).toContain('week_failed');
  });

  it('says so when a failure could not be recorded either', async () => {
    const { ports: p } = ports({
      claim: [claimable()],
      send: async () => ({ ok: false, status: 503, error: 'graph_503' }),
      rpcErrors: { hours_outbox_record_failure: { message: 'weg' } },
    });
    const { payload } = await run(p);
    expect(payload.errors).toContain('record_failed');
  });

  it('holds its lease longer than the cron period so a slow run is not lapped', async () => {
    const { ports: p, recorded } = ports({ claim: [claimable()] });
    await run(p);
    const [, args] = recorded.rpc.find(([name]) => name === 'hours_outbox_claim')!;
    // The cron runs every five minutes; an equal lease lets the next run sweep
    // this claim and send the very same message again.
    expect(args.p_lease_seconds).toBeGreaterThan(300);
  });

  it('never hands the store more actions or a longer subject than it accepts', async () => {
    const long = 'x'.repeat(400);
    const wide = week({
      templates: { 'uitvraag:nl': { subject: long, body: 'Beste {{ontvanger}}' } },
    });
    const { ports: p, recorded } = ports({ weeks: [wide] });
    await run(p);
    const action = synced(recorded)[0][1].p_actions[0];
    expect(action.subject.length).toBeLessThanOrEqual(400);
    expect(synced(recorded)[0][1].p_actions.length).toBeLessThanOrEqual(200);
  });

  it('keeps a manual run inside the caller´s own tenant', async () => {
    const foreign = week({ week_id: 'week-x', organization_id: 'org-2' });
    const { ports: p, recorded } = ports({ weeks: [week(), foreign], mode: 'user', organizationId: 'org-1' });
    await run(p, { mode: 'user' });
    expect(synced(recorded)).toHaveLength(1);
    expect(synced(recorded)[0][1].p_week_id).toBe('week-1');
  });
});
