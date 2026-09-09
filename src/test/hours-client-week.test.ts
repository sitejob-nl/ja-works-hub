import { describe, expect, it } from 'vitest';
import {
  buildClientEntries,
  clientLinkStatusFromCode,
  clientRefusalMessage,
  isAlreadyStoredObject,
  isClientLinkCode,
  MAX_CLIENT_ENTRIES,
} from '../../supabase/functions/_shared/hours-client-entries.ts';
import { describeSourceReferences, sourceOriginText } from '@/lib/hours-sources';
import { toHoursWeekView } from '@/lib/hours-workflow';
import { parseClientWeek } from '@/lib/hours-client-week';

const DAY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const issuesFor = (input: unknown) => buildClientEntries(input).issues.map(issue => issue.message);

describe('what a client types becomes minutes, or stays unknown', () => {
  it('reads 8,5 and 8:30 as the same duration', () => {
    const decimal = buildClientEntries([{ day_id: DAY, hours: '8,5' }]);
    const clock = buildClientEntries([{ day_id: DAY, hours: '8:30' }]);
    expect(decimal.entries).toEqual([{ day_id: DAY, minutes: 510, no_hours_reason: null, note: null }]);
    expect(clock.entries).toEqual(decimal.entries);
    expect(decimal.issues).toEqual([]);
  });

  it('reads a decimal point the same way as a comma', () => {
    expect(buildClientEntries([{ day_id: DAY, hours: '8.5' }]).entries[0].minutes).toBe(510);
  });

  it('leaves a blank field out entirely, so the day stays unknown', () => {
    for (const hours of ['', '   ', null, undefined]) {
      const result = buildClientEntries([{ day_id: DAY, hours }]);
      expect(result.entries).toEqual([]);
      expect(result.issues).toEqual([]);
    }
  });

  it('never turns a blank field into zero', () => {
    const result = buildClientEntries([{ day_id: DAY, hours: '' }, { day_id: OTHER, hours: '8' }]);
    expect(result.entries).toEqual([{ day_id: OTHER, minutes: 480, no_hours_reason: null, note: null }]);
  });

  it('records no hours only with an explicit reason', () => {
    const withReason = buildClientEntries([{ day_id: DAY, no_hours: true, reason: 'Ziek' }]);
    expect(withReason.entries).toEqual([{ day_id: DAY, minutes: 0, no_hours_reason: 'Ziek', note: null }]);
    expect(issuesFor([{ day_id: DAY, no_hours: true }])).toEqual(['Geef een reden waarom er geen uren zijn.']);
    expect(issuesFor([{ day_id: DAY, no_hours: true, reason: '   ' }])).toHaveLength(1);
    expect(buildClientEntries([{ day_id: DAY, no_hours: true }]).entries).toEqual([]);
  });

  it('asks for a reason instead of accepting a typed zero', () => {
    for (const hours of ['0', '0,0', '0:00']) {
      const result = buildClientEntries([{ day_id: DAY, hours }]);
      expect(result.entries).toEqual([]);
      expect(result.issues[0].message).toContain('geen uren');
    }
  });

  it('refuses a duration it cannot read exactly, instead of rounding', () => {
    expect(issuesFor([{ day_id: DAY, hours: '8,004' }])[0]).toContain('minuut');
    expect(issuesFor([{ day_id: DAY, hours: '8:70' }])[0]).toContain('00 en 59');
    expect(issuesFor([{ day_id: DAY, hours: 'acht uur' }])[0]).toContain('8,5');
    expect(issuesFor([{ day_id: DAY, hours: '-3' }])).toHaveLength(1);
    expect(buildClientEntries([{ day_id: DAY, hours: '8,004' }]).entries).toEqual([]);
  });

  it('keeps a day inside one calendar day', () => {
    expect(buildClientEntries([{ day_id: DAY, hours: '24:00' }]).entries[0].minutes).toBe(1440);
    expect(issuesFor([{ day_id: DAY, hours: '24:01' }])).toHaveLength(1);
  });

  it('never carries a reason next to worked hours', () => {
    const result = buildClientEntries([{ day_id: DAY, hours: '8', no_hours: false, reason: 'Ziek' }]);
    expect(result.entries).toEqual([{ day_id: DAY, minutes: 480, no_hours_reason: null, note: null }]);
  });

  it('keeps a note with the day it belongs to', () => {
    const result = buildClientEntries([{ day_id: DAY, hours: '8', note: '  Overwerk avond  ' }]);
    expect(result.entries[0].note).toBe('Overwerk avond');
  });

  it('asks what a note on its own is about, instead of dropping it in silence', () => {
    const result = buildClientEntries([{ day_id: DAY, note: 'Alleen een opmerking' }]);
    expect(result.entries).toEqual([]);
    expect(result.issues[0].message).toMatch(/uren/i);
    expect(result.issues[0].day_id).toBe(DAY);
  });

  it('refuses the same workday twice in one delivery', () => {
    const result = buildClientEntries([{ day_id: DAY, hours: '8' }, { day_id: DAY, hours: '9' }]);
    expect(result.entries).toEqual([]);
    expect(result.issues[0].message).toContain('één keer');
  });

  it('refuses anything that is not a workday of this page', () => {
    expect(issuesFor([{ day_id: 'geen-uuid', hours: '8' }])).toHaveLength(1);
    expect(issuesFor('8 uur')).toHaveLength(1);
    expect(issuesFor([null])).toHaveLength(1);
  });

  it('bounds one delivery, so a page cannot be used to flood the office', () => {
    const many = Array.from({ length: MAX_CLIENT_ENTRIES + 1 }, (_, index) => ({
      day_id: `1111111${index.toString().padStart(2, '0')}-1111-4111-8111-111111111111`.slice(0, 36),
      hours: '8',
    }));
    const result = buildClientEntries(many);
    expect(result.entries).toEqual([]);
    expect(result.issues[0].message).toContain(String(MAX_CLIENT_ENTRIES));
  });

  it('truncates nothing silently: an overlong note is refused', () => {
    expect(issuesFor([{ day_id: DAY, hours: '8', note: 'x'.repeat(2001) }])).toHaveLength(1);
    expect(issuesFor([{ day_id: DAY, no_hours: true, reason: 'x'.repeat(501) }])).toHaveLength(1);
  });
});

