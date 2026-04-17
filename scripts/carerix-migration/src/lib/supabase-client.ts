import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';

export function createSupabaseClient(config: Config['supabase']): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
