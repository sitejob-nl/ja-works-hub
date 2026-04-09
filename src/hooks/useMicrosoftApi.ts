import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface MicrosoftApiOptions {
  endpoint: string;
  method?: string;
  payload?: unknown;
}

export function useMicrosoftApi() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const orgId = profile?.organization_id;
  const userId = user?.id;

  const callApi = useCallback(async ({ endpoint, method = 'GET', payload }: MicrosoftApiOptions) => {
    if (!orgId) throw new Error('Niet ingelogd');

    const { data, error } = await supabase.functions.invoke('microsoft-api', {
      body: { endpoint, method, payload, organization_id: orgId, user_id: userId },
    });

    if (error) throw new Error(error.message);

    if (data?.needs_reauth) {
      toast.error('Microsoft 365 koppeling verlopen. Koppel opnieuw via Instellingen.');
      navigate('/instellingen');
      throw new Error('REAUTH_REQUIRED');
    }

    if (data?.error) {
      throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Graph API error');
    }

    return data;
  }, [navigate, orgId]);

  return { callApi };
}
