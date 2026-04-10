export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VOYS_API_BASE = "https://api.voys.nl/api/v2";
const VOYS_HOLODECK_BASE = "https://api.eu-production.holodeck.voys.nl";
const VOYS_WEBPHONE_BASE = "https://api.voys.nl/api/webphone/user";

/**
 * Determine the correct base URL for a Voys API endpoint.
 */
export function getVoysBaseUrl(endpoint: string): string {
  if (endpoint.startsWith("http")) return "";

  // Holodeck APIs
  if (endpoint.startsWith("contactbook/")) return VOYS_HOLODECK_BASE;
  if (endpoint.startsWith("user-status/")) return VOYS_HOLODECK_BASE;
  if (endpoint.startsWith("transcription-storage/")) return VOYS_HOLODECK_BASE;

  // Webphone API
  if (endpoint.startsWith("webphone/")) return VOYS_WEBPHONE_BASE.replace("/api/webphone/user", "/api/webphone");

  // Default: VoIPgrid API
  return VOYS_API_BASE;
}

/**
 * Call the Voys API with a Bearer token.
 */
export async function callVoysApi(
  apiToken: string,
  endpoint: string,
  method = "GET",
  payload?: unknown,
): Promise<{ data: unknown; status: number; contentType: string }> {
  let fullUrl: string;
  if (endpoint.startsWith("http")) {
    fullUrl = endpoint;
  } else {
    const base = getVoysBaseUrl(endpoint);
    // Strip prefix for holodeck endpoints (they're part of the base path)
    fullUrl = `${base}/${endpoint}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };
  if (payload) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(fullUrl, {
    method: method.toUpperCase(),
    headers,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  const contentType = res.headers.get("content-type") || "";
  let data: unknown;

  if (contentType.includes("text/plain")) {
    data = { text: await res.text() };
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  return { data, status: res.status, contentType };
}
