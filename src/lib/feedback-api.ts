import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { extractFunctionErrorMessage } from '@/lib/functionError';

export async function feedbackApi<T>(body: Record<string, unknown>): Promise<T> {
  // Function errors need their response body extracted before the shared unwrap.
  const result = await supabase.functions.invoke<T>('feedback', { body });
  if (result.error?.name === 'FunctionsFetchError' || result.error?.name === 'FunctionsRelayError') {
    throw new Error('Geen verbinding met SiteJob. Probeer opnieuw; dezelfde melding wordt hergebruikt.');
  }
  if (result.error) throw new Error(await extractFunctionErrorMessage(result.error, 'De melding kon niet worden afgerond. Probeer opnieuw.'));
  return unwrap(Promise.resolve({ data: result.data, error: null }));
}