describe('what the page says when a link does not work', () => {
  it('names the reason a visitor can act on', () => {
    expect(clientLinkStatusFromCode('PT410')).toBe('expired');
    expect(clientLinkStatusFromCode('PT403')).toBe('revoked');
    expect(clientLinkStatusFromCode('PT404')).toBe('invalid');
    expect(clientLinkStatusFromCode('22023')).toBe('unavailable');
  });

  it('treats anything it does not recognise as unavailable, never as valid', () => {
    for (const code of ['', null, undefined, 'XX999', '23505']) {
      expect(clientLinkStatusFromCode(code)).toBe('unavailable');
    }
  });

  it('does not read a refused workday as a dead link', () => {
    // 42501 also guards a day outside this link's week. Reporting that as
    // "this link does not work" would replace the whole page and throw away
    // what the client had just typed.
    expect(clientLinkStatusFromCode('42501')).toBe('unavailable');
    expect(isClientLinkCode('42501')).toBe(false);
    for (const code of ['PT410', 'PT403', 'PT404']) expect(isClientLinkCode(code)).toBe(true);
    for (const code of ['22023', '', null, undefined]) expect(isClientLinkCode(code)).toBe(false);
  });
});

describe('what a refused write may say to an anonymous visitor', () => {
  it('passes on the refusals this module wrote itself, in its own words', () => {
    expect(clientRefusalMessage({ code: '22023', message: 'Vul geldige uren in; geen uren vereist een reden' }))
      .toBe('Vul geldige uren in; geen uren vereist een reden');
    expect(clientRefusalMessage({ code: '42501', message: 'Deze werkdag hoort niet bij deze urenweek' }))
      .toBe('Deze werkdag hoort niet bij deze urenweek');
  });

  it('never leaks a database internal onto a public page', () => {
    for (const failure of [
      { code: '40P01', message: 'deadlock detected; Process 123 waits for ShareLock on transaction 456' },
      { code: '23505', message: 'duplicate key value violates unique constraint "hours_proposals_open_client_day_idx"' },
      { code: '22P02', message: 'invalid input syntax for type uuid: "geen-uuid"' },
      { code: '42883', message: 'function public.hours_client_week_save(text, jsonb) does not exist' },
      { code: null, message: 'connection to server was lost' },
      null,
    ]) {
      const shown = clientRefusalMessage(failure);
      expect(shown).toBe('Dit kon niet worden opgeslagen. Probeer het opnieuw of neem contact op met uw contactpersoon.');
      expect(shown).not.toMatch(/hours_|constraint|deadlock|uuid|pg_/i);
    }
  });
});

describe('an upload that could not be signed', () => {
  it('recognises only an object that is genuinely already stored', () => {
    expect(isAlreadyStoredObject({ statusCode: '409', message: 'Duplicate' })).toBe(true);
    expect(isAlreadyStoredObject({ statusCode: 409 })).toBe(true);
    expect(isAlreadyStoredObject({ message: 'The resource already exists' })).toBe(true);
  });

  it('never calls a real storage failure a delivered file', () => {
    for (const failure of [{ statusCode: '500', message: 'Internal error' },
      { statusCode: '403', message: 'Unauthorized' }, { message: 'network unreachable' }, null, {}]) {
      expect(isAlreadyStoredObject(failure)).toBe(false);
    }
  });
});

