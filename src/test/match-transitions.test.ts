import { describe, it, expect } from 'vitest';
import { getMatchTransition, matchTransitionNeedsDialog } from '@/lib/match-transitions';

describe('getMatchTransition', () => {
  it('koppelt elke fase aan het werk dat erbij hoort', () => {
    expect(getMatchTransition('voorgesteld').kind).toBe('proposal');
    expect(getMatchTransition('voorgesteld_bij_klant').kind).toBe('proposal');
    expect(getMatchTransition('afspraak_voorgesteld').kind).toBe('interview');
    expect(getMatchTransition('afspraak_op_kantoor').kind).toBe('interview');
    expect(getMatchTransition('geaccepteerd').kind).toBe('placement');
    expect(getMatchTransition('gescreend').kind).toBe('screening');
    expect(getMatchTransition('afgewezen').kind).toBe('feedback');
  });

  it('laat onbekende en tussenliggende fases met rust', () => {
    expect(getMatchTransition('nieuwe_match').kind).toBe('none');
    expect(getMatchTransition(null).kind).toBe('none');
    expect(getMatchTransition('bestaat_niet').kind).toBe('none');
  });

  it('gate-t fases die een gebeurtenis claimen die nog niet heeft plaatsgevonden', () => {
    // Voorgesteld bij de klant = de mail is eruit. Status pas na verzenden.
    expect(getMatchTransition('voorgesteld_bij_klant').commitFirst).toBe(false);
    // Een afspraakfase zonder datum is betekenisloos.
    expect(getMatchTransition('afspraak_op_kantoor').commitFirst).toBe(false);
    expect(getMatchTransition('afgewezen').commitFirst).toBe(false);
  });

  it('schrijft besluiten meteen weg, ook als de vervolgactie nog moet komen', () => {
    // Telefonisch akkoord is akkoord, ook als de plaatsing pas later wordt ingevuld.
    expect(getMatchTransition('geaccepteerd').commitFirst).toBe(true);
    // "Voorstel klaar" is voorbereiding — de editor is een hulpmiddel, geen eis.
    expect(getMatchTransition('voorgesteld').commitFirst).toBe(true);
    expect(getMatchTransition('gescreend').commitFirst).toBe(true);
  });

  it('valt in bulk terug op een kale statuswissel, behalve bij afwijzen', () => {
    expect(getMatchTransition('voorgesteld_bij_klant', 5).kind).toBe('none');
    expect(getMatchTransition('geaccepteerd', 5).kind).toBe('none');
    expect(getMatchTransition('afspraak_op_kantoor', 2).kind).toBe('none');
    // Afwijzen deelt één reden over de hele selectie en werkt dus wél in bulk.
    expect(getMatchTransition('afgewezen', 12).kind).toBe('feedback');
    expect(getMatchTransition('afgewezen', 12).commitFirst).toBe(false);
  });

  it('matchTransitionNeedsDialog volgt dezelfde regels', () => {
    expect(matchTransitionNeedsDialog('geaccepteerd')).toBe(true);
    expect(matchTransitionNeedsDialog('geaccepteerd', 3)).toBe(false);
    expect(matchTransitionNeedsDialog('nieuwe_match')).toBe(false);
  });
});
