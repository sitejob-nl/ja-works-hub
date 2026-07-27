import { supabase } from '@/integrations/supabase/client';
import type { DomainType } from '@/lib/public-url';

export type OrganizationDomain = {
  id: string;
  domain: string;
  apex_domain: string;
  domain_type: DomainType;
  primary_hostname: string;
  is_primary: boolean;
  status: 'pending' | 'verified' | 'misconfigured' | 'error' | 'removed';
  dns_config: any;
  verification: any;
  last_checked_at: string | null;
  verified_at: string | null;
  created_at: string;
};

export type DnsRecord = {
  type?: string;
  name?: string;
  value?: string;
  purpose?: string;
};

export function recordLabel(record: DnsRecord) {
  return [record.type, record.name, record.value].filter(Boolean).join(' ');
}

/**
 * Roept de `domain-management` edge function aan. De function antwoordt fouten als
 * `{ error }` — zowel in een non-2xx body als in een 200 — dus beide paden worden hier
 * naar een Error omgezet zodat callers alleen een succespayload zien.
 */
export async function invokeDomainManagement<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('domain-management', { body });
  if (error) {
    const response = (error as any).context;
    if (response?.clone) {
      try {
        const payload = await response.clone().json();
        throw new Error(payload?.error || error.message);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== error.message) throw parseError;
      }
    }
    throw new Error(error.message || 'Domeinactie mislukt');
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}
