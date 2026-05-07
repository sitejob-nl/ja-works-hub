import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, profile, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Laden...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-lg bg-card p-8 shadow-sm text-center max-w-md">
          <h2 className="text-lg font-semibold mb-2">Geen profiel gevonden</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Er is geen profiel gekoppeld aan je account. Neem contact op met je beheerder.
          </p>
          <button
            onClick={signOut}
            className="text-sm text-primary hover:underline"
          >
            Uitloggen
          </button>
        </div>
      </div>
    );
  }

  // Medewerker role → redirect to portal
  if (profile.role === 'medewerker') {
    return <Navigate to="/portaal" replace />;
  }

  if (profile.role === 'opdrachtgever') {
    return <Navigate to="/klantportaal" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
