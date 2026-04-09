import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';

interface MicrosoftApiOptions {
  endpoint: string;
  method?: string;
  payload?: unknown;
}

export function useMicrosoftApi() {
  const navigate = useNavigate();

  const callApi = useCallback(async ({ endpoint, method = 'GET', payload }: MicrosoftApiOptions) => {
    const { data, error } = await supabase.functions.invoke('microsoft-api', {
      body: { endpoint, method, payload },
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
  }, [navigate]);

  return { callApi };
}
