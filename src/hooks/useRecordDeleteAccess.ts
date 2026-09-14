import { useAuth } from '@/contexts/AuthContext';
import { useRolePermission } from '@/hooks/usePermissions';

export function useCanDeleteFine() {
  const { role } = useAuth();
  return ['admin', 'backoffice', 'intercedent'].includes(role ?? '');
}

export function useCanDeletePlacement() {
  const operationalRole = useCanDeleteFine();
  const canManage = useRolePermission('placements.edit');
  return operationalRole && canManage;
}
