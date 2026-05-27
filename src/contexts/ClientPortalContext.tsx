import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { useSessionIdleTimeout } from '@/hooks/useSessionIdleTimeout';
import { signOutAndRedirect } from '@/lib/session-security';

type Profile = Tables<'profiles'>;

interface ClientPortalContextType {
  session: Session | null;
  profile: Profile | null;
  contact: any | null;
  company: any | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const ClientPortalContext = createContext<ClientPortalContextType>({
  session: null,
  profile: null,
  contact: null,
  company: null,
  loading: true,
  signOut: async () => {},
});

export const useClientPortal = () => useContext(ClientPortalContext);

export const ClientPortalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contact, setContact] = useState<any | null>(null);
  const [company, setCompany] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async (userId: string) => {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!prof || prof.role !== 'opdrachtgever') {
      navigate('/', { replace: true });
      setLoading(false);
      return;
    }

    setProfile(prof);

    const { data: cc } = await supabase
      .from('company_contacts')
      .select('*, companies!company_contacts_company_id_fkey(id, organization_id, name, timesheet_entry_flow)')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (cc) {
      setContact(cc);
      setCompany((cc as any).companies ?? null);

      // Update portal_last_login silently
      supabase
        .from('company_contacts')
        .update({ portal_last_login: new Date().toISOString() })
        .eq('id', cc.id)
        .then(() => {});
    }

    setLoading(false);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        setTimeout(() => loadData(session.user.id), 0);
      } else {
        setProfile(null);
        setContact(null);
        setCompany(null);
        setLoading(false);
        navigate('/klantportaal/login', { replace: true });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadData(session.user.id);
      } else {
        setLoading(false);
        navigate('/klantportaal/login', { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    setProfile(null);
    setContact(null);
    setCompany(null);
    await signOutAndRedirect('/klantportaal/login');
  };

  useSessionIdleTimeout(!!session, signOut);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ClientPortalContext.Provider value={{ session, profile, contact, company, loading, signOut }}>
      {children}
    </ClientPortalContext.Provider>
  );
};
