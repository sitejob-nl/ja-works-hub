import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { unwrap } from '@/lib/db';
import { normalizeRolePermissions, roleHasPermission, type PermissionKey } from '@/lib/permissions';

export function useRolePermission(permission: PermissionKey) {
  return useRolePermissionAccess(permission).allowed;
}

export function useRolePermissionAccess(permission: PermissionKey) {
  const orgId = useOrganizationId();
  const { role } = useAuth();

  const query = useQuery({
    queryKey: ['role-permissions', orgId],
    queryFn: async () => {
      const data = await unwrap(supabase.from('organizations').select('settings').eq('id', orgId!).single());
      return data?.settings as Record<string, unknown> | null;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return {
    allowed: roleHasPermission(role, permission, (query.data as any)?.role_permissions),
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useRolePermissionMatrix() {
  const orgId = useOrganizationId();

  return useQuery({
    queryKey: ['role-permissions', orgId],
    queryFn: async () => {
      const data = await unwrap(supabase.from('organizations').select('settings').eq('id', orgId!).single());
      return {
        settings: (data?.settings as Record<string, unknown> | null) ?? {},
        matrix: normalizeRolePermissions((data?.settings as any)?.role_permissions),
      };
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}
