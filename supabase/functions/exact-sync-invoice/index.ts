import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import {
  classifyExactProviderError,
  corsHeaders,
  ensureExactDefaults,
  exactApi,
  EXACT_SALES_CREDIT_NOTE_TYPE,
  exactSalesInvoiceType,
  findExactAccountId,
  getExactToken,
  jsonError,
  jsonOk,
  logExactSync,
  sanitizeExactErrorDetail,
  toExactDate,
} from "../_shared/exact-helpers.ts";
import { buildExactInvoiceLineParts } from "../_shared/exact-invoice-lines.ts";

/** Een claim ouder dan dit wordt als verlaten beschouwd (gecrashte run). */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  let orgId: string | null = null;
  let invoiceId: string | null = null;
  let claimed = false;
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  /** Geeft de claim terug zodat een volgende poging niet 5 minuten hoeft te wachten. */
  const releaseClaim = async (syncError: string | null) => {
    if (!claimed || !invoiceId) return;
    await serviceClient
      .from("invoices")
      .update({ exact_sync_started_at: null, exact_sync_error: syncError })
      .eq("id", invoiceId);
  };

  try {
    const auth = await requireRolePermission(req, "finance.manage", corsHeaders);
    if (auth instanceof Response) return auth;
    orgId = auth.organizationId;

    const body = await req.json();
    invoiceId = body?.invoice_id ?? null;
    if (!invoiceId) {
      return jsonError("invoice_id is required", 400);
    }

    // Config: het secret komt via de decrypt-RPC, de administratie-defaults uit
    // de tabel zelf (die staan niet in de RPC-signature).
    const { data: exactConfig, error: configError } = await serviceClient.rpc("get_exact_token", { p_org_id: orgId });
    if (configError || !exactConfig?.length) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }
    const config = exactConfig[0];
    if (!config.tenant_id || !config.decrypted_webhook_secret) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

    const { data: storedDefaults } = await serviceClient
      .from("exact_config")
      .select("default_journal, default_glaccount_id, default_item_id, default_vat_codes")
      .eq("organization_id", orgId)
      .maybeSingle();

    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, config.decrypted_webhook_secret);
    } catch (err: unknown) {
      const message = (err as Error).message;
      if (message === "REAUTH_REQUIRED") {
        return jsonError("Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.", 401, {
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        });
      }
      if (message === "TENANT_NOT_FOUND") {
        return jsonError(
          "De Exact-koppeling bestaat niet meer bij SiteJob Connect. Ontkoppel en koppel opnieuw via Instellingen.",
          409,
          { exact_tenant_not_found: true },
        );
      }
      throw err;
    }

    const { data: invoice, error: invError } = await serviceClient
      .from("invoices")
      .select("*, companies(*)")
      .eq("id", invoiceId)
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

    // Atomaire claim: alleen doorgaan als deze aanroep de factuur daadwerkelijk
    // vastzet. Twee gelijktijdige klikken maakten anders twee facturen in Exact.
    // De milliseconden gaan eruit omdat de waarde in een PostgREST `or`-filter
    // belandt, waar punten scheidingstekens zijn.
    const claimCutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const { data: claimRow, error: claimError } = await serviceClient
      .from("invoices")
      .update({ exact_sync_started_at: new Date().toISOString(), exact_sync_error: null })
      .eq("id", invoiceId)
      .eq("organization_id", orgId)
      .is("exact_invoice_id", null)
      .or(`exact_sync_started_at.is.null,exact_sync_started_at.lt.${claimCutoff}`)
      .select("id")
      .maybeSingle();

    // Een fout hier (bv. een filter die niet parset) mag niet als "al bezig"
    // worden gelezen — dan zou de sync permanent geblokkeerd lijken.
    if (claimError) {
      throw new Error(`Kon de factuur niet vastzetten voor sync: ${claimError.message}`);
    }
    if (!claimRow) {
      return jsonError("Deze factuur wordt al gesynchroniseerd naar Exact", 409, { sync_in_progress: true });
    }
    claimed = true;

    const [{ data: lines }, { data: glMappings }] = await Promise.all([
      serviceClient.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("sort_order"),
      serviceClient
        .from("exact_glaccount_mappings")
        .select("hour_type_code, gl_account_id")
        .eq("organization_id", orgId),
    ]);

    const glMap = new Map<string, string>();
    for (const mapping of glMappings ?? []) {
      glMap.set(mapping.hour_type_code, mapping.gl_account_id);
    }

    // Journal, omzetrekening, artikel en BTW-code zijn administratie-specifiek en
    // verplicht (of sterk aanbevolen) bij een POST. Eén keer ontdekken, daarna
    // hergebruiken.
    const defaults = await ensureExactDefaults(serviceClient, orgId, tokenData, storedDefaults ?? {}, {
      vatRates: [invoice.vat_rate],
    });

    const company = invoice.companies;

    // ── Relatie in Exact bepalen ──────────────────────────────────────────────
    let exactAccountId: string | null = company?.exact_account_id || null;
    let accountMatchedOn: string | null = exactAccountId ? "opgeslagen" : null;

    if (!exactAccountId && company) {
      const match = await findExactAccountId(tokenData, {
        kvkNumber: company.kvk_number,
        vatNumber: company.btw_number,
        email: company.email,
        name: company.name,
      });

      if (match) {
        exactAccountId = match.id;
        accountMatchedOn = match.matchedOn;
      } else {
        const created = await exactApi<{ d?: { ID?: string } }>(tokenData, "crm/Accounts", {
          method: "POST",
          body: {
            Name: company.name,
            Status: "C",
            IsSales: true,
            Country: "NL",
            Email: company.email || undefined,
            Phone: company.phone || undefined,
            City: company.address_city || undefined,
            AddressLine1: company.address_street || undefined,
            Postcode: company.address_postal || undefined,
            VATNumber: company.btw_number || undefined,
            ChamberOfCommerce: company.kvk_number || undefined,
          },
        });
        exactAccountId = created?.d?.ID ?? null;
        accountMatchedOn = "aangemaakt";
      }

      if (exactAccountId) {
        await serviceClient.from("companies").update({ exact_account_id: exactAccountId }).eq("id", company.id);
      }
    }

    if (!exactAccountId) {
      throw new Error("Kon geen Exact relatie bepalen voor deze opdrachtgever");
    }

    // ── Factuurregels ─────────────────────────────────────────────────────────
    // Twee losse vragen: (1) is dit document een creditnota — dat bepaalt het
    // Exact-type — en (2) staan de bedragen negatief, want alleen dán moeten de
    // tekens gedraaid worden. Een creditfactuur met positief opgeslagen bedragen
    // krijgt dus wél Type 8021, maar geen dubbele omkering.
    const amountsAreNegative = Number(invoice.total) < 0;
    const isCreditNote = amountsAreNegative || invoice.status === "gecrediteerd";
    const { parts, warnings } = buildExactInvoiceLineParts(lines, { creditNote: amountsAreNegative });
    for (const warning of warnings) {
      console.warn(`Exact sync factuur ${invoice.invoice_number}: ${warning}`);
    }

    const vatCode = defaults.vatCodes[String(Number(invoice.vat_rate))] ?? null;

    const salesInvoiceLines = parts.map((part, index) => {
      const glAccount = glMap.get(part.hourTypeCode) ?? glMap.get("normaal") ?? defaults.glAccountId;
      return {
        LineNumber: index + 1,
        Description: part.Description,
        Quantity: part.Quantity,
        NetPrice: part.NetPrice,
        ...(glAccount ? { GLAccount: glAccount } : {}),
        ...(defaults.itemId ? { Item: defaults.itemId } : {}),
        ...(vatCode ? { VATCode: vatCode } : {}),
      };
    });

    if (salesInvoiceLines.length === 0) {
      throw new Error("Factuur heeft geen regels om naar Exact te sturen");
    }

    // ── Verkoopfactuur aanmaken ───────────────────────────────────────────────
    // AmountFC/AmountDC zijn berekende velden in Exact en mogen niet mee: het
    // bedrag volgt uit Quantity × NetPrice per regel.
    const payload: Record<string, unknown> = {
      Type: isCreditNote ? EXACT_SALES_CREDIT_NOTE_TYPE : exactSalesInvoiceType(invoice.total),
      OrderedBy: exactAccountId,
      InvoiceTo: exactAccountId,
      Description: `Factuur ${invoice.invoice_number}`,
      YourRef: invoice.reference || invoice.invoice_number,
      PaymentReference: invoice.invoice_number,
      SalesInvoiceLines: salesInvoiceLines,
    };

    const invoiceDate = toExactDate(invoice.invoice_date);
    if (invoiceDate) payload.InvoiceDate = invoiceDate;
    if (defaults.journal) payload.Journal = defaults.journal;

    const created = await exactApi<{ d?: { InvoiceID?: string; ID?: string } }>(
      tokenData,
      "salesinvoice/SalesInvoices",
      { method: "POST", body: payload },
    );

    const exactInvoiceId = created?.d?.InvoiceID || created?.d?.ID || null;
    if (!exactInvoiceId) {
      throw new Error("Exact gaf geen factuur-ID terug");
    }

    claimed = false;
    await serviceClient
      .from("invoices")
      .update({
        exact_invoice_id: exactInvoiceId,
        exact_sync_error: null,
        exact_sync_started_at: null,
        exact_synced_at: new Date().toISOString(),
        status: invoice.status === "concept" ? "definitief" : invoice.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    await logExactSync(serviceClient, {
      organizationId: orgId,
      direction: "outbound",
      entityType: "invoice",
      entityId: invoiceId,
      operation: isCreditNote ? "create_credit_note" : "create_sales_invoice",
      status: "success",
      exactId: exactInvoiceId,
      durationMs: Date.now() - startedAt,
      payload: {
        invoice_number: invoice.invoice_number,
        lines: salesInvoiceLines.length,
        journal: defaults.journal,
        vat_code: vatCode,
        account_matched_on: accountMatchedOn,
        line_warnings: warnings,
      },
    });

    return jsonOk({
      success: true,
      exact_invoice_id: exactInvoiceId,
      exact_account_id: exactAccountId,
      warnings,
      message: `Factuur ${invoice.invoice_number} succesvol gesynchroniseerd naar Exact Online`,
    });
  } catch (err) {
    const classified = classifyExactProviderError(err);
    console.error("Exact sync error:", classified.publicCode, classified.detail);

    await releaseClaim(sanitizeExactErrorDetail(err, 400));

    if (orgId) {
      await logExactSync(serviceClient, {
        organizationId: orgId,
        direction: "outbound",
        entityType: "invoice",
        entityId: invoiceId,
        operation: "create_sales_invoice",
        status: "failed",
        httpStatus: classified.providerStatus,
        errorDetail: classified.detail,
        durationMs: Date.now() - startedAt,
      });
    }

    return jsonError(classified.publicCode, classified.httpStatus, {
      provider_status: classified.providerStatus,
      detail: classified.detail,
    });
  }
});
