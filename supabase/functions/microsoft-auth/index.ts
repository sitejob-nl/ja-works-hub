import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Self-auth: verify Bearer token, derive org_id from profile ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      return new Response(JSON.stringify({ error: "Missing organization" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Derive org_id from the authenticated user; ignore any body.organization_id.
    const orgId = profile.organization_id;

    // body.user_id is still read: null = org-wide default mailbox, set = per-user OAuth.
    // Only allow the authenticated user to bind a per-user record to themselves.
    const body = await req.json().catch(() => ({}));
    const requestedUserId = body.user_id || null;
    if (requestedUserId && requestedUserId !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden — cannot bind OAuth to another user" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = requestedUserId; // null or the authenticated user's id

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "MICROSOFT_CLIENT_ID not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${supabaseUrl}/functions/v1/microsoft-callback`;

    // Encode org_id + user_id in state so callback knows which record to update
    const state = btoa(JSON.stringify({ org_id: orgId, user_id: userId }));

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid profile User.Read email Mail.Read Mail.ReadWrite Mail.Send MailboxFolder.Read MailboxFolder.ReadWrite MailboxItem.Read Calendars.Read Calendars.ReadWrite offline_access",
      state,
      response_mode: "query",
      prompt: "consent",
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;

    return new Response(JSON.stringify({ auth_url: authUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Microsoft auth error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
