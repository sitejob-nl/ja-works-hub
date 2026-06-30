import { describe, expect, it } from 'vitest';
import { getMatchFollowupState, normalizeMatchPipelineFollowupDays } from '@/lib/match-followup';

describe('normalizeMatchPipelineFollowupDays', () => {
  it('geeft de standaardwaarde bij ongeldige input', () => {
    expect(normalizeMatchPipelineFollowupDays(null)).toBe(3);
    expect(normalizeMatchPipelineFollowupDays(0)).toBe(3);
    expect(normalizeMatchPipelineFollowupDays('abc')).toBe(3);
  });

  it('begrensd geldige input', () => {
    expect(normalizeMatchPipelineFollowupDays('5')).toBe(5);
    expect(normalizeMatchPipelineFollowupDays(99)).toBe(30);
  });
});

describe('getMatchFollowupState', () => {
  const now = new Date('2026-06-29T12:00:00Z');

  it('waarschuwt bij voorgesteld ouder dan SLA', () => {
    expect(getMatchFollowupState({
      status: 'voorgesteld_bij_klant',
      statusChangedAt: '2026-06-25T12:00:00Z',
      followupDays: 3,
      now,
    })).toEqual({ level: 'warning', label: '4 dagen voorgesteld' });
  });

  it('waarschuwt bij open afspraakvoorstel', () => {
    expect(getMatchFollowupState({
      status: 'afspraak_voorgesteld',
      interviewProposedAt: '2026-06-28T08:00:00Z',
      now,
    }).label).toBe('Afspraakvoorstel opvolgen');
  });

  it('toont een direct actiepunt bij nieuw afspraakvoorstel', () => {
    expect(getMatchFollowupState({
      status: 'afspraak_voorgesteld',
      interviewProposedAt: '2026-06-29T11:30:00Z',
      now,
    })).toEqual({ level: 'warning', label: 'Afspraakvoorstel doorzetten' });
  });

  it('waarschuwt bij verlopen bevestigde afspraak', () => {
    expect(getMatchFollowupState({
      status: 'afspraak_op_kantoor',
      interviewConfirmedAt: '2026-06-29T08:00:00Z',
      now,
    }).label).toBe('Afspraak verlopen');
  });
});
