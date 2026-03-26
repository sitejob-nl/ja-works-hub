import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Get fresh Exact token via SiteJob Connect
async function getExactToken(tenantId: string, webhookSecret: string) {
  const res = await fetch("https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/exact-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, secret: webhookSecret }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.needs_reauth) throw new Error("REAUTH_REQUIRED");
    throw new Error(data.error || "Token ophalen mislukt");
  }
  return data as { access_token: string; division: number; base_url: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orgId = profile.organization_id;
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { invoice_id } = body;

    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "invoice_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch Exact config (decrypted)
    const { data: exactConfig, error: configError } = await serviceClient.rpc("get_exact_token", { p_org_id: orgId });
    if (configError || !exactConfig?.length) {
      return new Response(JSON.stringify({ error: "Exact Online niet geconfigureerd" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const config = exactConfig[0];

    // Get fresh token
    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, config.decrypted_webhook_secret);
    } catch (err: unknown) {
      if ((err as Error).message === "REAUTH_REQUIRED") {
        return new Response(JSON.stringify({
          error: "Exact Online koppeling verlopen",
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      return new Response(JSON.stringify({ error: "Factuur niet gevonden" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (invoice.exact_invoice_id) {
      return new Response(JSON.stringify({ error: "Factuur is al naar Exact gesynchroniseerd", exact_invoice_id: invoice.exact_invoice_id }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lines } = await serviceClient.from("invoice_lines").select("*").eq("invoice_id", invoice_id).order("sort_order");

    // Step 1: Find or create Account in Exact
    const company = invoice.companies;
    let exactAccountId: string | null = null;

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
      // Create account
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
            City: company.city || undefined,
            AddressLine1: company.address || undefined,
            Postcode: company.postal_code || undefined,
            VATNumber: company.vat_number || undefined,
            ChamberOfCommerce: company.kvk_number || undefined,
            Country: "NL",
          }),
        }
      );

      if (!createAccountRes.ok) {
        const errBody = await createAccountRes.text();
        console.error("Create account failed:", errBody);
        return new Response(JSON.stringify({ error: "Kon account niet aanmaken in Exact", details: errBody }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const createdAccount = await createAccountRes.json();
      exactAccountId = createdAccount?.d?.ID;
    }

    if (!exactAccountId) {
      return new Response(JSON.stringify({ error: "Kon geen Exact account ID verkrijgen" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 2: Create SalesInvoice with lines
    // Build invoice lines for Exact (using GLAccount if available, otherwise description-only)
    const exactLines = (lines || []).map((l: any) => ({
      Description: l.description,
      Quantity: Number(l.hours) || 1,
      NetPrice: Number(l.hourly_rate) || Number(l.line_total) || 0,
      AmountFC: Number(l.line_total),
    }));

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
      return new Response(JSON.stringify({ error: "Kon factuur niet aanmaken in Exact", details: errBody }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const createdInvoice = await createInvoiceRes.json();
    const exactInvoiceId = createdInvoice?.d?.InvoiceID || createdInvoice?.d?.ID;

    // Step 3: Update our invoice with Exact reference
    await serviceClient.from("invoices").update({
      exact_invoice_id: exactInvoiceId,
      status: invoice.status === "concept" ? "definitief" : invoice.status,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice_id);

    return new Response(JSON.stringify({
      success: true,
      exact_invoice_id: exactInvoiceId,
      exact_account_id: exactAccountId,
      message: `Factuur ${invoice.invoice_number} succesvol gesynchroniseerd naar Exact Online`,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Exact sync error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
