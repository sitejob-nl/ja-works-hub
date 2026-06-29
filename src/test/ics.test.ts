import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildIcsEvent } from '@/lib/ics';

describe('buildIcsEvent', () => {
  afterEach(() => vi.useRealTimers());

  it('bouwt een geldige calendar invite met UTC tijden en escaped tekst', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T10:00:00Z'));

    const ics = buildIcsEvent({
      uid: 'match-1',
      title: 'Gesprek: Jan, operator',
      description: 'Regel 1\nRegel 2',
      location: 'Kantoor; Tilburg',
      startsAt: '2026-07-01T12:30:00+02:00',
      durationMinutes: 45,
      organizerName: 'JA Werkt',
      organizerEmail: 'planning@example.com',
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20260701T103000Z');
    expect(ics).toContain('DTEND:20260701T111500Z');
    expect(ics).toContain('SUMMARY:Gesprek: Jan\\, operator');
    expect(ics).toContain('LOCATION:Kantoor\\; Tilburg');
    expect(ics).toContain('DESCRIPTION:Regel 1\\nRegel 2');
  });
});
