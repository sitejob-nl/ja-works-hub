import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import { getExactConnectUrl, getExactToken } from "../_shared/exact-helpers.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const SETUP_BASE_URL = "https://connect.sitejob.nl/exact-setup";

function connectErrorMessage(data: any, fallback: string): string {
  const message = data?.error ?? data?.message ?? data?.details?.error ?? data?.details?.message;
  return typeof message === "string" && message.trim() ? message.slice(0, 500) : fallback.slice(0, 500);
}

/**
 * Bestaat de geregistreerde tenant nog bij SiteJob Connect? Alleen een expliciete
 * "tenant not found" telt als dood — een verlopen autorisatie (needs_reauth) of
 * een tijdelijke storing betekent juist dat de bestaande tenant bruikbaar is en
 * de setup-link opnieuw doorlopen moet worden.
 */
async function isTenantAlive(serviceClient: any, organizationId: string): Promise<boolean> {
  const { data, error } = await serviceClient.rpc("get_exact_token", { p_org_id: organizationId });
  const config = data?.[0];
  if (error || !config?.tenant_id || !config?.decrypted_webhook_secret) return true;

  try {
    await getExactToken(config.tenant_id, config.decrypted_webhook_secret);
    return true;
  } catch (err) {
    return (err as Error).message !== "TENANT_NOT_FOUND";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireRolePermission(req, "settings.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    // Derive org_id from the authenticated user; ignore any body.organization_id.
    const organization_id = auth.organizationId;
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const forceNewTenant = body?.force === true;

    const { data: existing } = await serviceClient
      .from("exact_config")
      .select("id, tenant_id, is_active, division")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (existing?.tenant_id && existing.is_active && !forceNewTenant) {
      // Controleer of de tenant bij Connect nog bestaat vóór we de gebruiker naar
      // de setup-link sturen. Een tenant kan aan broker-zijde verdwijnen; dan is
      // opnieuw registreren de enige uitweg en zou teruggeven van de oude
      // tenant_id de gebruiker in een doodlopende flow zetten.
      const alive = await isTenantAlive(serviceClient, organization_id);

      if (alive) {
        return new Response(
          JSON.stringify({
            success: true,
            tenant_id: existing.tenant_id,
            setup_url: `${SETUP_BASE_URL}?tenant_id=${existing.tenant_id}`,
            already_registered: true,
            is_active: existing.is_active,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.warn("Exact-tenant bestaat niet meer bij Connect — nieuwe registratie wordt aangemaakt");
      await serviceClient
        .from("exact_config")
        .update({
          tenant_id: null,
          webhook_secret: null,
          division: null,
          company_name: null,
          base_url: null,
          is_active: false,
          default_journal: null,
          default_glaccount_id: null,
          default_item_id: null,
          default_vat_codes: null,
          defaults_discovered_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }

    const CONNECT_API_KEY = Deno.env.get("CONNECT_API_KEY");
    if (!CONNECT_API_KEY) {
      return new Response(JSON.stringify({ error: "CONNECT_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/exact-webhook?organization_id=${encodeURIComponent(organization_id)}`;

    const registerRes = await fetch(
      getExactConnectUrl("exact-register-tenant"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": CONNECT_API_KEY,
        },
        body: JSON.stringify({
          name: `Org ${organization_id}`,
          webhook_url: webhookUrl,
          region: "nl",
        }),
      }
    );

    const registerText = await registerRes.text();
    let registerBody: any = {};
    try {
      registerBody = registerText ? JSON.parse(registerText) : {};
    } catch {
      registerBody = { raw: registerText };
    }

    if (!registerRes.ok) {
      const errText = connectErrorMessage(registerBody, registerText || `HTTP ${registerRes.status}`);
      console.error("Register tenant failed:", registerRes.status, errText);
      return new Response(JSON.stringify({ error: `Failed to register tenant: ${errText}`, details: registerBody }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenant_id, webhook_secret } = registerBody;
    if (!tenant_id || !webhook_secret) {
      return new Response(JSON.stringify({ error: "Connect returned incomplete tenant data" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: encryptedSecret, error: encError } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: webhook_secret,
    });
    if (encError || !encryptedSecret) {
      console.error("Encrypt Exact webhook_secret failed:", encError);
      return new Response(JSON.stringify({ error: "Failed to encrypt webhook secret" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upsertError } = await serviceClient
      .from("exact_config")
      .upsert(
        {
          organization_id,
          tenant_id,
          webhook_secret: encryptedSecret,
          division: null,
          company_name: null,
          base_url: null,
          is_active: false,
        },
        { onConflict: "organization_id" },
      );

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to save config" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ success: true, tenant_id, setup_url: `${SETUP_BASE_URL}?tenant_id=${tenant_id}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
