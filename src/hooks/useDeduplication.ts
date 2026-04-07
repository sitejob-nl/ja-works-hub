import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DuplicateCandidate {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  matchedOn: string[];
}

interface DeduplicationInput {
  email?: string;
  phone?: string;
  date_of_birth?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Check for duplicate candidates based on email, phone, or date_of_birth + last_name.
 * Returns matching candidates with reason.
 */
export const useDeduplication = (input: DeduplicationInput, enabled = true) => {
  const hasInput = !!(input.email || input.phone || (input.date_of_birth && input.last_name));

  return useQuery<DuplicateCandidate[]>({
    queryKey: ['dedup-check', input.email, input.phone, input.date_of_birth, input.last_name],
    queryFn: async () => {
      const duplicates: DuplicateCandidate[] = [];
      const seenIds = new Set<string>();

      // Check email match
      if (input.email) {
        const { data } = await supabase
          .from('candidates')
          .select('id, first_name, last_name, email, phone, date_of_birth')
          .ilike('email', input.email)
          .limit(5);
        for (const c of data ?? []) {
          if (!seenIds.has(c.id)) {
            seenIds.add(c.id);
            duplicates.push({ ...c, matchedOn: ['email'] });
          }
        }
      }

      // Check phone match
      if (input.phone && input.phone.length >= 8) {
        const normalized = input.phone.replace(/[\s\-()]/g, '');
        const { data } = await supabase
          .from('candidates')
          .select('id, first_name, last_name, email, phone, date_of_birth')
          .ilike('phone', `%${normalized.slice(-8)}%`)
          .limit(5);
        for (const c of data ?? []) {
          if (seenIds.has(c.id)) {
            const existing = duplicates.find(d => d.id === c.id);
            if (existing) existing.matchedOn.push('telefoon');
          } else {
            seenIds.add(c.id);
            duplicates.push({ ...c, matchedOn: ['telefoon'] });
          }
        }
      }

      // Check date_of_birth + last_name match
      if (input.date_of_birth && input.last_name && input.last_name.length >= 2) {
        const { data } = await supabase
          .from('candidates')
          .select('id, first_name, last_name, email, phone, date_of_birth')
          .eq('date_of_birth', input.date_of_birth)
          .ilike('last_name', input.last_name)
          .limit(5);
        for (const c of data ?? []) {
          if (seenIds.has(c.id)) {
            const existing = duplicates.find(d => d.id === c.id);
            if (existing) existing.matchedOn.push('geboortedatum + achternaam');
          } else {
            seenIds.add(c.id);
            duplicates.push({ ...c, matchedOn: ['geboortedatum + achternaam'] });
          }
        }
      }

      return duplicates;
    },
    enabled: enabled && hasInput,
    staleTime: 10_000,
  });
};
