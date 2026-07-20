import { describe, it, expect } from 'vitest';
import {
  MATCHABLE_CANDIDATE_STATUSES,
  UNSCORABLE_CANDIDATE_STATUSES,
  isCandidateMatchable,
  isCandidateScorable,
} from '../../supabase/functions/_shared/matching-core';

describe('toelatingspoort', () => {
  it('laat alleen toegelaten kandidaten in de matchpool', () => {
    expect(isCandidateMatchable('werkzoekend')).toBe(true);
    expect(isCandidateMatchable('beschikbaar')).toBe(true);
  });

  it('houdt nog-niet-beoordeelde kandidaten buiten de pool', () => {
    // 'nieuw' is de status waarop Carerix-imports binnenkomen. Stond die in de pool,
    // dan worden nooit-beoordeelde mensen aan klanten voorgesteld — de reden dat
    // deze poort bestaat. Deze test is de regressiebewaking daarop.
    expect(isCandidateMatchable('nieuw')).toBe(false);
    // 'in_behandeling' = recruiter volgt op, dus vóór het toelatingsbesluit.
    expect(isCandidateMatchable('in_behandeling')).toBe(false);
    expect(isCandidateMatchable('lead')).toBe(false);
    expect(isCandidateMatchable('in_screening')).toBe(false);
    expect(isCandidateMatchable(null)).toBe(false);
  });

  it('weigert scoren voor kandidaten die uit beeld zijn', () => {
    expect(isCandidateScorable('afgewezen')).toBe(false);
    expect(isCandidateScorable('uitgeschreven')).toBe(false);
    expect(isCandidateScorable('niet_beschikbaar')).toBe(false);
  });

  it('staat herberekenen van een bestaande plaatsing wel toe', () => {
    expect(isCandidateScorable('geplaatst')).toBe(true);
    expect(isCandidateScorable('werkzoekend')).toBe(true);
  });

  it('houdt de twee lijsten uit elkaar', () => {
    for (const s of MATCHABLE_CANDIDATE_STATUSES) {
      expect(UNSCORABLE_CANDIDATE_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});
