import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import {
  classifyExactProviderError,
  corsHeaders,
  exactApi,
  findExactAccountId,
  getExactToken,
  jsonError,
  jsonOk,
  logExactSync,
} from "../_shared/exact-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  let orgId: string | null = null;
  let companyId: string | null = null;
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const auth = await requireRolePermission(req, "finance.manage", corsHeaders);
    if (auth instanceof Response) return auth;
    orgId = auth.organizationId;

    const body = await req.json();
    companyId = body?.company_id ?? null;
    if (!companyId) {
      return jsonError("company_id is required", 400);
    }

    const { data: exactConfig, error: configError } = await serviceClient.rpc("get_exact_token", { p_org_id: orgId });
    if (configError || !exactConfig?.length) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }
    const config = exactConfig[0];
    if (!config.tenant_id || !config.decrypted_webhook_secret) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

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

    const { data: company, error: compError } = await serviceClient
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .eq("organization_id", orgId)
      .single();

    if (compError || !company) {
      return jsonError("Opdrachtgever niet gevonden", 404);
    }

    const accountPayload: Record<string, unknown> = {
      Name: company.name,
      Status: "C",
      IsSales: true,
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

    let exactAccountId: string | null = company.exact_account_id || null;
    let action: "updated" | "created" | "linked" = "updated";
    let matchedOn: string | null = exactAccountId ? "opgeslagen" : null;

    // Nog niet gekoppeld? Eerst zoeken op KvK / BTW / e-mail / naam. Zonder deze
    // stap maakt elke sync een duplicaat aan voor een relatie die al bestaat.
    if (!exactAccountId) {
      const match = await findExactAccountId(tokenData, {
        kvkNumber: company.kvk_number,
        vatNumber: company.btw_number,
        email: company.email,
        name: company.name,
      });
      if (match) {
        exactAccountId = match.id;
        matchedOn = match.matchedOn;
        action = "linked";
      }
    }

    if (exactAccountId) {
      await exactApi(tokenData, `crm/Accounts(guid'${exactAccountId}')`, {
        method: "PUT",
        body: accountPayload,
      });
    } else {
      const created = await exactApi<{ d?: { ID?: string } }>(tokenData, "crm/Accounts", {
        method: "POST",
        body: accountPayload,
      });
      exactAccountId = created?.d?.ID ?? null;
      action = "created";
      matchedOn = "aangemaakt";
    }

    if (exactAccountId && exactAccountId !== company.exact_account_id) {
      await serviceClient.from("companies").update({ exact_account_id: exactAccountId }).eq("id", companyId);
    }

    await logExactSync(serviceClient, {
      organizationId: orgId,
      direction: "outbound",
      entityType: "company",
      entityId: companyId,
      operation: `account_${action}`,
      status: "success",
      exactId: exactAccountId,
      durationMs: Date.now() - startedAt,
      payload: { name: company.name, matched_on: matchedOn },
    });

    const messages: Record<typeof action, string> = {
      created: `Relatie ${company.name} aangemaakt in Exact Online`,
      updated: `Relatie ${company.name} bijgewerkt in Exact Online`,
      linked: `Relatie ${company.name} gekoppeld aan een bestaande Exact-relatie (gevonden op ${matchedOn})`,
    };

    return jsonOk({
      success: true,
      exact_account_id: exactAccountId,
      action,
      matched_on: matchedOn,
      message: messages[action],
    });
  } catch (err) {
    const classified = classifyExactProviderError(err);
    console.error("Exact sync account error:", classified.publicCode, classified.detail);

    if (orgId) {
      await logExactSync(serviceClient, {
        organizationId: orgId,
        direction: "outbound",
        entityType: "company",
        entityId: companyId,
        operation: "account_sync",
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
