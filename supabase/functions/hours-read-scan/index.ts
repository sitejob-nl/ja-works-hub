import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AiAccountingError } from '../_shared/ai-accounting.ts';
import { createAdminClient, requireRolePermission } from '../_shared/auth.ts';
import { CORS_HEADERS } from '../_shared/http.ts';
import { createHoursScanHandler } from '../_shared/hours-scan-handler.ts';
import { HOURS_SCAN_DEFAULT_MODEL, readScanWithGemini } from '../_shared/hours-scan-gemini.ts';

// Self-auth: a verified active internal finance.manage profile is required before
// anything else. The context read keeps the caller's JWT and RLS, so the database
// authorises the source once more and hands back the only storage path this
// function will ever open. Reading is paid, so it goes through the central AI
// ledger and nothing else; there is no second route beside it.
Deno.serve(createHoursScanHandler({
  authorize: (req) => requireRolePermission(req, 'finance.manage', CORS_HEADERS),
  userRpc: (req, name, args) => createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } }, auth: { persistSession: false } },
  ).rpc(name, args),
  serviceRpc: (name, args) => createAdminClient().rpc(name, args),
  download: async (path) => {
    const { data, error } = await createAdminClient().storage.from('hours-sources').download(path);
    if (error || !data) throw error ?? new Error('source unavailable');
    return new Uint8Array(await data.arrayBuffer());
  },
  read: (request) => {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new AiAccountingError('scan_provider_unconfigured',
        'De uitlezer is niet ingesteld. Leg de uren handmatig als voorstel vast.', 503);
    }
    return readScanWithGemini(request, apiKey, {
      admin: createAdminClient(), organizationId: request.organizationId, userId: request.userId,
      feature: 'hours_scan_reading',
    }, Deno.env.get('HOURS_SCAN_MODEL') || HOURS_SCAN_DEFAULT_MODEL);
  },
}, CORS_HEADERS));
