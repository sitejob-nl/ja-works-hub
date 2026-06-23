import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { isOutboundPaused } from "../_shared/outbound-pause.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { renderBrandedEmail, resolveBrandTheme } from "../_shared/email-layout.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Templates uit de editor zijn meestal een content-snippet. Een template die al een volledig
// HTML-document is (eigen <html>/<body>) laten we ongemoeid — anders dubbele frame.
const looksLikeFullHtmlDoc = (html: string) => /<\s*(!doctype|html|body)\b/i.test(html);

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

    if (await isOutboundPaused(serviceClient, organization_id, "email")) {
      if (campaign.status === "scheduled") {
        await serviceClient
          .from("bulk_campaigns")
          .update({ status: "paused" })
          .eq("id", campaign_id)
          .eq("organization_id", organization_id);
      }

      return new Response(JSON.stringify({
        paused: true,
        campaign_id,
        campaign_status: campaign.status === "scheduled" ? "paused" : campaign.status,
        message: "E-mailcampagnes staan op pauze (kill-switch).",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    // Get org branding for template variables + huisstijl-mailframe
    const { data: org } = await serviceClient
      .from("organizations")
      .select("name, logo_url, settings")
      .eq("id", organization_id)
      .single();
    const orgName = org?.name || "";
    const brandTheme = resolveBrandTheme(org);

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
          // get_campaign_candidates levert (bewust) geen e-mail; haal het volledige kandidaat-
          // record op en gebruik DAT e-mailadres. Vroeger checkte de code candidate.email (altijd
          // leeg) → 100% "Geen e-mailadres". Daarom eerst ophalen, dan pas valideren.
          const { data: fullCandidate } = await serviceClient
            .from("candidates")
            .select("first_name, last_name, email, phone, date_of_birth, nationality, employee_number, employee_status, status, address_street, address_postal, address_city")
            .eq("id", candidate.candidate_id)
            .eq("organization_id", organization_id)
            .single();

          const recipientEmail = (fullCandidate?.email ?? "").trim();
          if (!recipientEmail) {
            throw new Error("Geen e-mailadres");
          }

          const merged = mergeTemplate(emailBody, emailSubject, fullCandidate || candidate, orgName);
          // Wrap content-snippets in de huisstijl-frame; volledige HTML-documenten ongemoeid laten.
          const finalHtml = looksLikeFullHtmlDoc(merged.html)
            ? merged.html
            : renderBrandedEmail({ theme: brandTheme, contentHtml: merged.html, preheader: merged.subject });

          const sendResult = await sendViaOutlookAccount({
            orgId: organization_id,
            to: recipientEmail,
            subject: merged.subject,
            htmlBody: finalHtml,
            candidateId: candidate.candidate_id,
            sentBy: auth.userId,
          });

          if (sendResult.success) {
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

          } else {
            throw new Error(sendResult.error || "Outlook verzenden mislukt");
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
