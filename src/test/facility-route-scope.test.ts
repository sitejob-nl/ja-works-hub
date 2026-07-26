import { describe, expect, it } from 'vitest';
import { isFacilityPathAllowed } from '@/lib/facility-access';

describe('Facility route scope', () => {
  it.each([
    '/huisvesting',
    '/transport',
    '/taken',
    '/huisvesting/9f66d46a-a1ee-4d39-8317-14b36f2ae245',
    '/transport/9f66d46a-a1ee-4d39-8317-14b36f2ae245',
  ])('staat de operationele route %s toe', (path) => {
    expect(isFacilityPathAllowed(path)).toBe(true);
  });

  it.each([
    '/',
    '/kandidaten',
    '/medewerkers/9f66d46a-a1ee-4d39-8317-14b36f2ae245',
    '/vacatures',
    '/plaatsingen',
    '/uren',
    '/facturatie',
    '/instellingen',
    '/transport/new',
    '/transport/9f66d46a-a1ee-4d39-8317-14b36f2ae245/bewerken',
    '/tankpas-analyse',
    '/kilometeranalyse',
  ])('weigert de route %s', (path) => {
    expect(isFacilityPathAllowed(path)).toBe(false);
  });
});
