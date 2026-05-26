import { describe, expect, it } from 'vitest';
import { calculateCandidateVacancyMatch, normalizeSkillName, shouldShowCandidateForVacancy } from '@/lib/matching';

const vacancy = {
  title: 'MIG-MAG lasser',
  location: 'Eindhoven',
  required_skills: ['MIG-MAG lassen', 'Heftruck'],
  required_certifications: ['VCA'],
  requires_drivers_license: true,
};

describe('Fase 1 vacaturematching', () => {
  it('scores a candidate across skills, certificates, license, location and availability', () => {
    const score = calculateCandidateVacancyMatch({
      skills: ['migmag', 'heftruckchauffeur'],
      certifications: ['VCA Basis'],
      has_drivers_license: true,
      address_city: 'Eindhoven',
      availability_notes: 'Per direct beschikbaar',
      ai_function_group: 'lasser',
      ai_reliability_score: 85,
    }, vacancy, { status: 'ok', durationMin: 24, distanceKm: 18.4 });

    expect(score.label).toBe('groen');
    expect(score.matchPercent).toBeGreaterThanOrEqual(90);
    expect(score.hardBlocks).toEqual([]);
    expect(score.skillMatches).toEqual(['MIG-MAG lassen', 'Heftruck']);
    expect(score.certificationMatches).toEqual(['VCA']);
    expect(score.distance.durationMin).toBe(24);
    expect(score.componentScores.distance).toBe(12);
  });

  it('prefers canonical skill catalog values over legacy text arrays', () => {
    const score = calculateCandidateVacancyMatch({
      skills: ['Administratie'],
      canonical_skills: ['MIG MAG Lassen', 'Heftruck'],
      certifications: ['VCA'],
      has_drivers_license: true,
      availability_notes: 'Beschikbaar',
    }, {
      ...vacancy,
      required_skills: ['Administratie'],
      canonical_required_skills: ['migmag', 'heftruckchauffeur'],
    });

    expect(score.hardBlocks).toEqual([]);
    expect(score.skillMatches).toEqual(['migmag', 'heftruckchauffeur']);
  });

  it('does not block a match when Mapbox distance is unavailable', () => {
    const score = calculateCandidateVacancyMatch({
      skills: ['migmag', 'heftruckchauffeur'],
      certifications: ['VCA Basis'],
      has_drivers_license: true,
      availability_notes: 'Per direct beschikbaar',
    }, vacancy, { status: 'provider_error' });

    expect(score.hardBlocks).toEqual([]);
    expect(score.distance.status).toBe('provider_error');
    expect(score.missing).toContain('Reistijd nog controleren');
  });

  it('normalizes common Fase 1 aliases', () => {
    expect(normalizeSkillName('MIG/MAG')).toBe('mig mag lassen');
    expect(normalizeSkillName('VCA Basis')).toBe('vca');
  });

  it('hides non-matching candidates from the default vacancy shortlist', () => {
    const result = shouldShowCandidateForVacancy({
      skills: ['Administratie'],
      certifications: ['BHV'],
      has_drivers_license: false,
      address_city: 'Tilburg',
    }, vacancy);

    expect(result.show).toBe(false);
    expect(result.score.label).toBe('rood');
    expect(result.score.hardBlocks).toContain('Geen match op verplichte vaardigheden');
    expect(result.score.hardBlocks).toContain('Mist certificaat: VCA');
  });

  it('can include weak matches when the recruiter deliberately broadens the search', () => {
    const result = shouldShowCandidateForVacancy({
      skills: ['Administratie'],
      certifications: ['BHV'],
      has_drivers_license: false,
    }, vacancy, true);

    expect(result.show).toBe(true);
    expect(result.score.matchPercent).toBeLessThan(45);
  });
});
