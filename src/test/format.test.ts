import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDate, formatDateTime, formatRelativeTime, formatDuration, formatEUR } from '@/lib/format';

describe('formatDate', () => {
  it('formatteert een ISO-datum als dd-MM-yyyy', () => {
    expect(formatDate('2026-06-27')).toBe('27-06-2026');
  });

  it('geeft een streepje bij leeg of ongeldig', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('geen-datum')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('voegt tijd toe', () => {
    expect(formatDateTime('2026-06-27T08:05:00')).toBe('27-06-2026 08:05');
  });

  it('geeft een streepje bij leeg', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('toont minuten en seconden', () => {
    expect(formatDuration(90)).toBe('1 min 30 sec');
    expect(formatDuration(59)).toBe('0 min 59 sec');
  });

  it('geeft een streepje bij leeg of 0', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('—');
  });
});

describe('formatEUR', () => {
  it('formatteert nl-NL valuta', () => {
    const out = formatEUR(1234.5);
    expect(out).toContain('€');
    expect(out).toMatch(/1\.234,50/);
  });

  it('geeft een streepje bij null', () => {
    expect(formatEUR(null)).toBe('—');
  });

  it('toont 0 als bedrag (niet als streepje)', () => {
    expect(formatEUR(0)).toMatch(/0,00/);
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('geeft een relatieve afstand met achtervoegsel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00'));
    expect(formatRelativeTime('2026-06-27T11:00:00')).toMatch(/geleden/);
  });

  it('geeft een streepje bij leeg of ongeldig', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime('geen-datum')).toBe('—');
  });
});
