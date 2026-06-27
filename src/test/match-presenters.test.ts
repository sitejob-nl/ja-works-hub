import { describe, it, expect } from 'vitest';
import {
  toScorePercent,
  getCriticalUnknowns,
  getPrimaryMatchIssue,
  getDecisionConfidence,
  getMatchNextActionLabel,
} from '@/lib/match-presenters';

describe('toScorePercent', () => {
  it('schaalt een 0..1-score naar procenten', () => {
    expect(toScorePercent(0.72)).toBe(72);
    expect(toScorePercent(1)).toBe(100);
    expect(toScorePercent(0)).toBe(0);
  });

  it('laat een reeds-procentuele score staan en clampt op 0..100', () => {
    expect(toScorePercent(85)).toBe(85);
    expect(toScorePercent(140)).toBe(100);
    expect(toScorePercent(-5)).toBe(0);
  });

  it('geeft null voor niet-numerieke input', () => {
    expect(toScorePercent(null)).toBeNull();
    expect(toScorePercent(undefined)).toBeNull();
    expect(toScorePercent('x')).toBeNull();
  });
});

describe('getCriticalUnknowns', () => {
  it('geeft de eerste 3 ontbrekende punten', () => {
    expect(getCriticalUnknowns({ missing: ['a', 'b', 'c', 'd'] })).toEqual(['a', 'b', 'c']);
  });

  it('geeft een lege lijst zonder breakdown', () => {
    expect(getCriticalUnknowns(null)).toEqual([]);
    expect(getCriticalUnknowns({})).toEqual([]);
  });
});

describe('getPrimaryMatchIssue', () => {
  it('geeft voorrang aan een hardblock (rood)', () => {
    expect(getPrimaryMatchIssue({ hardBlocks: ['geen rijbewijs'], missing: ['vca'], positives: ['ervaring'] }))
      .toEqual({ tone: 'red', label: 'geen rijbewijs' });
  });

  it('valt terug op een ontbrekend punt (amber)', () => {
    expect(getPrimaryMatchIssue({ missing: ['vca'], positives: ['ervaring'] }))
      .toEqual({ tone: 'amber', label: 'vca' });
  });

  it('toont anders een positief signaal (groen)', () => {
    expect(getPrimaryMatchIssue({ positives: ['ervaring'] })).toEqual({ tone: 'green', label: 'ervaring' });
  });

  it('geeft null zonder signalen', () => {
    expect(getPrimaryMatchIssue(null)).toBeNull();
    expect(getPrimaryMatchIssue({})).toBeNull();
  });
});

describe('getDecisionConfidence', () => {
  it('geeft "Nog geen score" zonder breakdown', () => {
    expect(getDecisionConfidence(null).label).toBe('Nog geen score');
  });

  it('hardblock → niet direct voorstelbaar', () => {
    expect(getDecisionConfidence({ hardBlocks: ['x'] }).label).toBe('Niet direct voorstelbaar');
  });

  it('ontbrekende punten → eerst controleren', () => {
    expect(getDecisionConfidence({ missing: ['x'] }).label).toBe('Eerst controleren');
  });

  it('groen label → direct voorstelbaar', () => {
    expect(getDecisionConfidence({ label: 'groen' }).label).toBe('Direct voorstelbaar');
  });

  it('anders → recruitercheck nodig', () => {
    expect(getDecisionConfidence({ label: 'oranje' }).label).toBe('Recruitercheck nodig');
  });
});

describe('getMatchNextActionLabel', () => {
  it('een hardblock domineert elke status', () => {
    expect(getMatchNextActionLabel('geaccepteerd', { hardBlocks: ['x'] })).toBe('Blokkade controleren');
  });

  it('ontbrekende punten vragen om uitvragen, behalve bij de klant', () => {
    expect(getMatchNextActionLabel('gescreend', { missing: ['vca'] })).toBe('Open punt uitvragen');
    expect(getMatchNextActionLabel('voorgesteld_bij_klant', { missing: ['vca'] })).toBe('Klant opvolgen');
  });

  it('mapt de status zonder breakdown', () => {
    expect(getMatchNextActionLabel('nieuwe_match')).toBe('Kandidaat screenen');
    expect(getMatchNextActionLabel('geaccepteerd')).toBe('Plaatsing maken');
    expect(getMatchNextActionLabel('geplaatst')).toBe('Geplaatst');
  });

  it('valt terug voor een onbekende status', () => {
    expect(getMatchNextActionLabel('iets_anders')).toBe('Volgende actie bepalen');
  });
});
