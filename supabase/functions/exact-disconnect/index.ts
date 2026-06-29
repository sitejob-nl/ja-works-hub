import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonError, jsonOk } from "../_shared/exact-helpers.ts";

const CONNECT_DISCONNECT_URL = "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/tenant-disconnect";

async function getWebhookSecret(serviceClient: any, encryptedOrLegacy: string): Promise<string | null> {
  const { data, error } = await serviceClient.rpc("decrypt_sensitive", {
    ciphertext: encryptedOrLegacy,
  });
  if (!error && data) return data;

  // Legacy rows from the old Exact register flow stored the secret plaintext.
  // This keeps disconnect available long enough for exact-config to repair it
  // on the next Connect push.
  return encryptedOrLegacy || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) return jsonError("Unauthorized", 401);

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("organization_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) return jsonError("Missing organization", 400);
    if (profile.role !== "admin") return jsonError("Forbidden — admin only", 403);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: config } = await serviceClient
      .from("exact_config")
      .select("id, tenant_id, webhook_secret")
      .eq("organization_id", profile.organization_id)
      .maybeSingle();

    if (!config?.tenant_id || !config?.webhook_secret) {
      return jsonError("Exact Online is niet geregistreerd", 400);
    }

    const webhookSecret = await getWebhookSecret(serviceClient, config.webhook_secret);
    if (!webhookSecret) return jsonError("Webhook secret kan niet worden gelezen", 500);

    const response = await fetch(CONNECT_DISCONNECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
      },
      body: JSON.stringify({
        tenant_id: config.tenant_id,
        integration: "exact",
        secret: webhookSecret,
        webhook_secret: webhookSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("Exact Connect disconnect failed:", response.status, text);
      return jsonError("Ontkoppelen bij SiteJob Connect mislukt", 502);
    }

    await serviceClient
      .from("exact_config")
      .update({
        division: null,
        company_name: null,
        base_url: null,
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    return jsonOk({ success: true });
  } catch (err) {
    console.error("exact-disconnect error:", err);
    return jsonError("Interne fout bij ontkoppelen", 500);
  }
});
