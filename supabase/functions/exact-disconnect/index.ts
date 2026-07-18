import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import { clearExactTokenCache, corsHeaders, jsonError, jsonOk } from "../_shared/exact-helpers.ts";

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
    const auth = await requireRolePermission(req, "settings.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: config } = await serviceClient
      .from("exact_config")
      .select("id, tenant_id, webhook_secret")
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    if (!config?.tenant_id || !config?.webhook_secret) {
      return jsonError("Exact Online is niet geregistreerd", 400);
    }

    const webhookSecret = await getWebhookSecret(serviceClient, config.webhook_secret);
    if (!webhookSecret) return jsonError("Webhook secret kan niet worden gelezen", 500);
    clearExactTokenCache(config.tenant_id, webhookSecret);

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

    // Een tenant die Connect niet (meer) kent is geen fout maar het doel: hij is
    // al weg. Zonder deze tak blijft de lokale rij op "gekoppeld" staan en kan de
    // gebruiker níet opnieuw koppelen — de koppeling zit dan muurvast.
    let tenantGone = false;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      tenantGone = response.status === 404 || /tenant\s*not\s*found/i.test(text);
      if (!tenantGone) {
        console.error("Exact Connect disconnect failed:", response.status, text);
        return jsonError("Ontkoppelen bij SiteJob Connect mislukt", 502);
      }
      console.warn("Exact-tenant bestond niet meer bij Connect — lokale koppeling opgeruimd");
    }

    // Bij een normale ontkoppeling blijft de tenant bij Connect bestaan, dus
    // houden we tenant_id + secret zodat opnieuw koppelen via dezelfde setup-link
    // werkt. Is de tenant weg, dan moeten ze juist wél leeg zodat exact-register
    // een verse tenant aanmaakt.
    await serviceClient
      .from("exact_config")
      .update({
        division: null,
        company_name: null,
        base_url: null,
        is_active: false,
        default_journal: null,
        default_glaccount_id: null,
        default_item_id: null,
        default_vat_codes: null,
        defaults_discovered_at: null,
        ...(tenantGone ? { tenant_id: null, webhook_secret: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    return jsonOk({ success: true, tenant_was_missing: tenantGone });
  } catch (err) {
    console.error("exact-disconnect error:", err);
    return jsonError("Interne fout bij ontkoppelen", 500);
  }
});
