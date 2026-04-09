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

/**
 * @param selectedAccount - 'org' for org default, or a user_id for personal account
 */
export function useMicrosoftApi(selectedAccount?: string) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const orgId = profile?.organization_id;

  // Determine which user_id to send:
  // - 'org' or undefined → null (org default)
  // - user_id string → that specific user's token
  const resolvedUserId = selectedAccount && selectedAccount !== 'org' ? selectedAccount : null;

  const callApi = useCallback(async ({ endpoint, method = 'GET', payload }: MicrosoftApiOptions) => {
    if (!orgId) throw new Error('Niet ingelogd');

    const { data, error } = await supabase.functions.invoke('microsoft-api', {
      body: { endpoint, method, payload, organization_id: orgId, user_id: resolvedUserId },
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
  }, [navigate, orgId, resolvedUserId]);

  return { callApi };
}
