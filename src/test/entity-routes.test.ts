import { describe, expect, it } from 'vitest';
import { ENTITY_ROUTES, entityPath, type EntityType } from '@/lib/entity-routes';

describe('entityPath', () => {
  it('bouwt detail-paden per entiteittype', () => {
    expect(entityPath('candidate', 'abc')).toBe('/kandidaten/abc');
    expect(entityPath('employee', 'abc')).toBe('/medewerkers/abc');
    expect(entityPath('company', 'c1')).toBe('/opdrachtgevers/c1');
    expect(entityPath('contact', 'k1')).toBe('/contacten/k1');
    expect(entityPath('vacancy', 'v1')).toBe('/vacatures/v1');
    expect(entityPath('placement', 'p1')).toBe('/plaatsingen/p1');
    expect(entityPath('property', 'h1')).toBe('/huisvesting/h1');
    expect(entityPath('vehicle', 't1')).toBe('/transport/t1');
    expect(entityPath('talentpool', 'tp1')).toBe('/talentpools/tp1');
  });

  it('voegt ?tab toe', () => {
    expect(entityPath('company', 'c1', { tab: 'plaatsingen' })).toBe('/opdrachtgevers/c1?tab=plaatsingen');
  });

  it('voegt extra params toe en slaat lege waardes over', () => {
    expect(entityPath('vehicle', 't1', { params: { status: 'actief', leeg: '', niets: undefined, nul: null } })).toBe(
      '/transport/t1?status=actief',
    );
  });

  it('geeft lege string bij ontbrekend id', () => {
    expect(entityPath('candidate', '')).toBe('');
    expect(entityPath('candidate', null)).toBe('');
    expect(entityPath('candidate', undefined)).toBe('');
  });

  it('geeft lege string bij onbekend type', () => {
    expect(entityPath('verzonnen' as EntityType, '1')).toBe('');
  });

  it('elk geregistreerd type levert een geldig detailpad', () => {
    for (const type of Object.keys(ENTITY_ROUTES) as EntityType[]) {
      expect(entityPath(type, '1')).toMatch(/^\/.+\/1$/);
    }
  });
});
