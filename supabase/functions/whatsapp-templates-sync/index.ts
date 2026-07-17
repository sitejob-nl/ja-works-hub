// supabase/functions/whatsapp-templates-sync/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  getWhatsAppCredentials,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireRolePermission(req, "settings.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    const orgId = auth.organizationId;

    // Service client needed for Vault decryption and upsert (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

    // Fetch all templates from Meta (limit=250 per page)
    const metaUrl = `${META_API_BASE}/${creds.waba_id}/message_templates?limit=250`;
    const metaResponse = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${creds.access_token}` },
    });

    if (!metaResponse.ok) {
      const errBody = await metaResponse.json().catch(() => ({}));
      console.error("Meta templates fetch error:", errBody);
      return jsonError(
        "Templates ophalen bij WhatsApp is mislukt. Probeer het later opnieuw.",
        metaResponse.status === 400 ? 400 : 502
      );
    }

    const metaData = await metaResponse.json();
    const metaTemplates: any[] = metaData.data ?? [];

    if (metaTemplates.length === 0) {
      // Nothing from Meta — delete all local templates for this org
      const { error: delError } = await serviceClient
        .from("whatsapp_templates")
        .delete()
        .eq("organization_id", orgId);

      if (delError) console.error("Delete error:", delError);
      return jsonOk({ synced: 0, deleted: 0 });
    }

    // Upsert all templates returned by Meta
    const rows = metaTemplates.map((t) => ({
      organization_id: orgId,
      template_name: t.name,
      language: t.language,
      status: t.status,          // APPROVED / PENDING / REJECTED
      category: t.category,
      components: t.components ?? [],
      last_synced_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await serviceClient
      .from("whatsapp_templates")
      .upsert(rows, { onConflict: "organization_id,template_name,language" });

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return jsonError("Templates opslaan mislukt", 500);
    }

    // Delete templates that no longer exist at Meta
    const metaKeys = metaTemplates.map((t) => `${t.name}__${t.language}`);

    const { data: localTemplates, error: fetchLocalError } = await serviceClient
      .from("whatsapp_templates")
      .select("id, template_name, language")
      .eq("organization_id", orgId);

    if (fetchLocalError) {
      console.error("Fetch local error:", fetchLocalError);
      return jsonError("Lokale templates ophalen mislukt", 500);
    }

    const toDelete = (localTemplates ?? []).filter(
      (row) => !metaKeys.includes(`${row.template_name}__${row.language}`)
    );

    let deleted = 0;
    if (toDelete.length > 0) {
      const deleteIds = toDelete.map((r) => r.id);
      const { error: deleteError } = await serviceClient
        .from("whatsapp_templates")
        .delete()
        .in("id", deleteIds);

      if (deleteError) {
        console.error("Delete stale templates error:", deleteError);
        // Non-fatal — upsert succeeded, just log
      } else {
        deleted = deleteIds.length;
      }
    }

    return jsonOk({ synced: rows.length, deleted });
  } catch (err) {
    console.error("whatsapp-templates-sync error:", err);
    return jsonError("Interne fout bij synchroniseren van templates", 500);
  }
});
