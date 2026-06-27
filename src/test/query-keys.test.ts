import { describe, it, expect } from 'vitest';
import { qk } from '@/lib/query-keys';

// Deze test pint de EXACTE array-vorm van elke qk-entry vast. Dat is de
// gedragsbehoud-vanger van de data-laag-migratie: TanStack invalideert op prefix
// (bv. `['vehicle-damage']`), dus zodra het leidende token van een qk-entry afwijkt
// van het oorspronkelijke ad-hoc token, stopt een scherm stil met auto-verversen.
// Een token-typo faalt hier hard, vóór hij in productie merkbaar wordt.

describe('qk.candidates', () => {
  it('houdt de bestaande tokens verbatim', () => {
    expect(qk.candidates.all('org1')).toEqual(['candidates', 'org1']);
    expect(qk.candidates.list('org1', { status: 'actief' })).toEqual(['candidates', 'org1', 'list', { status: 'actief' }]);
    expect(qk.candidates.list('org1')).toEqual(['candidates', 'org1', 'list', {}]);
    expect(qk.candidates.detail('c1')).toEqual(['candidate', 'c1']);
    expect(qk.candidates.activeForTimesheet()).toEqual(['candidates-active-for-timesheet']);
  });
});

describe('qk.placements', () => {
  it('houdt de bestaande tokens verbatim', () => {
    expect(qk.placements.forEmployee('e1')).toEqual(['placements-for-employee', 'e1']);
    expect(qk.placements.hourTypes('p1')).toEqual(['placement-hour-types', 'p1']);
    expect(qk.placements.travelTypes('p1')).toEqual(['placement-travel-types', 'p1']);
    expect(qk.placements.allowances('p1')).toEqual(['placement-allowances', 'p1']);
  });
});

describe('qk.regulations / talentpools', () => {
  it('houdt de bestaande tokens verbatim', () => {
    expect(qk.regulations.list('org1')).toEqual(['regulations', 'org1']);
    expect(qk.talentpools.forCandidateAdd('org1')).toEqual(['talentpools-for-candidate-add', 'org1']);
  });
});

describe('qk.vehicles', () => {
  it('reproduceert het vehicle-detail token', () => {
    expect(qk.vehicles.detail('v1')).toEqual(['vehicle', 'v1']);
  });
});

describe('qk.transport', () => {
  it('reproduceert de transport-tokens (B3-doel) verbatim', () => {
    expect(qk.transport.damage('v1')).toEqual(['vehicle-damage', 'v1']);
    expect(qk.transport.damagePhotoUrls('v1', ['a/b.jpg'])).toEqual(['vehicle-damage-photo-urls', 'v1', ['a/b.jpg']]);
    expect(qk.transport.damageContactSettings('org1')).toEqual(['damage-contact-settings', 'org1']);
    expect(qk.transport.damageAssignableEmployees('org1', 'e1')).toEqual(['damage-assignable-employees', 'org1', 'e1']);
    expect(qk.transport.damageAssignableEmployees('org1', undefined)).toEqual(['damage-assignable-employees', 'org1', undefined]);
    expect(qk.transport.fines('v1')).toEqual(['vehicle-fines', 'v1']);
    expect(qk.transport.finePhotoUrls('v1', ['x.png'])).toEqual(['vehicle-fine-photo-urls', 'v1', ['x.png']]);
    expect(qk.transport.fineAssignedEmployees('v1')).toEqual(['vehicle-assigned-employees-fines', 'v1']);
    expect(qk.transport.allFines()).toEqual(['transport-fines']);
  });
});
