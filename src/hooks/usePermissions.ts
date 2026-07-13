import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { unwrap } from '@/lib/db';
import {
  INDIVIDUALLY_CONFIGURABLE_ROLES,
  normalizeRolePermissions,
  normalizeUserPermissionOverrides,
  userHasPermission,
  type PermissionKey,
  type UserRole,
} from '@/lib/permissions';
import { qk } from '@/lib/query-keys';

async function fetchRolePermissionState(orgId: string) {
  const data = await unwrap(supabase.from('organizations').select('settings').eq('id', orgId).single());
  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  return {
    settings,
    matrix: normalizeRolePermissions((settings as any)?.role_permissions),
  };
}

export function useRolePermission(permission: PermissionKey) {
  return useRolePermissionAccess(permission).allowed;
}

export function useEffectivePermissions() {
  const orgId = useOrganizationId();
  const { profile, role } = useAuth();

  const roleQuery = useQuery({
    queryKey: qk.permissions.roleMatrix(orgId),
    queryFn: () => fetchRolePermissionState(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const supportsOverrides = !!role && INDIVIDUALLY_CONFIGURABLE_ROLES.includes(role as UserRole);
  const overrideQuery = useQuery({
    queryKey: qk.permissions.userOverrides(orgId, profile?.id ?? ''),
    queryFn: async () => {
      const rows = await unwrap(
        supabase
          .from('user_permission_overrides')
          .select('permission_key, allowed')
          .eq('organization_id', orgId)
          .eq('user_id', profile!.id),
      );
      return normalizeUserPermissionOverrides(rows ?? []);
    },
    enabled: !!orgId && !!profile?.id && supportsOverrides,
    staleTime: 0,
    refetchInterval: supportsOverrides ? 30_000 : false,
  });

  const isAdmin = role === 'admin';
  const isLoading = isAdmin ? false : roleQuery.isLoading || (supportsOverrides && overrideQuery.isLoading);
  const error = isAdmin ? null : roleQuery.error || (supportsOverrides ? overrideQuery.error : null);
  const rolePermissions = roleQuery.data?.matrix;
  const userOverrides = overrideQuery.data ?? {};

  const hasPermission = (permission: PermissionKey): boolean => {
    if (isAdmin) return true;
    if (isLoading || error || !role) return false;
    return userHasPermission(role, permission, rolePermissions, userOverrides);
  };

  return {
    hasPermission,
    rolePermissions,
    userOverrides,
    isLoading,
    error,
  };
}

export function useRolePermissionAccess(permission: PermissionKey) {
  const access = useEffectivePermissions();
  return {
    allowed: access.hasPermission(permission),
    isLoading: access.isLoading,
    error: access.error,
  };
}

export function useRolePermissionMatrix() {
  const orgId = useOrganizationId();

  return useQuery({
    queryKey: qk.permissions.roleMatrix(orgId),
    queryFn: () => fetchRolePermissionState(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  });
}
