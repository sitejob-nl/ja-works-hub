import { Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRolePermissionAccess } from '@/hooks/usePermissions';
import type { PermissionKey } from '@/lib/permissions';

type PermissionRouteProps = {
  permission: PermissionKey;
  children: ReactNode;
};

const PermissionRoute = ({ permission, children }: PermissionRouteProps) => {
  const { allowed, isLoading, error } = useRolePermissionAccess(permission);

  if (isLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Rechten controleren...</div>;
  }

  if (error) {
    return (
      <div className="mx-auto mt-10 flex max-w-lg gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div>
          <h1 className="font-medium">Rechten konden niet worden gecontroleerd</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ververs de pagina of neem contact op met een beheerder.</p>
        </div>
      </div>
    );
  }

  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default PermissionRoute;
