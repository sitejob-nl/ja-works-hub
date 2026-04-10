import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, jsonError, callVoysApi } from "../_shared/voys-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { endpoint, method = "GET", payload, api_token: directToken } = body;

    if (!endpoint) {
      return jsonError("endpoint is required", 400);
    }

    let apiToken = directToken;

    // If no direct token, get it from the database using the authenticated user
    if (!apiToken) {
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();
      if (!profile) {
        return jsonError("Profile not found", 404);
      }

      // Get decrypted token via service client
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: tokenData, error: rpcError } = await serviceClient.rpc("get_voys_token", {
        p_org_id: profile.organization_id,
      });

      if (rpcError || !tokenData || tokenData.length === 0) {
        return jsonError("Voys niet geconfigureerd. Ga naar Instellingen om Voys te koppelen.", 400);
      }

      apiToken = tokenData[0].api_token;
    }

    if (!apiToken) {
      return jsonError("No API token available", 400);
    }

    // Call Voys API
    const { data, status } = await callVoysApi(apiToken, endpoint, method, payload);

    return jsonResponse(data, status);
  } catch (err) {
    console.error("Voys API proxy error:", err);
    return jsonError("Internal server error", 500);
  }
});
