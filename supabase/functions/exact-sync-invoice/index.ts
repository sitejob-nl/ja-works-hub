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

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) {
      return jsonError("Profile not found", 404);
    }

    const orgId = profile.organization_id;
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { invoice_id } = body;

    if (!invoice_id) {
      return jsonError("invoice_id is required", 400);
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

    // Fetch invoice + lines + company
    const { data: invoice, error: invError } = await serviceClient
      .from("invoices")
      .select("*, companies(*)")
      .eq("id", invoice_id)
      .eq("organization_id", orgId)
      .single();

    if (invError || !invoice) {
      return jsonError("Factuur niet gevonden", 404);
    }

    if (invoice.exact_invoice_id) {
      return jsonError("Factuur is al naar Exact gesynchroniseerd", 409, {
        exact_invoice_id: invoice.exact_invoice_id,
      });
    }

    const { data: lines } = await serviceClient
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", invoice_id)
      .order("sort_order");

    // Fetch GLAccount mappings for this org
    const { data: glMappings } = await serviceClient
      .from("exact_glaccount_mappings")
      .select("hour_type_code, gl_account_id")
      .eq("organization_id", orgId);

    const glMap = new Map<string, string>();
    if (glMappings) {
      for (const m of glMappings) {
        glMap.set(m.hour_type_code, m.gl_account_id);
      }
    }

    const company = invoice.companies;

    // Step 1: Find or create Account in Exact
    let exactAccountId: string | null = company?.exact_account_id || null;

    if (!exactAccountId && company) {
      // Search by name
      const accountSearchRes = await fetch(
        `${tokenData.base_url}/api/v1/${tokenData.division}/crm/Accounts?$filter=Name eq '${encodeURIComponent(company.name)}'&$select=ID,Name`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" } }
      );
      const accountSearchData = await accountSearchRes.json();
      const existingAccounts = accountSearchData?.d?.results || [];

      if (existingAccounts.length > 0) {
        exactAccountId = existingAccounts[0].ID;
      } else {
        // Create account with correct field mappings
        const createAccountRes = await fetch(
          `${tokenData.base_url}/api/v1/${tokenData.division}/crm/Accounts`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              Name: company.name,
              Status: "C",
              Email: company.email || undefined,
              Phone: company.phone || undefined,
              City: company.address_city || undefined,
              AddressLine1: company.address_street || undefined,
              Postcode: company.address_postal || undefined,
              VATNumber: company.btw_number || undefined,
              ChamberOfCommerce: company.kvk_number || undefined,
              Country: "NL",
            }),
          }
        );

        if (!createAccountRes.ok) {
          const errBody = await createAccountRes.text();
          console.error("Create account failed:", errBody);
          await serviceClient.from("invoices").update({ exact_sync_error: `Account aanmaken mislukt: ${errBody}` }).eq("id", invoice_id);
          return jsonError("Kon account niet aanmaken in Exact", 502, { details: errBody });
        }

        const createdAccount = await createAccountRes.json();
        exactAccountId = createdAccount?.d?.ID;
      }

      // Persist exact_account_id on company
      if (exactAccountId) {
        await serviceClient.from("companies").update({ exact_account_id: exactAccountId }).eq("id", company.id);
      }
    }

    if (!exactAccountId) {
      await serviceClient.from("invoices").update({ exact_sync_error: "Kon geen Exact account ID verkrijgen" }).eq("id", invoice_id);
      return jsonError("Kon geen Exact account ID verkrijgen", 500);
    }

    // Step 2: Build invoice lines with optional GLAccount
    const exactLines = (lines || []).map((l: any) => {
      const line: any = {
        Description: l.description,
        Quantity: Number(l.hours) || 1,
        NetPrice: Number(l.hourly_rate) || Number(l.line_total) || 0,
        AmountFC: Number(l.line_total),
      };

      // Add GLAccount if mapping exists for this hour type
      // Invoice lines may reference a placement_hour_type via description or a dedicated field
      // Try to match on known hour type codes
      if (l.hour_type_code && glMap.has(l.hour_type_code)) {
        line.GLAccount = glMap.get(l.hour_type_code);
      } else if (glMap.has("normaal")) {
        // Fallback to default "normaal" mapping
        line.GLAccount = glMap.get("normaal");
      }

      return line;
    });

    // Step 3: Create SalesInvoice
    const exactInvoicePayload: any = {
      OrderedBy: exactAccountId,
      Description: `Factuur ${invoice.invoice_number}`,
      YourRef: invoice.reference || invoice.invoice_number,
      PaymentCondition: "30",
      SalesInvoiceLines: exactLines,
    };

    const createInvoiceRes = await fetch(
      `${tokenData.base_url}/api/v1/${tokenData.division}/salesinvoice/SalesInvoices`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(exactInvoicePayload),
      }
    );

    if (!createInvoiceRes.ok) {
      const errBody = await createInvoiceRes.text();
      console.error("Create invoice failed:", errBody);
      await serviceClient.from("invoices").update({ exact_sync_error: `Factuur aanmaken mislukt: ${errBody}` }).eq("id", invoice_id);
      return jsonError("Kon factuur niet aanmaken in Exact", 502, { details: errBody });
    }

    const createdInvoice = await createInvoiceRes.json();
    const exactInvoiceId = createdInvoice?.d?.InvoiceID || createdInvoice?.d?.ID;

    // Step 4: Update our invoice with Exact reference + clear error
    await serviceClient.from("invoices").update({
      exact_invoice_id: exactInvoiceId,
      exact_sync_error: null,
      status: invoice.status === "concept" ? "definitief" : invoice.status,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice_id);

    return jsonOk({
      success: true,
      exact_invoice_id: exactInvoiceId,
      exact_account_id: exactAccountId,
      message: `Factuur ${invoice.invoice_number} succesvol gesynchroniseerd naar Exact Online`,
    });

  } catch (err) {
    console.error("Exact sync error:", err);
    return jsonError((err as Error).message || "Internal server error", 500);
  }
});
