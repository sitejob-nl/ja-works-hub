import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const META_API_BASE = "https://graph.facebook.com/v25.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

/** Standard JSON success response with CORS */
export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Standard JSON error response with CORS */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Normalize any Dutch phone number format to E.164 (+316xxxxxxxx).
 * Handles: 06-, +316, 00316, 316, with spaces/dashes/parentheses.
 */
export function normalizePhone(phone: string): string {
  // Strip all whitespace, dashes, parentheses
  let digits = phone.replace(/[\s\-().]/g, "");

  // +31... → strip leading +
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  // 0031... → strip leading 00
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // 316xxxxxxxx → already country-prefixed (without +)
  if (digits.startsWith("316") && digits.length === 11) {
    return "+" + digits;
  }

  // 31xxxxxxxxx (9-digit subscriber without mobile prefix) → keep as-is
  if (digits.startsWith("31") && digits.length === 11) {
    return "+" + digits;
  }

  // 06xxxxxxxx → Dutch mobile without country code
  if (digits.startsWith("06") && digits.length === 10) {
    return "+31" + digits.slice(1); // replace leading 0 with +31
  }

  // 6xxxxxxxx → Dutch mobile without leading 0
  if (digits.startsWith("6") && digits.length === 9) {
    return "+31" + digits;
  }

  // Fallback: return with + prefix as-is
  return "+" + digits;
}

export interface WhatsAppCredentials {
  phone_number_id: string;
  access_token: string;
  waba_id: string;
  display_phone: string;
  webhook_secret: string;
}

/**
 * Fetch and decrypt WhatsApp credentials for an organisation.
 * Calls the `get_whatsapp_token` RPC which handles Vault decryption.
 * Returns null when no config exists or on RPC error.
 */
export async function getWhatsAppCredentials(
  supabase: SupabaseClient,
  orgId: string
): Promise<WhatsAppCredentials | null> {
  const { data, error } = await supabase.rpc("get_whatsapp_token", {
    p_org_id: orgId,
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  const row = data[0];
  return {
    phone_number_id: row.phone_number_id,
    access_token: row.decrypted_access_token,
    waba_id: row.waba_id,
    display_phone: row.display_phone,
    webhook_secret: row.decrypted_webhook_secret,
  };
}

export interface AuthenticatedOrg {
  orgId: string;
  userId: string;
}

/**
 * Extract and validate the Bearer token from the request, resolve the user,
 * then look up the user's organisation_id from the profiles table.
 *
 * Returns either an `AuthenticatedOrg` object on success, or a `Response`
 * (error) that the caller should return immediately.
 */
export async function getAuthenticatedOrg(
  req: Request,
  supabase: SupabaseClient
): Promise<AuthenticatedOrg | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonError("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return jsonError("Unauthorized", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return jsonError("Organization not found", 403);
  }

  return { orgId: profile.organization_id, userId: user.id };
}
