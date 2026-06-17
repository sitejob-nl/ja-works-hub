import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getExactToken, jsonError, jsonOk } from "../_shared/exact-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const { data: profile } = await supabase.from("profiles").select("organization_id, role").eq("id", user.id).single();
    if (!profile) {
      return jsonError("Profile not found", 404);
    }
    // Financiële actie: alleen admin/backoffice/finance mogen relaties naar Exact pushen (consistent met exact-api).
    if (!["admin", "backoffice", "finance"].includes(profile.role)) {
      return jsonError("Geen toegang tot Exact-synchronisatie", 403);
    }

    const orgId = profile.organization_id;
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { company_id } = body;

    if (!company_id) {
      return jsonError("company_id is required", 400);
    }

    // Fetch Exact config (decrypted)
    const { data: exactConfig, error: configError } = await serviceClient.rpc("get_exact_token", { p_org_id: orgId });
    if (configError || !exactConfig?.length) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }
    const config = exactConfig[0];

    if (!config.tenant_id || !config.decrypted_webhook_secret) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

    // Get fresh token
    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, config.decrypted_webhook_secret);
    } catch (err: unknown) {
      if ((err as Error).message === "REAUTH_REQUIRED") {
        return jsonError("Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.", 401, {
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        });
      }
      throw err;
    }

    // Fetch company
    const { data: company, error: compError } = await serviceClient
      .from("companies")
      .select("*")
      .eq("id", company_id)
      .eq("organization_id", orgId)
      .single();

    if (compError || !company) {
      return jsonError("Opdrachtgever niet gevonden", 404);
    }

    // Build Exact Account payload
    const accountPayload: Record<string, unknown> = {
      Name: company.name,
      Status: "C",
      Country: "NL",
    };
    if (company.email) accountPayload.Email = company.email;
    if (company.phone) accountPayload.Phone = company.phone;
    if (company.address_city) accountPayload.City = company.address_city;
    if (company.address_street) accountPayload.AddressLine1 = company.address_street;
    if (company.address_postal) accountPayload.Postcode = company.address_postal;
    if (company.btw_number) accountPayload.VATNumber = company.btw_number;
    if (company.kvk_number) accountPayload.ChamberOfCommerce = company.kvk_number;
    if (company.website) accountPayload.Website = company.website;

    let exactAccountId = company.exact_account_id;

    if (exactAccountId) {
      // UPDATE existing Account in Exact
      const updateRes = await fetch(
        `${tokenData.base_url}/api/v1/${tokenData.division}/crm/Accounts(guid'${exactAccountId}')`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(accountPayload),
        }
      );

      if (!updateRes.ok) {
        const errBody = await updateRes.text();
        console.error("Update account failed:", errBody);
        return jsonError("Kon account niet bijwerken in Exact", 502, { details: errBody });
      }

      return jsonOk({
        success: true,
        exact_account_id: exactAccountId,
        action: "updated",
        message: `Relatie ${company.name} bijgewerkt in Exact Online`,
      });
    }

    // CREATE new Account in Exact
    const createRes = await fetch(
      `${tokenData.base_url}/api/v1/${tokenData.division}/crm/Accounts`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(accountPayload),
      }
    );

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error("Create account failed:", errBody);
      return jsonError("Kon account niet aanmaken in Exact", 502, { details: errBody });
    }

    const createdAccount = await createRes.json();
    exactAccountId = createdAccount?.d?.ID;

    // Persist exact_account_id on company
    if (exactAccountId) {
      await serviceClient.from("companies").update({ exact_account_id: exactAccountId }).eq("id", company_id);
    }

    return jsonOk({
      success: true,
      exact_account_id: exactAccountId,
      action: "created",
      message: `Relatie ${company.name} aangemaakt in Exact Online`,
    });

  } catch (err) {
    console.error("Exact sync account error:", err);
    return jsonError((err as Error).message || "Internal server error", 500);
  }
});
