import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import {
  classifyExactProviderError,
  corsHeaders,
  getExactToken,
  jsonError,
  jsonOk,
  sanitizeExactErrorDetail,
} from "../_shared/exact-helpers.ts";

function odataString(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

function exactApiUrl(baseUrl: string, division: number, path: string, params: Record<string, string>): string {
  const url = new URL(`${baseUrl}/api/v1/${division}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireRolePermission(req, "finance.manage", corsHeaders);
    if (auth instanceof Response) return auth;
    const orgId = auth.organizationId;
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
        exactApiUrl(tokenData.base_url, tokenData.division, "crm/Accounts", {
          "$filter": `Name eq '${odataString(company.name)}'`,
          "$select": "ID,Name",
          "$top": "1",
        }),
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
          const errBody = sanitizeExactErrorDetail(await createAccountRes.text());
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

    // Step 2: Build SalesInvoice lines by splitting each invoice line into its
    // billable components (basis-uren, overwerk, reis, toeslagen). Each component
    // carries its own NetPrice + the matching grootboekrekening, so the Exact line
    // total equals our line_total (incl. toeslagen) and omzet wordt op de juiste
    // GL-rekening geboekt.
    // NB: AmountFC is een BEREKEND (read-only) veld in Exact en mag NIET worden
    // meegestuurd — Exact leidt het bedrag af uit Quantity × NetPrice. Het oude
    // gedrag (Quantity=uren × NetPrice=uurtarief) liet overwerk/reis/toeslagen weg.
    const glFor = (code: string): string | undefined => glMap.get(code) ?? glMap.get("normaal");

    const exactLines: any[] = [];
    for (const l of (lines || []) as any[]) {
      const lineTotal = Number(l.line_total) || 0;
      const desc = l.description || "Werkzaamheden";
      const parts: Array<{ Description: string; Quantity: number; NetPrice: number; code: string }> = [];

      const baseHours = Number(l.hours) || 0;
      const baseRate = Number(l.hourly_rate) || 0;
      if (baseHours !== 0 && baseRate !== 0) {
        parts.push({ Description: desc, Quantity: baseHours, NetPrice: baseRate, code: "normaal" });
      }

      const otHours = Number(l.overtime_hours) || 0;
      const otRate = Number(l.overtime_rate) || 0;
      if (otHours !== 0 && otRate !== 0) {
        parts.push({ Description: `${desc} — overwerk`, Quantity: otHours, NetPrice: otRate, code: "overwerk" });
      }

      const travel = Number(l.travel_amount) || 0;
      if (travel !== 0) {
        parts.push({ Description: `${desc} — reiskosten`, Quantity: 1, NetPrice: travel, code: "reis" });
      }

      // allowances_amount/surcharge_amount dragen geen specifiek toeslag-type, dus
      // vallen die terug op de 'normaal'-grootboekrekening.
      const allowances = Number(l.allowances_amount) || 0;
      if (allowances !== 0) {
        parts.push({ Description: `${desc} — toeslagen`, Quantity: 1, NetPrice: allowances, code: "normaal" });
      }

      const surcharge = Number(l.surcharge_amount) || 0;
      if (surcharge !== 0) {
        parts.push({ Description: `${desc} — toeslag`, Quantity: 1, NetPrice: surcharge, code: "normaal" });
      }

      // Garandeer dat het Exact-regeltotaal exact gelijk is aan line_total: als er
      // geen ontleedbare componenten zijn, stuur één regel voor het volledige bedrag;
      // anders corrigeer een eventueel restant (afronding of niet-gemapte bedragen).
      const partsSum = parts.reduce((s, p) => s + p.Quantity * p.NetPrice, 0);
      const residual = Math.round((lineTotal - partsSum) * 100) / 100;
      if (parts.length === 0) {
        parts.push({ Description: desc, Quantity: 1, NetPrice: lineTotal, code: "normaal" });
      } else if (Math.abs(residual) >= 0.01) {
        // Mag in de praktijk niet voorkomen (line_total == som van componenten).
        // Loggen zodat een toekomstige afwijking in de regelopbouw zichtbaar wordt
        // i.p.v. stil te verdwijnen achter een 'overig'-regel.
        console.warn(`Exact sync: regelrestant €${residual} (factuur ${invoice_id}, regel "${desc}") — line_total wijkt af van som componenten`);
        parts.push({ Description: `${desc} — overig`, Quantity: 1, NetPrice: residual, code: "normaal" });
      }

      for (const p of parts) {
        const exactLine: any = { Description: p.Description, Quantity: p.Quantity, NetPrice: p.NetPrice };
        const gl = glFor(p.code);
        if (gl) exactLine.GLAccount = gl;
        exactLines.push(exactLine);
      }
    }

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
      const errBody = sanitizeExactErrorDetail(await createInvoiceRes.text());
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
    const classified = classifyExactProviderError(err);
    return jsonError(classified.publicCode, classified.httpStatus, {
      provider_status: classified.providerStatus,
      detail: classified.detail,
    });
  }
});
