export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

export interface ExactTokenResponse {
  access_token: string;
  division: number;
  region: string;
  base_url: string;
  expires_at: string;
}

/**
 * Get a fresh Exact Online access token via SiteJob Connect.
 * Tokens expire after 10 minutes — always call this before each API request.
 */
export async function getExactToken(tenantId: string, webhookSecret: string): Promise<ExactTokenResponse> {
  const res = await fetch("https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/exact-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, secret: webhookSecret }),
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.needs_reauth) {
      throw new Error("REAUTH_REQUIRED");
    }
    throw new Error(data.error || "Token ophalen mislukt");
  }
  return data as ExactTokenResponse;
}

/** Standard JSON error response with CORS */
export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error: message, ...extra }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/** Standard JSON success response with CORS */
export function jsonOk(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
