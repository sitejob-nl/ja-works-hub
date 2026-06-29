import { describe, expect, it } from 'vitest';
import { normalizeRolePermissions, roleHasPermission } from '@/lib/permissions';

describe('role permissions', () => {
  it('geeft admin standaard alle rechten en finance geen matchmutaties', () => {
    expect(roleHasPermission('admin', 'matching.drag_drop')).toBe(true);
    expect(roleHasPermission('admin', 'settings.permissions.manage')).toBe(true);
    expect(roleHasPermission('finance', 'matching.pipeline.view')).toBe(true);
    expect(roleHasPermission('finance', 'matching.status.update')).toBe(false);
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
});
