import { describe, expect, it } from 'vitest';
import {
  describeSourceReferences, formatSourceSize, hoursSourcePath, hoursSourceTypeError,
  parseWeekSources, proposalChanges, sourceOriginText, HOURS_SOURCE_MAX_BYTES,
} from '@/lib/hours-sources';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

const shiftSource: HoursSourceInput = {
  schemaVersion: 1,
  shifts: [{ start: '08:00', end: '16:30', endDayOffset: 0, breaks: [{ start: '12:00', end: '12:30' }] }],
};

describe('hours source acceptance', () => {
  it.each(['application/pdf', 'image/jpeg', 'image/png'])('accepts %s within the size limit', type => {
    expect(hoursSourceTypeError({ type, size: 2048 })).toBeNull();
  });

  it.each([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'message/rfc822', 'application/msword', 'text/html', '',
  ])('rejects %s with an explanation instead of storing it', type => {
    expect(hoursSourceTypeError({ type, size: 2048 })).toMatch(/Alleen PDF, JPG en PNG/);
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
      .toEqual([{ label: 'Handmatige invoer', reference: null }]);
    expect(describeSourceReferences([{ kind: 'upload', label: 'week36.pdf', reference: 'pagina 2' }]))
      .toEqual([{ label: 'week36.pdf', reference: 'pagina 2' }]);
    expect(sourceOriginText([{ kind: 'upload', label: 'week36.pdf', reference: 'pagina 2' }]))
      .toBe('week36.pdf · pagina 2');
  });

  it('keeps an unknown future kind readable rather than presenting it as manual entry', () => {
    expect(describeSourceReferences([{ kind: 'mailbox', label: 'RE: uren week 35' }]))
      .toEqual([{ label: 'RE: uren week 35', reference: null }]);
    expect(sourceOriginText([])).toBe('Bron niet beschikbaar');
    expect(sourceOriginText(undefined)).toBe('Bron niet beschikbaar');
    expect(describeSourceReferences([{ kind: 'upload' }])).toEqual([{ label: 'Geüpload bestand', reference: null }]);
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
    week_id: '00000000-0000-4000-8000-000000000001', can_manage: true,
    sources: [{
      id: '00000000-0000-4000-8000-000000000002', file_name: 'week36.pdf', content_type: 'application/pdf',
      byte_size: 2048, content_hash: 'b'.repeat(64), storage_path: 'org/week/hash.pdf',
      created_at: '2026-09-08T08:00:00Z',
      proposals: [{
        id: '00000000-0000-4000-8000-000000000003', day_id: '00000000-0000-4000-8000-000000000004',
        member_id: '00000000-0000-4000-8000-000000000005', work_date: '2026-09-07',
        candidate_name: 'Testmedewerker', status: 'open', minutes: 480, no_hours_reason: null,
        note: null, source_input: shiftSource, page_label: 'pagina 1', applied_revision_id: null,
        applied_created_revision: null, resolution_note: null, resolved_at: null,
        created_at: '2026-09-08T08:05:00Z',
      }],
    }],
  };

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
