import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonOk, jsonError, getAuthenticatedOrg } from "../_shared/whatsapp-utils.ts";

const CONNECT_REGISTER_URL = "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/whatsapp-register-tenant";
const SETUP_BASE_URL = "https://connect.sitejob.nl/whatsapp-setup";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId } = auth;

    // Check existing config
    const { data: existing } = await supabase
      .from("whatsapp_config")
      .select("tenant_id, is_active, phone_number_id")
      .eq("organization_id", orgId)
      .maybeSingle();

    // If already registered, return setup URL (idempotent)
    if (existing?.tenant_id) {
      return jsonOk({
        tenant_id: existing.tenant_id,
        setup_url: `${SETUP_BASE_URL}?tenant_id=${existing.tenant_id}`,
        already_registered: true,
        is_active: existing.is_active,
      });
    }

    // Get org name for registration
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .single();

    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
    const connectApiKey = Deno.env.get("CONNECT_API_KEY");
    if (!connectApiKey) {
      return jsonError("CONNECT_API_KEY not configured", 500);
    }

    // Register tenant at SiteJob Connect
    const response = await fetch(CONNECT_REGISTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": connectApiKey,
      },
      body: JSON.stringify({
        name: org?.name ?? "JA Werkt",
        webhook_url: webhookUrl,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Connect registration failed:", errText);
      return jsonError("Registratie bij SiteJob Connect mislukt", 502);
    }

    const { tenant_id, webhook_secret } = await response.json();

    // Encrypt webhook_secret before storing (no auto-trigger)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: encryptedSecret, error: encError } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: webhook_secret,
    });

    if (encError || !encryptedSecret) {
      console.error("Failed to encrypt webhook_secret:", encError);
      return jsonError("Encryptie mislukt", 500);
    }

    const { error: upsertError } = await serviceClient
      .from("whatsapp_config")
      .upsert(
        { organization_id: orgId, tenant_id, webhook_secret: encryptedSecret, is_active: false },
        { onConflict: "organization_id" }
      );

    if (upsertError) {
      console.error("Config upsert failed:", upsertError);
      return jsonError("Configuratie opslaan mislukt", 500);
    }

    return jsonOk({
      tenant_id,
      setup_url: `${SETUP_BASE_URL}?tenant_id=${tenant_id}`,
      already_registered: false,
    });
  } catch (err) {
    console.error("whatsapp-register error:", err);
    return jsonError("Interne fout", 500);
  }
});
