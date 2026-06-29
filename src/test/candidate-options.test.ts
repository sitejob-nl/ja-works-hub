import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  CANDIDATE_SOURCES,
  includeCurrentOption,
  normalizeCandidateSource,
  normalizeCountry,
} from '@/lib/candidate-options';

describe('candidate sources', () => {
  it('biedt vaste bronnen en houdt legacy waarden zichtbaar', () => {
    expect(CANDIDATE_SOURCES.map((source) => source.value)).toContain('E-mail');
    expect(CANDIDATE_SOURCES.map((source) => source.value)).toContain('Meta Ads');
    expect(normalizeCandidateSource('linkedin')).toBe('LinkedIn');
    expect(includeCurrentOption(CANDIDATE_SOURCES, 'Jobboard X')[0]).toEqual({
      value: 'Jobboard X',
      label: 'Jobboard X (legacy)',
    });
  });
});

describe('country options', () => {
  it('normaliseert meeting-aliassen naar Nederlandse labels', () => {
    expect(normalizeCountry('Latvian')).toBe('Letland');
    expect(normalizeCountry('Latvia')).toBe('Letland');
    expect(normalizeCountry('Belarus')).toBe('Wit-Rusland');
  });

  it('bevat een wereldwijde landenlijst', () => {
    expect(COUNTRIES.length).toBeGreaterThan(180);
    expect(COUNTRIES.map((country) => country.value)).toContain('Nieuw-Zeeland');
  });
});
