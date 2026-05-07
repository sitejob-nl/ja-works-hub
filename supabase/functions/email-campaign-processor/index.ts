import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Replace {{variabelen}} with candidate data
function mergeTemplate(html: string, subject: string, candidate: any, orgName: string) {
  const vars: Record<string, string> = {
    "{{voornaam}}": candidate.first_name || "",
    "{{achternaam}}": candidate.last_name || "",
    "{{volledige_naam}}": `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim(),
    "{{email}}": candidate.email || "",
    "{{telefoon}}": candidate.phone || "",
    "{{geboortedatum}}": candidate.date_of_birth || "",
    "{{nationaliteit}}": candidate.nationality || "",
    "{{medewerker_nummer}}": candidate.employee_number || "",
    "{{status}}": candidate.employee_status || candidate.status || "",
    "{{straat}}": candidate.address_street || "",
    "{{postcode}}": candidate.address_postal || "",
    "{{stad}}": candidate.address_city || "",
    "{{organisatie_naam}}": orgName,
    "{{datum_vandaag}}": new Date().toLocaleDateString("nl-NL"),
    // WhatsApp compat
    "{{first_name}}": candidate.first_name || "",
    "{{last_name}}": candidate.last_name || "",
    "{{full_name}}": `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim(),
  };

  let mergedHtml = html;
  let mergedSubject = subject;
  for (const [key, val] of Object.entries(vars)) {
    const regex = new RegExp(key.replace(/[{}]/g, "\\$&"), "g");
    mergedHtml = mergedHtml.replace(regex, val);
    mergedSubject = mergedSubject.replace(regex, val);
  }
  return { html: mergedHtml, subject: mergedSubject };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const { campaign_id } = body;
    const organization_id = auth.organizationId;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createAdminClient();

    // Load campaign
    const { data: campaign, error: campaignError } = await serviceClient
      .from("bulk_campaigns")
      .select("*, email_templates:email_template_id(*)")
      .eq("id", campaign_id)
      .eq("organization_id", organization_id)
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

    // Get email template
    const template = campaign.email_templates;
    const emailSubject = campaign.email_subject || template?.subject || campaign.name;
    const emailBody = template?.body_html || campaign.message_template || "";

    if (!emailBody) {
      return new Response(
        JSON.stringify({ error: "No email template or body found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get org name for template variables
    const { data: org } = await serviceClient
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .single();
    const orgName = org?.name || "";

    // Get Microsoft token
    const { data: msToken, error: msError } = await serviceClient.rpc("get_microsoft_token", {
      p_org_id: organization_id,
    });

    if (msError || !msToken || msToken.length === 0) {
      return new Response(
        JSON.stringify({ error: "Microsoft 365 niet geconfigureerd" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = msToken[0].access_token;

    // Get candidates
    const { data: candidates, error: candidatesError } = await serviceClient.rpc(
      "get_campaign_candidates",
      { p_org_id: organization_id, p_filter: campaign.segment_filter || {}, p_channel: "email" }
    );

    if (candidatesError || !candidates || candidates.length === 0) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "completed", total_recipients: 0, completed_at: new Date().toISOString() })
        .eq("id", campaign_id);

      return new Response(
        JSON.stringify({ success: true, message: "No recipients found", total: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert campaign recipients
    await serviceClient.from("campaign_recipients").insert(
      candidates.map((c: any) => ({
        organization_id,
        campaign_id,
        candidate_id: c.candidate_id,
        status: "pending",
      }))
    );

    // Update campaign status
    await serviceClient
      .from("bulk_campaigns")
      .update({ status: "running", started_at: new Date().toISOString(), total_recipients: candidates.length })
      .eq("id", campaign_id);

    // Process in batches
    const batchSize = 50;
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      // Rate limit check
      const { data: canSend } = await serviceClient.rpc("check_rate_limit", {
        p_org_id: organization_id,
        p_channel: "email",
        p_window_type: "minute",
      });

      if (!canSend) {
        console.log("Rate limit reached, waiting 60s...");
        await sleep(60000);
      }

      for (const candidate of batch) {
        try {
          if (!candidate.email) {
            throw new Error("Geen e-mailadres");
          }

          // Get full candidate data for merge
          const { data: fullCandidate } = await serviceClient
            .from("candidates")
            .select("first_name, last_name, email, phone, date_of_birth, nationality, employee_number, employee_status, status, address_street, address_postal, address_city")
            .eq("id", candidate.candidate_id)
            .eq("organization_id", organization_id)
            .single();

          const merged = mergeTemplate(emailBody, emailSubject, fullCandidate || candidate, orgName);

          // Send via Microsoft Graph
          const graphRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                subject: merged.subject,
                body: { contentType: "HTML", content: merged.html },
                toRecipients: [{ emailAddress: { address: candidate.email } }],
              },
            }),
          });

          if (graphRes.ok || graphRes.status === 202) {
            sentCount++;

            // Record rate limit
            await serviceClient.rpc("record_rate_limit", {
              p_org_id: organization_id,
              p_channel: "email",
            });

            // Update recipient
            await serviceClient
              .from("campaign_recipients")
              .update({ status: "sent", sent_at: new Date().toISOString() })
              .eq("campaign_id", campaign_id)
              .eq("candidate_id", candidate.candidate_id);

            // Log in communications
            await serviceClient.from("communications").insert({
              organization_id,
              recipient_id: candidate.candidate_id,
              recipient_type: "candidate",
              channel: "email",
              direction: "outbound",
              subject: merged.subject,
              body: merged.html,
              email_to: [candidate.email],
              status: "sent",
              sent_at: new Date().toISOString(),
            });
          } else {
            const errBody = await graphRes.text();
            throw new Error(`Graph API ${graphRes.status}: ${errBody}`);
          }
        } catch (err) {
          failedCount++;
          console.error(`Failed to send to ${candidate.candidate_id}:`, err);

          await serviceClient
            .from("campaign_recipients")
            .update({ status: "failed", error_message: (err as Error).message })
            .eq("campaign_id", campaign_id)
            .eq("candidate_id", candidate.candidate_id);
        }
      }

      // Update counts
      await serviceClient
        .from("bulk_campaigns")
        .update({ sent_count: sentCount, failed_count: failedCount })
        .eq("id", campaign_id);

      // Wait between batches
      if (i + batchSize < candidates.length) await sleep(3000);
    }

    // Complete
    await serviceClient
      .from("bulk_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString(), sent_count: sentCount, failed_count: failedCount })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({ success: true, total: candidates.length, sent: sentCount, failed: failedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Email campaign processor error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
