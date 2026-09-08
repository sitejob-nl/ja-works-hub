import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePortal } from '@/contexts/PortalContext';
import { useHoursModuleAccess, type HoursModuleActor } from '@/hooks/useHoursModuleAccess';
import ErrorState from '@/components/shared/ErrorState';

export function HoursModuleGate({ actor, children }: { actor: HoursModuleActor; children: ReactNode }) {
  const access = useHoursModuleAccess(actor);
  if (access.isLoading) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">Toegang controleren…</p>;
  if (access.error) return <ErrorState title="Toegang controleren is niet gelukt" message="Probeer het opnieuw of neem contact op met je beheerder." onRetry={() => void access.refetch()} />;
  if (!access.enabled) return <Navigate to={actor.zone === 'portal' ? '/portaal/uren' : '/uren'} replace />;
  return <>{children}</>;
}

export function InternalHoursModuleRoute({ children }: { children: ReactNode }) {
  const { profile, user, loading } = useAuth();
  return <HoursModuleGate actor={{ organizationId: profile?.id === user?.id ? profile?.organization_id : null, userId: user?.id, zone: 'internal', loading }}>{children}</HoursModuleGate>;
}

export function PortalHoursModuleRoute({ children }: { children: ReactNode }) {
  const { profile, session, loading } = usePortal();
  return <HoursModuleGate actor={{ organizationId: profile?.id === session?.user.id ? profile?.organization_id : null, userId: session?.user.id, zone: 'portal', loading }}>{children}</HoursModuleGate>;
}
