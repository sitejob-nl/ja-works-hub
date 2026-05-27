import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useSessionIdleTimeout } from '@/hooks/useSessionIdleTimeout';
import { signOutAndRedirect } from '@/lib/session-security';

interface SuperAdminContextType {
  session: Session | null;
  user: User | null;
  isSuperAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SuperAdminContext = createContext<SuperAdminContextType>({
  session: null,
  user: null,
  isSuperAdmin: false,
  loading: true,
  signOut: async () => {},
});

export const useSuperAdmin = () => useContext(SuperAdminContext);

export const SuperAdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkSuperAdmin = async (userId: string) => {
    const { data, error } = await supabase
      .from('superadmins')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    return !error && !!data;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(async () => {
          const sa = await checkSuperAdmin(session.user.id);
          setIsSuperAdmin(sa);
          setLoading(false);
        }, 0);
      } else {
        setIsSuperAdmin(false);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkSuperAdmin(session.user.id).then((sa) => {
          setIsSuperAdmin(sa);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    setIsSuperAdmin(false);
    await signOutAndRedirect('/superadmin/login');
  };

  useSessionIdleTimeout(!!session, signOut);

  return (
    <SuperAdminContext.Provider value={{ session, user, isSuperAdmin, loading, signOut }}>
      {children}
    </SuperAdminContext.Provider>
  );
};