const weekWithOrigin = (references: unknown[]) => ({
  id: '55555555-5555-4555-8555-555555555555', company_id: '66666666-6666-4666-8666-666666666666',
  company_name: 'Acme BV', week_start: '2026-09-07',
  submission_deadline_at: null, confirmation_deadline_at: null, settings_snapshot: {},
  workflow_enabled: true, can_manage: true, can_confirm: false, release_available: false as const,
  members: [{
    id: '44444444-4444-4444-8444-444444444444', placement_id: '77777777-7777-4777-8777-777777777777',
    candidate_id: '88888888-8888-4888-8888-888888888888', candidate_name: 'Anna Nowak',
    start_date: '2026-09-07', end_date: '2026-09-13',
    days: [{
      id: DAY, work_date: '2026-09-07',
      current_revision: {
        id: OTHER, revision_number: 1, minutes: 510, no_hours_reason: null, note: null,
        source_references: references, created_at: '2026-09-09T08:00:00Z',
      },
      classification: null, confirmation: null, review: null,
    }],
  }],
});

describe('the origin an employee sees', () => {
  it('says the client delivered these hours', () => {
    const [origin] = describeSourceReferences([{ kind: 'client', label: 'Acme BV', reference: null }]);
    expect(origin).toEqual({ kind: 'client', label: 'Acme BV', reference: null });
    expect(sourceOriginText([{ kind: 'client', label: 'Acme BV', reference: null }]))
      .toBe('Aangeleverd door Acme BV');
  });

  it('leaves the released manual and upload origins untouched', () => {
    expect(sourceOriginText([{ kind: 'manual', label: 'Handmatige invoer' }])).toBe('Handmatige invoer');
    expect(sourceOriginText([{ kind: 'upload', label: 'week37.pdf', reference: 'pagina 2' }]))
      .toBe('week37.pdf · pagina 2');
  });

  it('marks a client delivery on the screens that show a day version', () => {
    // Both the office grid and the employee portal read `sourceLabel` from the
    // week view. Without the marker an employee reads "Bron: Acme BV" and has
    // no way to tell who put those hours there.
    const view = toHoursWeekView(weekWithOrigin([{ kind: 'client', label: 'Acme BV', reference: null }]));
    expect(view.employees[0].days[0].revision?.sourceLabel).toBe('Aangeleverd door Acme BV');
    const upload = toHoursWeekView(weekWithOrigin([{ kind: 'upload', label: 'week37.pdf', reference: 'pagina 2' }]));
    expect(upload.employees[0].days[0].revision?.sourceLabel, 'the released wording is untouched')
      .toBe('week37.pdf');
    expect(upload.employees[0].days[0].revision?.sourceReference).toBe('pagina 2');
    const manual = toHoursWeekView(weekWithOrigin([{ kind: 'manual', label: 'Handmatige invoer' }]));
    expect(manual.employees[0].days[0].revision?.sourceLabel).toBe('Handmatige invoer');
  });
});

describe('the projection the client page reads', () => {
  const week = {
    week: {
      id: '33333333-3333-4333-8333-333333333333',
      company_name: 'Acme BV',
      week_start: '2026-09-07',
      submission_deadline_at: '2026-09-14T10:00:00+00:00',
    },
    label: 'Planning Acme',
    expires_at: '2026-09-21T10:00:00+00:00',
    report: null,
    members: [{
      id: '44444444-4444-4444-8444-444444444444',
      candidate_name: 'Anna Nowak',
      days: [{ id: DAY, work_date: '2026-09-07', delivered: null }],
    }],
    expected_days: 7,
    provided_days: 0,
    outstanding_days: 7,
    complete: false,
  };

  it('accepts what the server sends', () => {
    expect(parseClientWeek(week).members[0].candidate_name).toBe('Anna Nowak');
    expect(parseClientWeek(week).complete).toBe(false);
  });

  it('refuses a payload that carries internal facts it should never receive', () => {
    expect(() => parseClientWeek({ ...week, members: [{ ...week.members[0], days: [{
      id: DAY, work_date: '2026-09-07', delivered: null, current_revision: { id: DAY },
    }] }] })).toThrow();
  });

  it('reads back a delivery so the client sees what it filled in', () => {
    const parsed = parseClientWeek({ ...week, provided_days: 1, outstanding_days: 6, members: [{
      ...week.members[0],
      days: [{ id: DAY, work_date: '2026-09-07', delivered: {
        minutes: 510, no_hours_reason: null, note: 'Overwerk', status: 'open',
        created_at: '2026-09-08T08:00:00+00:00',
      } }],
    }] });
    expect(parsed.members[0].days[0].delivered?.minutes).toBe(510);
    expect(parsed.outstanding_days).toBe(6);
  });
});
