import { describe, expect, it } from 'vitest';
import {
  describeSourceReferences, formatSourceSize, hoursSourcePath, hoursSourceTypeError,
  describeUncertainFields,
  parseWeekSources, proposalChanges, proposalIsBlocked, sourceOriginText, visibleClientProposals,
  HOURS_CLIENT_SOURCE_ACCEPT, HOURS_SOURCE_MAX_BYTES, type HoursSourceProposal,
} from '@/lib/hours-sources';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

const shiftSource: HoursSourceInput = {
  schemaVersion: 1,
  shifts: [{ start: '08:00', end: '16:30', endDayOffset: 0, breaks: [{ start: '12:00', end: '12:30' }] }],
};

describe('hours source acceptance', () => {
  it.each([
    'application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'message/rfc822',
  ])('accepts %s within the size limit', type => {
    expect(hoursSourceTypeError({ type, size: 2048 })).toBeNull();
  });

  it.each(['text/html', 'text/csv', 'application/zip', ''])(
    'rejects %s with an explanation instead of storing it', type => {
      expect(hoursSourceTypeError({ type, size: 2048 })).toMatch(/Alleen PDF, JPG, PNG, Excel, Word en e-mail/);
    });

  /**
   * The client week page delivers timesheets, not the office's mailbox, and its
   * endpoint refuses Word and e-mail. Offering them there would be a refusal
   * dressed up as a button.
   */
  it.each([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'message/rfc822',
  ])('keeps %s out of what a client may hand in', type => {
    expect(hoursSourceTypeError({ type, size: 2048 }, HOURS_CLIENT_SOURCE_ACCEPT))
      .toMatch(/Alleen PDF, JPG, PNG en Excel/);
    expect(hoursSourceTypeError({ type: 'application/pdf', size: 2048 }, HOURS_CLIENT_SOURCE_ACCEPT)).toBeNull();
  });

  it('rejects an empty file and one over the limit', () => {
    expect(hoursSourceTypeError({ type: 'application/pdf', size: 0 })).toMatch(/leeg/);
    expect(hoursSourceTypeError({ type: 'application/pdf', size: HOURS_SOURCE_MAX_BYTES + 1 })).toMatch(/25 MB/);
    expect(hoursSourceTypeError({ type: 'application/pdf', size: HOURS_SOURCE_MAX_BYTES })).toBeNull();
  });

  it('derives the stored path from tenant, week and digest so a repeat lands on the same object', () => {
    const digest = 'a'.repeat(64);
    expect(hoursSourcePath('org-1', 'week-1', digest, 'application/pdf')).toBe(`org-1/week-1/${digest}.pdf`);
    expect(hoursSourcePath('org-1', 'week-1', digest, 'image/jpeg')).toBe(`org-1/week-1/${digest}.jpg`);
    expect(hoursSourcePath('org-1', 'week-1', digest, 'image/png')).toBe(`org-1/week-1/${digest}.png`);
    expect(hoursSourcePath('org-1', 'week-1', digest,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(`org-1/week-1/${digest}.xlsx`);
    expect(hoursSourcePath('org-1', 'week-1', digest, 'application/vnd.ms-excel')).toBe(`org-1/week-1/${digest}.xls`);
  });

  it('formats sizes for a reader instead of raw bytes', () => {
    expect(formatSourceSize(512)).toBe('512 B');
    expect(formatSourceSize(2048)).toBe('2 kB');
    expect(formatSourceSize(3 * 1024 * 1024)).toBe('3,0 MB');
  });
});

describe('source provenance', () => {
  it('names manual entry and an uploaded original differently', () => {
    expect(describeSourceReferences([{ kind: 'manual', label: 'Handmatige invoer' }]))
      .toEqual([{ kind: 'manual', label: 'Handmatige invoer', reference: null }]);
    expect(describeSourceReferences([{ kind: 'upload', label: 'week36.pdf', reference: 'pagina 2' }]))
      .toEqual([{ kind: 'upload', label: 'week36.pdf', reference: 'pagina 2' }]);
    expect(sourceOriginText([{ kind: 'upload', label: 'week36.pdf', reference: 'pagina 2' }]))
      .toBe('week36.pdf · pagina 2');
  });

  it('keeps an unknown future kind readable rather than presenting it as manual entry', () => {
    expect(describeSourceReferences([{ kind: 'mailbox', label: 'RE: uren week 35' }]))
      .toEqual([{ kind: 'unknown', label: 'RE: uren week 35', reference: null }]);
    expect(sourceOriginText([])).toBe('Bron niet beschikbaar');
    expect(sourceOriginText(undefined)).toBe('Bron niet beschikbaar');
    expect(describeSourceReferences([{ kind: 'upload' }])).toEqual([{ kind: 'upload', label: 'Geüpload bestand', reference: null }]);
  });
});

describe('what applying a proposal changes', () => {
  const proposal = { minutes: 285, no_hours_reason: null, note: null, source_input: null };

  it('shows the correction against the current day version', () => {
    expect(proposalChanges(proposal, { minutes: 570, noHoursReason: null, notes: null }))
      .toEqual([{ field: 'Uren', current: '9:30 uur', proposed: '4:45 uur' }]);
  });

  it('marks a day that has no version yet as not received', () => {
    expect(proposalChanges(proposal, null)[0])
      .toEqual({ field: 'Uren', current: 'nog niet ontvangen', proposed: '4:45 uur' });
  });

  it('reports no change when the proposal matches the current version exactly', () => {
    expect(proposalChanges({ minutes: 480, no_hours_reason: null, note: 'Bron', source_input: shiftSource },
      { minutes: 480, noHoursReason: null, notes: 'Bron', sourceInput: shiftSource })).toEqual([]);
  });

  it('separates an explicit zero with a reason from missing hours', () => {
    expect(proposalChanges({ minutes: 0, no_hours_reason: 'Ziek', note: null, source_input: null },
      { minutes: 480, noHoursReason: null, notes: null }))
      .toEqual([{ field: 'Uren', current: '8:00 uur', proposed: 'geen uren (Ziek)' }]);
  });

  it('flags added shift details as a change of their own', () => {
    const changes = proposalChanges({ minutes: 480, no_hours_reason: null, note: null, source_input: shiftSource },
      { minutes: 480, noHoursReason: null, notes: null, sourceInput: null });
    expect(changes).toEqual([{ field: 'Aangeleverde details', current: 'geen diensttijden of broncategorieën', proposed: '1 dienst' }]);
  });
});

describe('week source projection', () => {
  const projection = {
    week_id: '00000000-0000-4000-8000-000000000001', can_manage: true, client_links: [],
    open_proposals: 1, undecided_assignments: 0,
    sources: [{
      id: '00000000-0000-4000-8000-000000000002', file_name: 'week36.pdf', content_type: 'application/pdf',
      byte_size: 2048, content_hash: 'b'.repeat(64), storage_path: 'org/week/hash.pdf',
      created_at: '2026-09-08T08:00:00Z', page_count: 1, client_link_id: null, pages: [],
      proposals: [{
        id: '00000000-0000-4000-8000-000000000003', day_id: '00000000-0000-4000-8000-000000000004',
        member_id: '00000000-0000-4000-8000-000000000005', work_date: '2026-09-07',
        candidate_name: 'Testmedewerker', status: 'open', minutes: 480, no_hours_reason: null,
        note: null, source_input: shiftSource, page_label: 'pagina 1', page_number: 1,
        assignment_uncertain: false, assignment_confirmed_at: null, assignment_note: null,
        applied_revision_id: null,
        applied_created_revision: null, resolution_note: null, resolved_at: null,
        created_at: '2026-09-08T08:05:00Z',
      }],
    }],
  };

  it('survives a frontend that arrives before the migration', () => {
    // The migration lands first in this repo, but if that order ever slips the
    // whole intake panel must not break over one missing key.
    const { client_links: _links, ...older } = projection;
    const { client_link_id: _id, ...olderSource } = projection.sources[0];
    const parsed = parseWeekSources({ ...older, sources: [olderSource] });
    expect(parsed.client_links).toEqual([]);
    expect(parsed.sources[0].client_link_id).toBeNull();
  });

  it('accepts the server projection and keeps the exact source facts', () => {
    const parsed = parseWeekSources(projection);
    expect(parsed.sources[0].proposals[0].source_input).toEqual(shiftSource);
    expect(parsed.sources[0].proposals[0].status).toBe('open');
  });

  it('refuses a projection that does not match the contract instead of rendering it', () => {
    expect(() => parseWeekSources({ ...projection, sources: [{ ...projection.sources[0], byte_size: 'veel' }] })).toThrow();
    expect(() => parseWeekSources({ ...projection, can_manage: 'ja' })).toThrow();
  });
});

describe('which client deliveries a reviewer sees', () => {
  const proposal = (id: string, status: 'open' | 'applied' | 'discarded') => ({
    id, day_id: id, member_id: id, work_date: '2026-09-07', candidate_name: 'A',
    status, minutes: 480, no_hours_reason: null, note: null, source_input: null,
    page_label: null, page_number: null, assignment_uncertain: false,
    assignment_confirmed_at: null, assignment_note: null,
    uncertain_fields: null, values_confirmed_at: null, values_note: null, applied_revision_id: null,
    applied_created_revision: null, resolution_note: null, resolved_at: null,
    created_at: '2026-09-08T08:00:00Z',
  });

  it('shows what still asks for a decision and hides the history', () => {
    const all = [proposal('a', 'open'), proposal('b', 'discarded'), proposal('c', 'applied')];
    expect(visibleClientProposals(all, new Set(), false).map(item => item.id)).toEqual(['a']);
    expect(visibleClientProposals(all, new Set(), true).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a delivery the reviewer just handled in view', () => {
    // The confirmation of what applying did lives in that row; dropping it the
    // moment the status changes would take the answer away with it.
    const all = [proposal('a', 'open'), proposal('c', 'applied')];
    expect(visibleClientProposals(all, new Set(['c']), false).map(item => item.id)).toEqual(['a', 'c']);
  });
});

describe('source pages and assignment', () => {
  const day = (id: string) => `00000000-0000-4000-8000-00000000000${id}`;
  const page = (overrides: Record<string, unknown> = {}) => ({
    id: day('7'), page_number: 1, assignment: 'single', member_id: day('5'),
    candidate_name: 'Testmedewerker', note: null, created_at: '2026-09-08T08:10:00Z', ...overrides,
  });
  const proposal = (overrides: Record<string, unknown> = {}) => ({
    id: day('3'), day_id: day('4'), member_id: day('5'), work_date: '2026-09-07',
    candidate_name: 'Testmedewerker', status: 'open' as HoursSourceProposal['status'],
    minutes: 480, no_hours_reason: null,
    note: null, source_input: null, page_label: null, page_number: 1, assignment_uncertain: false,
    assignment_confirmed_at: null, assignment_note: null,
    uncertain_fields: null, values_confirmed_at: null, values_note: null, applied_revision_id: null,
    applied_created_revision: null, resolution_note: null, resolved_at: null,
    created_at: '2026-09-08T08:05:00Z', ...overrides,
  });
  const projection = (overrides: Record<string, unknown> = {}, sourceOverrides: Record<string, unknown> = {}) => ({
    week_id: day('1'), can_manage: true, open_proposals: 1, undecided_assignments: 0, client_links: [],
    sources: [{
      id: day('2'), file_name: 'week36.pdf', content_type: 'application/pdf', byte_size: 2048,
      content_hash: 'b'.repeat(64), storage_path: 'org/week/hash.pdf', created_at: '2026-09-08T08:00:00Z',
      page_count: 4, client_link_id: null, pages: [page()], proposals: [proposal()], ...sourceOverrides,
    }],
    ...overrides,
  });

  it('keeps the page a proposal came from and the recorded doubt about who it is', () => {
    const parsed = parseWeekSources(projection(
      { undecided_assignments: 1 },
      { proposals: [proposal({ assignment_uncertain: true })] },
    ));
    expect(parsed.sources[0].page_count).toBe(4);
    expect(parsed.sources[0].proposals[0].page_number).toBe(1);
    expect(parsed.sources[0].proposals[0].assignment_uncertain).toBe(true);
    expect(parsed.undecided_assignments).toBe(1);
    expect(parsed.sources[0].pages[0].assignment).toBe('single');
    expect(parsed.sources[0].pages[0].candidate_name).toBe('Testmedewerker');
  });

  it('accepts an older source whose page count nobody could determine', () => {
    const parsed = parseWeekSources(projection({}, {
      page_count: null, client_link_id: null, pages: [], proposals: [proposal({ page_number: null })],
    }));
    expect(parsed.sources[0].page_count).toBeNull();
    expect(parsed.sources[0].proposals[0].page_number).toBeNull();
  });

  it('refuses a page decision outside the three the contract allows', () => {
    expect(() => parseWeekSources(projection({}, { pages: [page({ assignment: 'misschien' })] }))).toThrow();
  });

  it('blocks applying while the employee behind a proposal is undecided', () => {
    expect(proposalIsBlocked(proposal({ assignment_uncertain: true }))).toBe(true);
    expect(proposalIsBlocked(proposal({
      assignment_uncertain: true, assignment_confirmed_at: '2026-09-08T09:00:00Z',
    }))).toBe(false);
    expect(proposalIsBlocked(proposal())).toBe(false);
    // A discarded proposal blocks nothing, matching the server's open-point count.
    expect(proposalIsBlocked(proposal({
      status: 'discarded' as HoursSourceProposal['status'], assignment_uncertain: true,
    }))).toBe(false);
  });

  it('names the page a revision came from so the employee can find it back', () => {
    expect(sourceOriginText([{ kind: 'upload', label: 'week36.pdf', reference: 'pagina 2 · tabelregel 4' }]))
      .toBe('week36.pdf · pagina 2 · tabelregel 4');
  });
});

describe('a reading that was not sure of itself', () => {
  const id = (last: string) => `00000000-0000-4000-8000-00000000000${last}`;
  const proposal = (overrides: Record<string, unknown> = {}) => ({
    id: id('3'), day_id: id('4'), member_id: id('5'), work_date: '2026-09-07',
    candidate_name: 'Testmedewerker', status: 'open' as HoursSourceProposal['status'],
    minutes: 480, no_hours_reason: null, note: null, source_input: null,
    page_label: 'regel 3', page_number: 1, assignment_uncertain: false,
    assignment_confirmed_at: null, assignment_note: null,
    uncertain_fields: null, values_confirmed_at: null, values_note: null, applied_revision_id: null,
    applied_created_revision: null, resolution_note: null, resolved_at: null,
    created_at: '2026-09-08T08:05:00Z', ...overrides,
  });
  const projection = (overrides: Record<string, unknown> = {}, proposalOverrides: Record<string, unknown> = {}) => ({
    week_id: id('1'), can_manage: true, open_proposals: 1, undecided_assignments: 0,
    uncertain_values: 0, client_links: [],
    sources: [{
      id: id('2'), file_name: 'week37.jpg', content_type: 'image/jpeg', byte_size: 2048,
      content_hash: 'b'.repeat(64), storage_path: 'org/week/hash.jpg', created_at: '2026-09-08T08:00:00Z',
      page_count: 1, client_link_id: null, pages: [], proposals: [proposal(proposalOverrides)],
    }],
    ...overrides,
  });

  it('keeps which fields the reading was unsure of', () => {
    const parsed = parseWeekSources(projection({ uncertain_values: 1 },
      { uncertain_fields: ['total', 'break'] }));
    expect(parsed.sources[0].proposals[0].uncertain_fields).toEqual(['total', 'break']);
    expect(parsed.uncertain_values).toBe(1);
  });

  it('refuses a field label the contract does not have', () => {
    expect(() => parseWeekSources(projection({}, { uncertain_fields: ['handschrift'] }))).toThrow();
  });

  it('survives a projection that predates this migration', () => {
    const older = projection();
    delete (older as Record<string, unknown>).uncertain_values;
    const parsed = parseWeekSources(older);
    expect(parsed.uncertain_values).toBe(0);
    expect(parsed.sources[0].proposals[0].uncertain_fields).toBeNull();
  });

  it('blocks applying while values read as uncertain are unconfirmed', () => {
    expect(proposalIsBlocked(proposal({ uncertain_fields: ['total'] }))).toBe(true);
    expect(proposalIsBlocked(proposal({
      uncertain_fields: ['total'], values_confirmed_at: '2026-09-08T09:00:00Z',
    }))).toBe(false);
    // Both doubts have to be settled, not one of the two.
    expect(proposalIsBlocked(proposal({
      uncertain_fields: ['total'], values_confirmed_at: '2026-09-08T09:00:00Z',
      assignment_uncertain: true,
    }))).toBe(true);
    expect(proposalIsBlocked(proposal({
      status: 'applied' as HoursSourceProposal['status'], uncertain_fields: ['total'],
    }))).toBe(false);
  });

  it('says in plain words what a reading was unsure about', () => {
    expect(describeUncertainFields(['total'])).toBe('het aantal uren');
    expect(describeUncertainFields(['total', 'break'])).toBe('het aantal uren en de pauze');
    expect(describeUncertainFields(['shift', 'categories', 'reason']))
      .toBe('de diensttijd, de urensoorten en de reden');
    expect(describeUncertainFields(null)).toBe('');
  });
});
