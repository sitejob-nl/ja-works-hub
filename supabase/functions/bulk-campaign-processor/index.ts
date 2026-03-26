import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

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
    const { campaign_id } = body;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role for all operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load campaign
    const { data: campaign, error: campaignError } = await serviceClient
      .from("bulk_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("organization_id", orgId)
      .single();

    if (campaignError || !campaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      return new Response(
        JSON.stringify({ error: "Campaign already processed or running" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get candidates using RPC
    const { data: candidates, error: candidatesError } = await serviceClient.rpc(
      "get_campaign_candidates",
      {
        p_org_id: orgId,
        p_filter: campaign.segment_filter || {},
        p_channel: campaign.channel,
      }
    );

    if (candidatesError) {
      console.error("Get candidates error:", candidatesError);
      return new Response(
        JSON.stringify({ error: "Failed to get candidates" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!candidates || candidates.length === 0) {
      await serviceClient
        .from("bulk_campaigns")
        .update({
          status: "completed",
          total_recipients: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", campaign_id);

      return new Response(
        JSON.stringify({ success: true, message: "No recipients found", total: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert campaign_recipients
    const recipients = candidates.map((c: any) => ({
      organization_id: orgId,
      campaign_id,
      candidate_id: c.candidate_id,
      status: "pending",
    }));

    await serviceClient.from("campaign_recipients").insert(recipients);

    // Update campaign status and total_recipients
    await serviceClient
      .from("bulk_campaigns")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        total_recipients: candidates.length,
      })
      .eq("id", campaign_id);

    // Process in batches of 50
    const batchSize = 50;
    const batches = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
      batches.push(candidates.slice(i, i + batchSize));
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    for (const batch of batches) {
      // Check rate limit before processing batch
      const { data: canSend } = await serviceClient.rpc("check_rate_limit", {
        p_org_id: orgId,
        p_channel: campaign.channel,
        p_window_type: "minute",
      });

      if (!canSend) {
        console.log("Rate limit reached, waiting 60s...");
        await sleep(60000);
      }

      for (const candidate of batch) {
        try {
          // Merge fields in message
          let message = campaign.message_template;
          message = message.replace(/\{\{first_name\}\}/g, candidate.first_name || "");
          message = message.replace(/\{\{last_name\}\}/g, candidate.last_name || "");
          message = message.replace(/\{\{full_name\}\}/g, `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim());

          // Auto-append opt-out footer if not present
          if (!message.includes("STOP")) {
            message += "\n\nWil je geen berichten meer ontvangen? Antwoord met STOP.";
          }

          // Call whatsapp-send
          const sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: candidate.phone,
              message,
              candidate_id: candidate.candidate_id,
            }),
          });

          const sendData = await sendRes.json();

          if (sendRes.ok) {
            // Update recipient status to sent
            await serviceClient
              .from("campaign_recipients")
              .update({
                status: "sent",
                sent_at: new Date().toISOString(),
                communication_id: sendData.communication_id || null,
              })
              .eq("campaign_id", campaign_id)
              .eq("candidate_id", candidate.candidate_id);

            // Increment sent_count
            await serviceClient
              .from("bulk_campaigns")
              .update({ sent_count: (campaign.sent_count || 0) + 1 })
              .eq("id", campaign_id);
          } else {
            // Update recipient status to failed
            await serviceClient
              .from("campaign_recipients")
              .update({
                status: "failed",
                error_message: sendData.error || "Unknown error",
              })
              .eq("campaign_id", campaign_id)
              .eq("candidate_id", candidate.candidate_id);

            // Increment failed_count
            await serviceClient
              .from("bulk_campaigns")
              .update({ failed_count: (campaign.failed_count || 0) + 1 })
              .eq("id", campaign_id);
          }
        } catch (err) {
          console.error(`Failed to send to ${candidate.candidate_id}:`, err);
          await serviceClient
            .from("campaign_recipients")
            .update({
              status: "failed",
              error_message: err.message,
            })
            .eq("campaign_id", campaign_id)
            .eq("candidate_id", candidate.candidate_id);

          await serviceClient
            .from("bulk_campaigns")
            .update({ failed_count: (campaign.failed_count || 0) + 1 })
            .eq("id", campaign_id);
        }
      }

      // Wait 3 seconds between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await sleep(3000);
      }
    }

    // Mark campaign as completed
    await serviceClient
      .from("bulk_campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({ success: true, total_processed: candidates.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Bulk campaign processor error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
