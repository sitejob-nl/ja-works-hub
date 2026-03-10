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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = profile.organization_id;

    // Get WhatsApp config with decrypted tokens
    const { data: decryptedConfig, error: configError } = await serviceClient.rpc('get_whatsapp_token', {
      p_org_id: orgId,
    });

    if (configError || !decryptedConfig || decryptedConfig.length === 0) {
      return new Response(JSON.stringify({ error: "WhatsApp niet geconfigureerd" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const waConfig = decryptedConfig[0];
    const accessToken = waConfig.decrypted_access_token;
    const phoneNumberId = waConfig.phone_number_id;

    if (!accessToken || !phoneNumberId) {
      return new Response(JSON.stringify({ error: "WhatsApp niet geconfigureerd" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { to, message, candidate_id, company_id } = body;

    if (!to || !message) {
      return new Response(JSON.stringify({ error: "to and message are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-send check: opt-out status
    if (candidate_id) {
      const { data: optOut } = await serviceClient
        .from("communication_preferences")
        .select("opted_out")
        .eq("organization_id", orgId)
        .eq("candidate_id", candidate_id)
        .eq("channel", "whatsapp")
        .single();

      if (optOut?.opted_out) {
        return new Response(
          JSON.stringify({ error: "Candidate has opted out of WhatsApp messages" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Pre-send check: rate limit
    const { data: canSendMinute } = await serviceClient.rpc("check_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
      p_window_type: "minute",
    });

    if (!canSendMinute) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded (per minute)" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: canSendHour } = await serviceClient.rpc("check_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
      p_window_type: "hour",
    });

    if (!canSendHour) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded (per hour)" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean phone number (remove spaces, dashes, leading +)
    const cleanPhone = to.replace(/[\s\-\+]/g, "");

    // Send via Meta API
    const metaRes = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "text",
          text: { body: message, preview_url: true },
        }),
      }
    );

    const metaBody = await metaRes.json();

    if (!metaRes.ok) {
      console.error("Meta API error:", metaBody);
      return new Response(
        JSON.stringify({ error: "WhatsApp versturen mislukt", details: metaBody }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const waMessageId = metaBody.messages?.[0]?.id;

    // Record rate limit usage
    await serviceClient.rpc("record_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
    });

    // Store outbound message in communications
    const { data: comm } = await serviceClient.from("communications").insert({
      organization_id: orgId,
      channel: "whatsapp",
      direction: "outbound",
      subject: `WhatsApp naar ${cleanPhone}`,
      body: message,
      sent_by: userId,
      candidate_id: candidate_id || null,
      company_id: company_id || null,
      whatsapp_message_id: waMessageId || null,
      whatsapp_status: "sent",
    }).select("id").single();

    return new Response(
      JSON.stringify({ success: true, message_id: waMessageId, communication_id: comm?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Send error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
