import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanDeleteFine, useCanDeletePlacement } from '@/hooks/useRecordDeleteAccess';

const state = vi.hoisted(() => ({ role: null as string | null, permission: true }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ role: state.role }) }));
vi.mock('@/hooks/usePermissions', () => ({ useRolePermission: () => state.permission }));

describe('operationele verwijderrechten', () => {
  it.each(['admin', 'backoffice', 'intercedent'])('%s mag boetes en testplaatsingen verwijderen', (role) => {
    state.role = role;
    state.permission = true;
    expect(renderHook(useCanDeleteFine).result.current).toBe(true);
    expect(renderHook(useCanDeletePlacement).result.current).toBe(true);
  });
  it.each(['finance', 'medewerker', 'opdrachtgever', null])('%s krijgt ook met een permissie geen operationeel verwijderrecht', (role) => {
    state.role = role;
    state.permission = true;
    expect(renderHook(useCanDeleteFine).result.current).toBe(false);
    expect(renderHook(useCanDeletePlacement).result.current).toBe(false);
  });
  it('respecteert ingetrokken placements.edit zonder boeterechten te wijzigen', () => {
    state.role = 'intercedent';
    state.permission = false;
    expect(renderHook(useCanDeleteFine).result.current).toBe(true);
    expect(renderHook(useCanDeletePlacement).result.current).toBe(false);
  });
});
