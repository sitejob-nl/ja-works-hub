import { describe, expect, it } from 'vitest';
import {
  effectivePermissionDecision,
  normalizeRolePermissions,
  normalizeUserPermissionOverrides,
  roleHasPermission,
  userHasPermission,
} from '@/lib/permissions';

describe('role permissions', () => {
  it('geeft admin standaard alle rechten en finance geen matchmutaties', () => {
    expect(roleHasPermission('admin', 'matching.drag_drop')).toBe(true);
    expect(roleHasPermission('admin', 'settings.permissions.manage')).toBe(true);
    expect(roleHasPermission('finance', 'matching.pipeline.view')).toBe(true);
    expect(roleHasPermission('finance', 'matching.status.update')).toBe(false);
    expect(roleHasPermission('backoffice', 'settings.manage')).toBe(false);
    expect(roleHasPermission('backoffice', 'finance.manage')).toBe(false);
    expect(roleHasPermission('backoffice', 'vacancies.edit')).toBe(false);
  });

  it('houdt Facility hard op nul rechten, ook bij organisatie- en gebruikersoverrides', () => {
    const rolePermissions = {
      facility: {
        'candidates.view': true,
        'vacancies.view': true,
        'placements.view': true,
        'finance.view': true,
        'settings.manage': true,
      },
    };
    const userOverrides = {
      'candidates.view': true,
      'finance.view': true,
      'settings.manage': true,
    };

    expect(normalizeRolePermissions(rolePermissions).facility['candidates.view']).toBe(false);
    expect(roleHasPermission('facility', 'vacancies.view', rolePermissions)).toBe(false);
    expect(userHasPermission('facility', 'placements.view', rolePermissions, userOverrides)).toBe(false);
    expect(userHasPermission('facility', 'finance.view', rolePermissions, userOverrides)).toBe(false);
    expect(userHasPermission('facility', 'settings.manage', rolePermissions, userOverrides)).toBe(false);
  });

  it('kan rechten per rol overschrijven vanuit organization settings', () => {
    const matrix = normalizeRolePermissions({
      finance: {
        'matching.status.update': true,
        'matching.drag_drop': true,
      },
      intercedent: {
        'matching.proposal.send': false,
      },
    });

    expect(matrix.finance['matching.status.update']).toBe(true);
    expect(matrix.finance['matching.drag_drop']).toBe(true);
    expect(matrix.intercedent['matching.proposal.send']).toBe(false);
    expect(matrix.intercedent['matching.pipeline.view']).toBe(true);
  });

  it('laat opgeslagen JSON adminrechten niet uitschakelen', () => {
    const matrix = normalizeRolePermissions({
      admin: {
        'matching.pipeline.view': false,
        'settings.permissions.manage': false,
      },
    });

    expect(matrix.admin['matching.pipeline.view']).toBe(true);
    expect(matrix.admin['settings.permissions.manage']).toBe(true);
    expect(roleHasPermission('admin', 'matching.pipeline.view', {
      admin: { 'matching.pipeline.view': false },
    })).toBe(true);
  });

  it('ondersteunt legacy arrayvorm maar negeert onbekende permissies', () => {
    const matrix = normalizeRolePermissions({
      backoffice: ['matching.pipeline.view', 'matching.status.update', 'unknown.permission'],
    });

    expect(matrix.backoffice['matching.pipeline.view']).toBe(true);
    expect(matrix.backoffice['matching.status.update']).toBe(true);
    expect(matrix.backoffice['matching.drag_drop']).toBe(false);
  });

  it('laat een individuele toestemming voorgaan op de rol', () => {
    const decision = effectivePermissionDecision(
      'backoffice',
      'vacancies.edit',
      undefined,
      { 'vacancies.edit': true },
    );

    expect(decision).toEqual({ allowed: true, source: 'user_allow' });
    expect(userHasPermission('backoffice', 'vacancies.edit', undefined, { 'vacancies.edit': true })).toBe(true);
  });

  it('laat een individuele blokkade voorgaan op een toegestaan rolrecht', () => {
    const decision = effectivePermissionDecision(
      'intercedent',
      'candidates.screening.manage',
      undefined,
      { 'candidates.screening.manage': false },
    );

    expect(decision).toEqual({ allowed: false, source: 'user_deny' });
    expect(userHasPermission('intercedent', 'candidates.screening.manage', undefined, { 'candidates.screening.manage': false })).toBe(false);
  });

  it('kan adminrechten niet via een gebruikersuitzondering beperken', () => {
    expect(userHasPermission('admin', 'settings.manage', undefined, { 'settings.manage': false })).toBe(true);
    expect(effectivePermissionDecision('admin', 'settings.manage', undefined, { 'settings.manage': false }).source).toBe('admin');
  });

  it('negeert individuele uitzonderingen voor portalrollen en onbekende waarden', () => {
    expect(userHasPermission('medewerker', 'finance.view', undefined, { 'finance.view': true })).toBe(false);
    expect(normalizeUserPermissionOverrides({
      'vacancies.edit': true,
      'unknown.permission': true,
      'finance.manage': 'yes',
    })).toEqual({ 'vacancies.edit': true });
  });

  it('houdt kandidaten bewerken en finance beheren uitsluitend op rolniveau', () => {
    expect(normalizeUserPermissionOverrides({
      'candidates.edit': false,
      'finance.manage': true,
      'vacancies.edit': true,
    })).toEqual({ 'vacancies.edit': true });
    expect(userHasPermission('intercedent', 'candidates.edit', undefined, { 'candidates.edit': false })).toBe(true);
    expect(userHasPermission('backoffice', 'finance.manage', undefined, { 'finance.manage': true })).toBe(false);
  });
});
