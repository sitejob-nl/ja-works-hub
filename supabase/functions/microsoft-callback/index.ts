import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Frontend URL for redirects
  const siteUrl = Deno.env.get("SITE_URL") || "https://noaupcteygfvlyymqtew.supabase.co";
  // Use the frontend origin (Vite dev or production)
  const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://ja-werkt.lovable.app";

  // Handle error from Microsoft
  if (error) {
    console.error("Microsoft OAuth error:", error, errorDescription);
    return Response.redirect(
      `${frontendUrl}/instellingen?microsoft=error&reason=${encodeURIComponent(errorDescription || error)}`
    );
  }

  if (!code || !stateParam) {
    return Response.redirect(`${frontendUrl}/instellingen?microsoft=error&reason=missing_params`);
  }

  // Decode state to get org_id + optional user_id
  let orgId: string;
  let userId: string | null = null;
  try {
    const stateData = JSON.parse(atob(stateParam));
    orgId = stateData.org_id;
    userId = stateData.user_id || null;
    if (!orgId) throw new Error("No org_id in state");
  } catch {
    return Response.redirect(`${frontendUrl}/instellingen?microsoft=error&reason=invalid_state`);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
  const redirectUri = `${supabaseUrl}/functions/v1/microsoft-callback`;

  try {
    // Step 1: Exchange code for tokens
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        scope: "openid profile User.Read email Mail.Read Mail.ReadWrite Mail.Send MailboxFolder.Read MailboxFolder.ReadWrite MailboxItem.Read Calendars.Read Calendars.ReadWrite offline_access",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Token exchange failed:", errText);
      return Response.redirect(`${frontendUrl}/instellingen?microsoft=error&reason=token_exchange_failed`);
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Step 2: Get user info from Microsoft Graph
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/json",
      },
    });

    if (!meRes.ok) {
      console.error("Graph /me failed:", await meRes.text());
      return Response.redirect(`${frontendUrl}/instellingen?microsoft=error&reason=user_info_failed`);
    }

    const meData = await meRes.json();
    const microsoftEmail = meData.mail || meData.userPrincipalName || "";
    const microsoftUserId = meData.id || "";
    // Azure AD tenant ID comes from the token (tid claim)
    let microsoftTenantId = "";
    try {
      const payload = JSON.parse(atob(access_token.split(".")[1]));
      microsoftTenantId = payload.tid || "";
    } catch {
      // Non-critical — just for display
    }

    // Step 3: Encrypt tokens and store in database
    const { data: encAccessToken } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: access_token,
    });
    const { data: encRefreshToken } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: refresh_token,
    });

    // Check if record exists for this org+user combo
    let query = serviceClient
      .from("microsoft_config")
      .select("id")
      .eq("organization_id", orgId);

    if (userId) {
      query = query.eq("user_id", userId);
    } else {
      query = query.is("user_id", null);
    }

    const { data: existing } = await query.maybeSingle();

    const record = {
      organization_id: orgId,
      user_id: userId,
      access_token: encAccessToken,
      refresh_token: encRefreshToken,
      token_expires_at: tokenExpiresAt,
      microsoft_user_id: microsoftUserId,
      microsoft_email: microsoftEmail,
      microsoft_tenant_id: microsoftTenantId,
      is_active: true,
      refreshing_at: null,
      updated_at: new Date().toISOString(),
    };

    let upsertError;
    if (existing) {
      const { error } = await serviceClient.from("microsoft_config").update(record).eq("id", existing.id);
      upsertError = error;
    } else {
      const { error } = await serviceClient.from("microsoft_config").insert(record);
      upsertError = error;
    }

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return Response.redirect(`${frontendUrl}/instellingen?microsoft=error&reason=save_failed`);
    }

    // Step 4: Audit log
    await serviceClient.from("audit_log").insert({
      organization_id: orgId,
      action: "create",
      table_name: "microsoft_config",
      new_values: {
        microsoft_email: microsoftEmail,
        microsoft_tenant_id: microsoftTenantId,
        event: "oauth_connected",
      },
    });

    // Step 5: Redirect to settings page with success
    return Response.redirect(`${frontendUrl}/instellingen?microsoft=connected`);
  } catch (err) {
    console.error("Microsoft OAuth callback error:", err);
    return Response.redirect(
      `${frontendUrl}/instellingen?microsoft=error&reason=unknown_error`
    );
  }
});
