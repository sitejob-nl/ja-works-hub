import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshMicrosoftToken(
  serviceClient: ReturnType<typeof createClient>,
  orgId: string,
  currentRefreshToken: string
): Promise<{ access_token: string; expires_at: string }> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

  const refreshRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid profile User.Read email Mail.Read Mail.ReadWrite Mail.Send MailboxFolder.Read MailboxFolder.ReadWrite MailboxItem.Read Calendars.Read Calendars.ReadWrite offline_access",
    }),
  });

  if (!refreshRes.ok) {
    const errText = await refreshRes.text();
    console.error("Microsoft token refresh failed:", errText);

    await serviceClient
      .from("microsoft_config")
      .update({
        is_active: false,
        refreshing_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId);

    throw new Error("REAUTH_REQUIRED");
  }

  const tokenData = await refreshRes.json();
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { data: encAccessToken } = await serviceClient.rpc("encrypt_sensitive", {
    plaintext: tokenData.access_token,
  });
  const { data: encRefreshToken } = await serviceClient.rpc("encrypt_sensitive", {
    plaintext: tokenData.refresh_token,
  });

  await serviceClient
    .from("microsoft_config")
    .update({
      access_token: encAccessToken,
      refresh_token: encRefreshToken,
      token_expires_at: newExpiresAt,
      refreshing_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId);

  return { access_token: tokenData.access_token, expires_at: newExpiresAt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body — org_id comes from frontend
    const body = await req.json();
    const { endpoint, method = "GET", payload, organization_id } = body;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!endpoint) {
      return new Response(JSON.stringify({ error: "endpoint is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get decrypted tokens via RPC
    const { data: tokenData, error: rpcError } = await serviceClient.rpc("get_microsoft_token", {
      p_org_id: organization_id,
    });

    if (rpcError || !tokenData || tokenData.length === 0) {
      return new Response(JSON.stringify({ error: "Microsoft 365 niet geconfigureerd" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = tokenData[0];
    if (!config.access_token || !config.refresh_token) {
      return new Response(JSON.stringify({ error: "Microsoft 365 niet geconfigureerd" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check token expiry (60s buffer)
    const now = Date.now();
    const expiresAt = new Date(config.token_expires_at).getTime();
    const bufferMs = 60 * 1000;
    let accessToken = config.access_token;

    if (expiresAt - now <= bufferMs) {
      const refreshingAt = config.refreshing_at ? new Date(config.refreshing_at).getTime() : 0;
      const lockAge = now - refreshingAt;

      if (refreshingAt && lockAge < 15_000) {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const { data: fresh } = await serviceClient.rpc("get_microsoft_token", {
            p_org_id: organization_id,
          });
          if (fresh?.[0] && new Date(fresh[0].token_expires_at).getTime() - Date.now() > bufferMs) {
            accessToken = fresh[0].access_token;
            break;
          }
        }
      } else {
        const { data: locked } = await serviceClient
          .from("microsoft_config")
          .update({ refreshing_at: new Date().toISOString() })
          .eq("organization_id", organization_id)
          .or(`refreshing_at.is.null,refreshing_at.lt.${new Date(Date.now() - 15_000).toISOString()}`)
          .select("id")
          .maybeSingle();

        if (locked) {
          try {
            const refreshed = await refreshMicrosoftToken(
              serviceClient,
              organization_id,
              config.refresh_token
            );
            accessToken = refreshed.access_token;
          } catch (err: unknown) {
            if ((err as Error).message === "REAUTH_REQUIRED") {
              return new Response(JSON.stringify({
                error: "Microsoft 365 koppeling verlopen. Koppel opnieuw via Instellingen.",
                needs_reauth: true,
              }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            throw err;
          }
        }
      }
    }

    // Build Graph API URL
    let fullUrl: string;
    if (endpoint.startsWith("http")) {
      fullUrl = endpoint;
    } else {
      fullUrl = `https://graph.microsoft.com/v1.0/${endpoint}`;
    }

    // Call Microsoft Graph API
    const graphRes = await fetch(fullUrl, {
      method: method.toUpperCase(),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });

    if (graphRes.status === 401) {
      return new Response(JSON.stringify({
        error: "Microsoft 365 koppeling verlopen. Koppel opnieuw via Instellingen.",
        needs_reauth: true,
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const graphBody = await graphRes.text();
    let parsed;
    try {
      parsed = JSON.parse(graphBody);
    } catch {
      parsed = { raw: graphBody };
    }

    return new Response(JSON.stringify(parsed), {
      status: graphRes.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Microsoft API proxy error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
