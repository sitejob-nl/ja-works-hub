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

export function getExactConnectUrl(path: "exact-register-tenant" | "exact-token" | "exact-webhook-router"): string {
  const baseUrl = Deno.env.get("SITEJOB_CONNECT_FUNCTIONS_URL")
    ?? Deno.env.get("CONNECT_FUNCTIONS_URL")
    ?? "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1";
  return `${baseUrl.replace(/\/$/, "")}/${path}`;
}

export function getExactWebhookCallbackUrl(): string {
  return Deno.env.get("EXACT_WEBHOOK_CALLBACK_URL")
    ?? Deno.env.get("CONNECT_EXACT_WEBHOOK_ROUTER_URL")
    ?? getExactConnectUrl("exact-webhook-router");
}

/**
 * Get a fresh Exact Online access token via SiteJob Connect.
 * Tokens expire after 10 minutes — always call this before each API request.
 */
export async function getExactToken(tenantId: string, webhookSecret: string): Promise<ExactTokenResponse> {
  const res = await fetch(getExactConnectUrl("exact-token"), {
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

/** Register webhook subscriptions in Exact Online for the topics JA Werkt syncs back. */
export async function registerExactWebhookSubscriptions(
  baseUrl: string,
  division: number,
  accessToken: string,
) {
  const topics = ["SalesInvoices", "Accounts"];
  const callbackUrl = getExactWebhookCallbackUrl();
  const results: Array<{ topic: string; ok: boolean; status: number; body?: string }> = [];

  for (const topic of topics) {
    try {
      const res = await fetch(
        `${baseUrl}/api/v1/${division}/webhooks/WebhookSubscriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            CallbackURL: callbackUrl,
            Topic: topic,
          }),
        }
      );

      results.push({
        topic,
        ok: res.ok || res.status === 409,
        status: res.status,
        body: res.ok ? undefined : await res.text(),
      });
    } catch (err) {
      results.push({ topic, ok: false, status: 0, body: (err as Error).message });
    }
  }

  return { callback_url: callbackUrl, results };
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
