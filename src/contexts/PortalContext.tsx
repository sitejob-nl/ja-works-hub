import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface PortalContextType {
  session: Session | null;
  profile: Profile | null;
  employee: any | null;
  candidate: any | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const PortalContext = createContext<PortalContextType>({
  session: null,
  profile: null,
  employee: null,
  candidate: null,
  loading: true,
  signOut: async () => {},
});

export const usePortal = () => useContext(PortalContext);

export const PortalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [candidate, setCandidate] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPortalData = async (userId: string) => {
    // Fetch profile
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!prof || prof.role !== 'medewerker') {
      // Not a medewerker, redirect to admin
      navigate('/', { replace: true });
      setLoading(false);
      return;
    }

    setProfile(prof);

    // Fetch employee + candidate
    const { data: emp } = await supabase
      .from('employees')
      .select('*, candidates!employees_candidate_id_fkey(*)')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (emp) {
      setEmployee(emp);
      setCandidate(emp.candidates);

      // Update portal_last_login silently
      supabase
        .from('employees')
        .update({ portal_last_login: new Date().toISOString() })
        .eq('id', emp.id)
        .then(() => {});
    }

    setLoading(false);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        setTimeout(() => loadPortalData(session.user.id), 0);
      } else {
        setProfile(null);
        setEmployee(null);
        setCandidate(null);
        setLoading(false);
        navigate('/portaal/login', { replace: true });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadPortalData(session.user.id);
      } else {
        setLoading(false);
        navigate('/portaal/login', { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setEmployee(null);
    setCandidate(null);
    navigate('/portaal/login', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PortalContext.Provider value={{ session, profile, employee, candidate, loading, signOut }}>
      {children}
    </PortalContext.Provider>
  );
};
