import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type OutlookCapability = 'mail_read' | 'mail_send' | 'mail_delete' | 'calendar_read' | 'calendar_write' | 'any' | 'none';

export interface OutlookAccount {
  id: string;
  account_id: string;
  credential_account_id: string | null;
  scope: 'organization' | 'personal';
  mode: 'user' | 'shared';
  label: string;
  email: string | null;
  name: string | null;
  status: string;
  status_reason: string | null;
  microsoft_access_ok: boolean;
  is_default_for_organization: boolean;
  is_default_for_user: boolean;
  signature_enabled: boolean;
  signature_html: string | null;
  signature_json: unknown | null;
  capabilities: {
    mail_read: boolean;
    mail_send: boolean;
    mail_delete: boolean;
    calendar_read: boolean;
    calendar_write: boolean;
  };
  ja_grants: {
    mail_read: boolean;
    mail_send: boolean;
    mail_delete: boolean;
    calendar_read: boolean;
    calendar_write: boolean;
  };
}

function capabilityOk(account: OutlookAccount, capability: OutlookCapability) {
  if (capability === 'none') return true;
  if (capability === 'any') {
    return Object.values(account.capabilities).some(Boolean) && Object.values(account.ja_grants).some(Boolean);
  }
  return Boolean(account.capabilities[capability] && account.ja_grants[capability]);
}

function errorMessage(data: any, fallback: string) {
  const raw = data?.error ?? data?.message ?? fallback;
  return typeof raw === 'string' ? raw : raw?.message || fallback;
}

export async function invokeOutlookFunction<T = any>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(errorMessage(data, 'Outlook actie mislukt'));
  return data as T;
}

export function useOutlookInvoke() {
  const navigate = useNavigate();

  return useCallback(async <T = any,>(functionName: string, body: Record<string, unknown>) => {
    try {
      return await invokeOutlookFunction<T>(functionName, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outlook actie mislukt';
      if (/consent|AADSTS65001|reconnect|expired|verlopen|needs_reconnect/i.test(message)) {
        toast.error(/consent|AADSTS65001/i.test(message)
          ? 'Microsoft admin consent ontbreekt. Geef toestemming via Instellingen > Outlook.'
          : 'Outlook koppeling verlopen. Koppel opnieuw via Instellingen.');
        navigate('/instellingen');
      }
      throw error;
    }
  }, [navigate]);
}

export function useOutlookAccounts(capability: OutlookCapability = 'any') {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  const query = useQuery({
    queryKey: ['outlook-accounts-visible', orgId, capability],
    queryFn: async () => {
      const data = await invokeOutlookFunction<{ accounts: OutlookAccount[] }>('outlook-accounts', {
        action: 'visible',
        capability,
      });
      return data.accounts || [];
    },
    enabled: !!orgId,
  });

  const accounts = query.data || [];
  const usableAccounts = accounts.filter((account) => account.microsoft_access_ok && capabilityOk(account, capability));
  const defaultAccount = usableAccounts.find((account) => account.is_default_for_user)
    || usableAccounts.find((account) => account.is_default_for_organization)
    || usableAccounts[0]
    || accounts[0];

  return {
    ...query,
    accounts,
    usableAccounts,
    defaultAccount,
    defaultAccountId: defaultAccount?.account_id,
    hasUsableAccounts: usableAccounts.length > 0,
  };
}
