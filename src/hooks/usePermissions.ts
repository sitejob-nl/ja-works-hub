import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { unwrap } from '@/lib/db';
import { normalizeRolePermissions, roleHasPermission, type PermissionKey } from '@/lib/permissions';

export function useRolePermission(permission: PermissionKey) {
  const orgId = useOrganizationId();
  const { role } = useAuth();

  const { data: settings } = useQuery({
    queryKey: ['role-permissions', orgId],
    queryFn: async () => {
      const data = await unwrap(supabase.from('organizations').select('settings').eq('id', orgId!).single());
      return data?.settings as Record<string, unknown> | null;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return roleHasPermission(role, permission, (settings as any)?.role_permissions);
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
