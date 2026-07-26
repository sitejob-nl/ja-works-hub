import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { UserRole } from '@/lib/permissions';
import { useSessionIdleTimeout } from '@/hooks/useSessionIdleTimeout';
import { signOutAndRedirect } from '@/lib/session-security';

type Profile = Tables<'profiles'>;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Check if the current user has one of the allowed roles. Admin always passes. */
export const useHasRole = (allowedRoles: UserRole[]): boolean => {
  const { role } = useAuth();
  if (!role) return false;
  if (role === 'admin') return true;
  return allowedRoles.includes(role);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data;
  };

  const applyProfile = async (nextProfile: Profile | null) => {
    if (nextProfile && nextProfile.is_active !== true) {
      setProfile(null);
      setSession(null);
      setUser(null);
      setLoading(false);
      await signOutAndRedirect('/login?reason=account-disabled');
      return;
    }

    setProfile(nextProfile);
    setLoading(false);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // Use setTimeout to avoid potential deadlock with Supabase auth
        setTimeout(async () => {
          const p = await fetchProfile(session.user.id);
          await applyProfile(p);
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).then((p) => {
          void applyProfile(p);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    setProfile(null);
    await signOutAndRedirect('/login');
  };

  useSessionIdleTimeout(!!session, signOut);

  return (
    <AuthContext.Provider value={{ session, user, profile, role: (profile?.role as UserRole) ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
