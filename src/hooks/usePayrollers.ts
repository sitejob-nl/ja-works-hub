import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrapList } from '@/lib/db';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import type { Payroller } from '@/lib/payroller';

const SELECT = 'id, name, invoiced_by_us, is_active, is_default, sort_order, legacy_key';

/**
 * Payrollers van de eigen organisatie, op weergavevolgorde.
 *
 * Standaard komen ook inactieve rijen mee: bestaande plaatsingen kunnen naar een
 * payroller wijzen die inmiddels is uitgezet, en die moet je in lijsten en op de
 * factuur nog wél kunnen zien. Filter op `is_active` waar je een keuzelijst toont.
 */
export function usePayrollers() {
  const orgId = useOrganizationId();
  return useQuery({
    queryKey: ['payrollers', orgId],
    queryFn: () =>
      unwrapList(
        supabase
          .from('payrollers')
          .select(SELECT)
          .eq('organization_id', orgId)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
      ) as Promise<Payroller[]>,
    staleTime: 5 * 60_000,
  });
}

/** Alleen de payrollers die je nog kunt kiezen bij een nieuwe plaatsing. */
export function useActivePayrollers() {
  const query = usePayrollers();
  return { ...query, data: (query.data ?? []).filter((p) => p.is_active) };
}
