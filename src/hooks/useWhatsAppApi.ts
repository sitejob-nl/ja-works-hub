import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { getErrorMessage } from '@/lib/error-message';

// Generic API call
async function whatsAppApi(action: string, params?: Record<string, any>) {
  const { data, error } = await supabase.functions.invoke('whatsapp-api', {
    body: { action, ...params },
  });
  // Lees de echte (NL) foutmelding uit de response-body i.p.v. de generieke
  // "Edge Function returned a non-2xx status code" van supabase-js.
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'WhatsApp-actie mislukt'));
  if (data?.error) throw new Error(getErrorMessage(data.error));
  return data;
}

// Query hook for read operations
export function useWhatsAppQuery(action: string, params?: Record<string, any>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['whatsapp-api', action, params],
    queryFn: () => whatsAppApi(action, params),
    enabled: options?.enabled ?? true,
  });
}

// Mutation hook for write operations
export function useWhatsAppMutation(action: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: Record<string, any>) => whatsAppApi(action, params),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['whatsapp-api'] });
    },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

// Pre-built hooks for common operations
export function useWhatsAppProfile(enabled = true) {
  return useWhatsAppQuery('get_profile', undefined, { enabled });
}

export function useWhatsAppPhoneStatus(enabled = true) {
  return useWhatsAppQuery('get_phone_status', undefined, { enabled });
}

export function useWhatsAppTemplates(params?: { status?: string }, enabled = true) {
  return useWhatsAppQuery('list_templates', params, { enabled });
}

export function useWhatsAppQRCodes(enabled = true) {
  return useWhatsAppQuery('list_qr_codes', undefined, { enabled });
}
