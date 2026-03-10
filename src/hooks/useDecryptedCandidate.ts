import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useDecryptedCandidate(candidateId: string | undefined) {
  return useQuery({
    queryKey: ['candidate-decrypted', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_candidate_decrypted', {
        p_candidate_id: candidateId!,
      } as any);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as { decrypted_bsn: string | null; decrypted_iban: string | null } | null;
    },
    enabled: !!candidateId,
  });
}

export function useMyDecryptedData() {
  return useQuery({
    queryKey: ['my-sensitive-data'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_sensitive_data' as any);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as { decrypted_bsn: string | null; decrypted_iban: string | null } | null;
    },
  });
}
