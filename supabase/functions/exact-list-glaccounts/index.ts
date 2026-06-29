import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyExactProviderError,
  corsHeaders,
  getExactToken,
  jsonError,
  jsonOk,
  listGLAccountCandidates,
  type GLAccountRow,
} from "../_shared/exact-helpers.ts";

type GLAccountKind = "revenue" | "expense";

const GL_ACCOUNT_KINDS: Record<GLAccountKind, { preferredTypes: number[]; codePrefix: string }> = {
  revenue: { preferredTypes: [110], codePrefix: "8" },
  expense: { preferredTypes: [130, 135, 125, 140], codePrefix: "4" },
};

function parseKind(value: unknown): GLAccountKind {
  return value === "expense" ? "expense" : "revenue";
}

function toDto(row: GLAccountRow) {
  const code = (row.Code ?? "").trim();
  const description = row.Description?.trim() || null;
  return {
    id: row.ID,
    code,
    description,
    type: row.Type ?? null,
    label: description ? `${code} - ${description}` : code,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return jsonError("method_not_allowed", 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return jsonError("Unauthorized", 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, role")
      .eq("id", user.id)
      .single();

    if (!profile?.organization_id) return jsonError("Profile not found", 404);
    if (!["admin", "backoffice", "finance"].includes(profile.role)) {
      return jsonError("Forbidden", 403);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const urlKind = new URL(req.url).searchParams.get("kind");
    const kind = parseKind(urlKind ?? body.kind);
    const accountConfig = GL_ACCOUNT_KINDS[kind];

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: exactConfig, error: configError } = await serviceClient.rpc("get_exact_token", {
      p_org_id: profile.organization_id,
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
      if ((err as Error).message === "REAUTH_REQUIRED") {
        return jsonError("Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.", 409, {
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        });
      }
      throw err;
    }

    const accounts = await listGLAccountCandidates(
      tokenData,
      accountConfig.preferredTypes,
      accountConfig.codePrefix,
    );

    return jsonOk({
      kind,
      division: tokenData.division,
      accounts: accounts.map(toDto),
    });
  } catch (err) {
    console.error("Exact list GLAccounts error:", err);
    const classified = classifyExactProviderError(err);
    return jsonError(classified.publicCode, classified.httpStatus, {
      provider_status: classified.providerStatus,
      detail: classified.detail,
    });
  }
});
