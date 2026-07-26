import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isFacilityPathAllowed, isFacilityRole } from '@/lib/facility-access';

const FacilityRouteScope = ({ children }: { children: ReactNode }) => {
  const { role } = useAuth();
  const location = useLocation();

  if (isFacilityRole(role) && !isFacilityPathAllowed(location.pathname)) {
    return <Navigate to="/huisvesting" replace />;
  }

  return <>{children}</>;
};

export default FacilityRouteScope;
