import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getExactToken, jsonError, jsonOk } from "../_shared/exact-helpers.ts";

type ExactMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const ALLOWED_METHODS = new Set<ExactMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function hasControlChar(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function normalizeEndpoint(input: unknown): string {
  const value = String(input ?? "").trim();
  if (!value) throw new Error("endpoint is required");
  if (hasControlChar(value)) throw new Error("endpoint_invalid");
  if (/^https?:\/\//i.test(value) || value.startsWith("//") || value.includes("://")) {
    throw new Error("external_exact_url_not_allowed");
  }
  if (value.startsWith("/") || value.includes("\\") || value.split(/[?#]/)[0].split("/").includes("..")) {
    throw new Error("endpoint_invalid");
  }
  return value;
}

function exactUrl(baseUrl: string, division: number, endpoint: string): string {
  return `${baseUrl}/api/v1/${division}/${normalizeEndpoint(endpoint)}`;
}

async function callExact(tokenData: { base_url: string; division: number; access_token: string }, endpoint: string, method: ExactMethod, payload?: unknown) {
  const res = await fetch(exactUrl(tokenData.base_url, tokenData.division, endpoint), {
    method,
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/json",
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  return { ok: res.ok, status: res.status, body: parsed };
}

async function diagnosticCheck(tokenData: { base_url: string; division: number; access_token: string }, name: string, endpoint: string) {
  try {
    const result = await callExact(tokenData, endpoint, "GET");
    return {
      name,
      ok: result.ok,
      status: result.status,
      error: result.ok ? null : result.body,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      error: (error as Error).message,
    };
  }
}

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

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Use RPC to get decrypted credentials
    const { data: exactTokenData, error: rpcError } = await serviceClient.rpc('get_exact_token', {
      p_org_id: profile.organization_id,
    });

    if (rpcError || !exactTokenData || exactTokenData.length === 0) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

    const config = exactTokenData[0];
    if (!config.tenant_id || !config.decrypted_webhook_secret) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

    const body = await req.json();
    const { endpoint, payload } = body;
    const method = String(body.method ?? "GET").toUpperCase() as ExactMethod;
    if (!ALLOWED_METHODS.has(method)) return jsonError("method_not_allowed", 405);

    // Get fresh token using decrypted webhook secret
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

    if (body.action === "diagnostics") {
      const checks = await Promise.all([
        diagnosticCheck(tokenData, "Exact token en administratie", "crm/Accounts?$select=ID,Name&$top=1"),
        diagnosticCheck(tokenData, "Grootboekrekeningen lezen", "financial/GLAccounts?$filter=Type eq 20&$select=ID,Code,Description&$top=1"),
      ]);
      return jsonOk({
        ok: checks.every((check) => check.ok),
        division: tokenData.division,
        region: tokenData.region,
        base_url: tokenData.base_url,
        expires_at: tokenData.expires_at,
        checks,
      });
    }

    const result = await callExact(tokenData, endpoint, method, payload);

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Exact API proxy error:", err);
    const message = (err as Error).message || "Internal server error";
    const clientErrors = new Set(["endpoint is required", "endpoint_invalid", "external_exact_url_not_allowed"]);
    return jsonError(clientErrors.has(message) ? message : "Internal server error", clientErrors.has(message) ? 400 : 500);
  }
});
