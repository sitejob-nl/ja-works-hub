import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getMatchStatusMeta,
  isTerminalMatchStatus,
  requiresMatchFeedbackReason,
  shouldUsePlacementFlow,
  getNextMatchStatus,
  matchStatusNeedsFeedbackDialog,
  getStatusAgeLabel,
} from '@/lib/match-status';

describe('getMatchStatusMeta', () => {
  it('geeft de meta van een bekende stap terug', () => {
    expect(getMatchStatusMeta('nieuwe_match').label).toBe('Nieuwe match');
    expect(getMatchStatusMeta('voorgesteld_bij_klant').label).toBe('Bij klant');
  });

  it('kent de plaatsings-status', () => {
    const meta = getMatchStatusMeta('geplaatst');
    expect(meta.label).toBe('Geplaatst');
    expect(meta.color).toBe('bg-emerald-700');
  });

  it('valt voor een onbekende status terug op een nette underscore-vrije label', () => {
    const meta = getMatchStatusMeta('in_gesprek');
    expect(meta.key).toBe('in_gesprek');
    expect(meta.label).toBe('in gesprek');
  });

  it('geeft "Onbekend" bij null/undefined', () => {
    expect(getMatchStatusMeta(null).label).toBe('Onbekend');
    expect(getMatchStatusMeta(undefined).key).toBe('onbekend');
  });
});

describe('isTerminalMatchStatus', () => {
  it('herkent terminale statussen', () => {
    expect(isTerminalMatchStatus('afgewezen')).toBe(true);
    expect(isTerminalMatchStatus('geaccepteerd')).toBe(true);
    expect(isTerminalMatchStatus('geplaatst')).toBe(true);
  });

  it('is false voor lopende statussen en leeg', () => {
    expect(isTerminalMatchStatus('voorgesteld')).toBe(false);
    expect(isTerminalMatchStatus(null)).toBe(false);
  });
});

describe('requiresMatchFeedbackReason', () => {
  it('vereist een reden bij afwijzen, niet bij accepteren', () => {
    expect(requiresMatchFeedbackReason('afgewezen')).toBe(true);
    expect(requiresMatchFeedbackReason('geaccepteerd')).toBe(false);
  });
});

describe('shouldUsePlacementFlow', () => {
  it('is alleen waar voor geplaatst', () => {
    expect(shouldUsePlacementFlow('geplaatst')).toBe(true);
    expect(shouldUsePlacementFlow('geaccepteerd')).toBe(false);
  });
});

describe('getNextMatchStatus', () => {
  it('schuift de flow op', () => {
    expect(getNextMatchStatus('nieuwe_match')).toBe('gescreend');
    expect(getNextMatchStatus('afspraak_op_kantoor')).toBe('geaccepteerd');
  });

  it('laat dormante in_gesprek-rijen nog doorschuiven', () => {
    expect(getNextMatchStatus('in_gesprek')).toBe('geaccepteerd');
  });

  it('geeft null op een terminale of onbekende status', () => {
    expect(getNextMatchStatus('geaccepteerd')).toBeNull();
    expect(getNextMatchStatus('iets_anders')).toBeNull();
  });
});

describe('matchStatusNeedsFeedbackDialog', () => {
  it('vraagt een dialog bij terminaal maar niet geplaatst', () => {
    expect(matchStatusNeedsFeedbackDialog('afgewezen')).toBe(true);
    expect(matchStatusNeedsFeedbackDialog('geaccepteerd')).toBe(true);
  });

  it('niet bij geplaatst of een lopende status', () => {
    expect(matchStatusNeedsFeedbackDialog('geplaatst')).toBe(false);
    expect(matchStatusNeedsFeedbackDialog('voorgesteld')).toBe(false);
  });
});

describe('getStatusAgeLabel', () => {
  afterEach(() => vi.useRealTimers());

  const freeze = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00Z'));
  };

  it('geeft null zonder bron', () => {
    expect(getStatusAgeLabel(null, null)).toBeNull();
  });

  it('geeft null bij een onparseerbare datum', () => {
    expect(getStatusAgeLabel('not-a-date')).toBeNull();
  });

  it('toont vandaag/1 dag/N dagen', () => {
    freeze();
    expect(getStatusAgeLabel('2026-06-27T10:00:00Z')).toBe('vandaag gewijzigd');
    expect(getStatusAgeLabel('2026-06-26T12:00:00Z')).toBe('1 dag in status');
    expect(getStatusAgeLabel('2026-06-25T12:00:00Z')).toBe('2 dagen in status');
  });

  it('laat statusChangedAt voorgaan op createdAt', () => {
    freeze();
    expect(getStatusAgeLabel('2026-06-27T10:00:00Z', '2020-01-01T00:00:00Z')).toBe('vandaag gewijzigd');
  });
});
