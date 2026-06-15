import { jsonResponse } from './auth.ts';

/**
 * Shared HTTP plumbing for edge functions.
 *
 * ~56 functions currently hand-roll the same CORS headers, OPTIONS preflight and
 * try/catch error envelope. This consolidates that boilerplate without changing any
 * function's behavior: the headers, the OPTIONS response and the `{ error: message }`
 * / 400 shape below are byte-for-byte what those functions already produce.
 *
 * It does NOT touch authentication. The documented self-auth convention
 * (`verify_jwt = false` + manual token verification in the body — see config.toml)
 * stays the responsibility of each handler; for the strict variant use
 * `getAuthenticatedProfile` / `requireInternalProfile` from `_shared/auth.ts`.
 */

/** Canonical CORS headers — identical to the most common hand-rolled set across functions. */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type EdgeHandler = (req: Request) => Promise<Response>;

/**
 * Wrap a handler with the standard CORS preflight + error envelope.
 *
 *   Deno.serve(serveEdge(async (req) => { ... return new Response(...) }));
 *
 * - OPTIONS → 204-style preflight with CORS headers (same as today).
 * - A thrown error → 400 `{ error: message }` with CORS headers (same as today).
 *   Non-Error throws are normalized to a generic message instead of `undefined`.
 */
export function serveEdge(handler: EdgeHandler): EdgeHandler {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Onbekende fout';
      return jsonResponse({ error: message }, 400, CORS_HEADERS);
    }
  };
}
