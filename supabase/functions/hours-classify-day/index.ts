import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAdminClient, requireRolePermission } from '../_shared/auth.ts';
import { CORS_HEADERS } from '../_shared/http.ts';
import { createHoursClassificationHandler } from '../_shared/hours-classification.ts';

// Self-auth: a verified active internal finance.manage profile is required before any RPC.
// Context reads retain its JWT/RLS; only the trusted engine result uses service-role finalization.
Deno.serve(createHoursClassificationHandler({
  authorize: (req) => requireRolePermission(req, 'finance.manage', CORS_HEADERS),
  userRpc: (req, name, args) => createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } }, auth: { persistSession: false } },
  ).rpc(name, args),
  serviceRpc: (name, args) => createAdminClient().rpc(name, args),
}, CORS_HEADERS));
