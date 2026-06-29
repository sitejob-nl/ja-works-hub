import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useRolePermissionMatrix } from '@/hooks/usePermissions';
import { unwrap } from '@/lib/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_LABELS,
  permissionGroups,
  roleHasPermission,
  serializeRolePermissions,
  type PermissionKey,
  type RolePermissionMatrix,
  type UserRole,
} from '@/lib/permissions';

const RolePermissionsSettings = () => {
  const orgId = useOrganizationId();
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useRolePermissionMatrix();
  const groups = useMemo(() => permissionGroups(), []);
  const canManage = role === 'admin' || roleHasPermission(role, 'settings.permissions.manage', (data?.settings as any)?.role_permissions);
  const matrix = data?.matrix ?? DEFAULT_ROLE_PERMISSIONS;

  const saveMutation = useMutation({
    mutationFn: async (nextMatrix: RolePermissionMatrix) => {
      await unwrap((supabase as any).rpc('update_role_permissions', {
        p_role_permissions: serializeRolePermissions(nextMatrix),
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-permissions', orgId] });
      queryClient.invalidateQueries({ queryKey: ['match-pipeline-settings', orgId] });
      queryClient.invalidateQueries({ queryKey: ['organization', orgId] });
      toast.success('Rechten opgeslagen');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setPermission = (targetRole: UserRole, permission: PermissionKey, enabled: boolean) => {
    if (!canManage) return;
    if (targetRole === 'admin' && !enabled) {
      toast.error('Admin behoudt alle rechten');
      return;
    }
    const next = structuredClone(matrix) as RolePermissionMatrix;
    next[targetRole][permission] = enabled;
    saveMutation.mutate(next);
  };

  const resetDefaults = () => {
    if (!canManage) return;
    saveMutation.mutate(DEFAULT_ROLE_PERMISSIONS);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Rollen & rechten
            </CardTitle>
            <CardDescription>Granulaire rechten per rol. Admin behoudt altijd alle rechten.</CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={resetDefaults} disabled={!canManage || saveMutation.isPending}>
            Standaard herstellen
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!canManage && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Alleen admins kunnen rechten aanpassen. Je ziet hier de actieve matrix.
          </div>
        )}

        {isLoading ? (
          <div className="py-6 text-sm text-muted-foreground">Rechten laden...</div>
        ) : (
          Object.entries(groups).map(([group, permissions]) => (
            <section key={group} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{group}</h3>
                <Badge variant="outline" className="text-[11px]">{permissions.length}</Badge>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-[260px] px-3 py-2 text-left font-medium">Recht</th>
                      {CONFIGURABLE_ROLES.map((item) => (
                        <th key={item} className="px-3 py-2 text-center font-medium">{ROLE_LABELS[item]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.map((permission) => (
                      <tr key={permission.key} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{permission.label}</div>
                          <div className="text-xs text-muted-foreground">{permission.description}</div>
                        </td>
                        {CONFIGURABLE_ROLES.map((targetRole) => (
                          <td key={`${targetRole}-${permission.key}`} className="px-3 py-2 text-center">
                            <Switch
                              checked={matrix[targetRole][permission.key]}
                              disabled={!canManage || saveMutation.isPending || targetRole === 'admin'}
                              onCheckedChange={(enabled) => setPermission(targetRole, permission.key, enabled)}
                              aria-label={`${permission.label} voor ${ROLE_LABELS[targetRole]}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
};

export default RolePermissionsSettings;
