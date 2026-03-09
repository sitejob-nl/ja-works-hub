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

    const body = await req.json();
    const { candidate_id, channel } = body;

    if (!candidate_id || !channel) {
      return new Response(
        JSON.stringify({ error: "candidate_id and channel are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role for operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Upsert communication preference (opted_out=true)
    const { error: prefError } = await serviceClient
      .from("communication_preferences")
      .upsert(
        {
          organization_id: orgId,
          candidate_id,
          channel,
          opted_out: true,
          opted_out_at: new Date().toISOString(),
          opted_out_reason: "User requested opt-out",
        },
        {
          onConflict: "organization_id,candidate_id,channel",
        }
      );

    if (prefError) {
      console.error("Preference upsert error:", prefError);
      return new Response(
        JSON.stringify({ error: "Failed to update preferences" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update all pending campaign_recipients to opted_out
    const { data: updated } = await serviceClient
      .from("campaign_recipients")
      .update({ status: "opted_out" })
      .eq("organization_id", orgId)
      .eq("candidate_id", candidate_id)
      .eq("status", "pending")
      .select("campaign_id");

    // Increment opted_out_count for affected campaigns
    if (updated && updated.length > 0) {
      const campaignIds = [...new Set(updated.map((r) => r.campaign_id))];
      for (const campaignId of campaignIds) {
        await serviceClient.rpc("increment", {
          row_id: campaignId,
          x: 1,
          table_name: "bulk_campaigns",
          column_name: "opted_out_count",
        }).catch(() => {
          // Fallback if increment RPC doesn't exist
          serviceClient
            .from("bulk_campaigns")
            .select("opted_out_count")
            .eq("id", campaignId)
            .single()
            .then(({ data }) => {
              if (data) {
                serviceClient
                  .from("bulk_campaigns")
                  .update({ opted_out_count: (data.opted_out_count || 0) + 1 })
                  .eq("id", campaignId);
              }
            });
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated_recipients: updated?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Opt-out handler error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
