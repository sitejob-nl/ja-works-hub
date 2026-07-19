import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import {
  classifyExactProviderError,
  corsHeaders,
  type ExactVatCodeRow,
  getExactToken,
  jsonError,
  jsonOk,
  listExactVatCodes,
  normalizeVatPercentage,
  selectVatCodeForRate,
} from "../_shared/exact-helpers.ts";

/** Tarieven waarvoor JA Werkt een code nodig heeft (NL: hoog, laag, nul). */
const SUGGESTED_RATES = [21, 9, 0];

function toDto(row: ExactVatCodeRow) {
  // Code NIET trimmen: Exact gebruikt vaste breedte met spatie-padding ("6  ")
  // en die padding hoort mee terug naar Exact te gaan.
  const percentage = normalizeVatPercentage(row.Percentage);
  const description = row.Description?.trim() || null;
  return {
    code: row.Code,
    description,
    percentage,
    type: row.Type ?? null,
    transaction_type: row.VATTransactionType ?? null,
    label: `${String(row.Code).trim()}${percentage === null ? "" : ` — ${percentage}%`}${description ? ` (${description})` : ""}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return jsonError("method_not_allowed", 405);
    }

    const auth = await requireRolePermission(req, "finance.view", corsHeaders);
    if (auth instanceof Response) return auth;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: exactConfig, error: configError } = await serviceClient.rpc("get_exact_token", {
      p_org_id: auth.organizationId,
    });
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
        return jsonError("Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.", 409, {
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        });
      }
      if (message === "TENANT_NOT_FOUND") {
        return jsonError("De Exact-koppeling bestaat niet meer bij SiteJob Connect.", 409, {
          exact_tenant_not_found: true,
        });
      }
      throw err;
    }

    const rows = await listExactVatCodes(tokenData);
    const salesRows = rows.filter((row) => String(row.VATTransactionType ?? "").toUpperCase() !== "P");

    // Suggesties zodat de gebruiker ziet welke code wij zouden kiezen — hij kan
    // die overnemen of bewust iets anders instellen (bv. BTW verlegd).
    const suggested: Record<string, string> = {};
    for (const rate of SUGGESTED_RATES) {
      const code = selectVatCodeForRate(rows, rate);
      if (code) suggested[String(rate)] = code;
    }

    const { data: stored } = await serviceClient
      .from("exact_config")
      .select("default_vat_codes")
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    return jsonOk({
      division: tokenData.division,
      vat_codes: salesRows.map(toDto),
      suggested,
      configured: stored?.default_vat_codes ?? {},
    });
  } catch (err) {
    console.error("Exact list VATCodes error:", err);
    const classified = classifyExactProviderError(err);
    return jsonError(classified.publicCode, classified.httpStatus, {
      provider_status: classified.providerStatus,
      detail: classified.detail,
    });
  }
});
