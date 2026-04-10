// supabase/functions/whatsapp-send/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  normalizePhone,
  getWhatsAppCredentials,
  getAuthenticatedOrg,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId, userId } = auth;

    const body = await req.json();
    const { to, type, text, template, image, video, audio, document, reaction, interactive, candidate_id, context } = body;

    if (!to || !type) {
      return jsonError("Veld 'to' en 'type' zijn verplicht", 400);
    }

    const normalizedTo = normalizePhone(to);

    // Handle read receipts separately — just mark as read, no logging needed
    if (type === "read_receipt") {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const creds = await getWhatsAppCredentials(serviceClient, orgId);
      if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

      await fetch(`${META_API_BASE}/${creds.phone_number_id}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: body.message_id,
        }),
      });

      return jsonOk({ success: true });
    }

    // Check opt-out using anon client (respects RLS)
    if (candidate_id) {
      const { data: pref } = await supabase
        .from("communication_preferences")
        .select("opted_out")
        .eq("candidate_id", candidate_id)
        .eq("channel", "whatsapp")
        .eq("organization_id", orgId)
        .maybeSingle();

      if (pref?.opted_out) {
        return jsonError("Kandidaat heeft zich afgemeld voor WhatsApp", 403);
      }
    }

    // Service client for rate limit checks, credential decryption, and logging (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check rate limit (per minute)
    const { data: withinLimit } = await serviceClient.rpc("check_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
      p_window_type: "minute",
    });

    if (withinLimit === false) {
      return jsonError("Rate limit bereikt, probeer het later opnieuw", 429);
    }

    // Get decrypted credentials
    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) return jsonError("WhatsApp niet geconfigureerd", 400);

    // Build Meta API payload
    const metaPayload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo.replace("+", ""), // Meta wants digits only, no + prefix
    };

    let messageBody = "";

    switch (type) {
      case "text":
        metaPayload.type = "text";
        metaPayload.text = { body: text?.body ?? "", preview_url: text?.preview_url ?? false };
        messageBody = text?.body ?? "";
        break;

      case "template":
        metaPayload.type = "template";
        metaPayload.template = {
          name: template?.name,
          language: { code: template?.language ?? "nl" },
          components: template?.components ?? [],
        };
        messageBody = `[Template: ${template?.name}]`;
        break;

      case "image":
        metaPayload.type = "image";
        metaPayload.image = image;
        messageBody = image?.caption ?? "[Afbeelding]";
        break;

      case "video":
        metaPayload.type = "video";
        metaPayload.video = video;
        messageBody = video?.caption ?? "[Video]";
        break;

      case "audio":
        metaPayload.type = "audio";
        metaPayload.audio = audio;
        messageBody = "[Audio]";
        break;

      case "document":
        metaPayload.type = "document";
        metaPayload.document = document;
        messageBody = document?.caption ?? `[Document: ${document?.filename ?? "bestand"}]`;
        break;

      case "reaction":
        metaPayload.type = "reaction";
        metaPayload.reaction = reaction;
        messageBody = `[Reactie: ${reaction?.emoji}]`;
        break;

      case "interactive":
        metaPayload.type = "interactive";
        metaPayload.interactive = interactive;
        if (interactive?.type === "button") {
          messageBody = `[Knoppen: ${interactive?.body?.text ?? ""}]`;
        } else if (interactive?.type === "list") {
          messageBody = `[Lijst: ${interactive?.body?.text ?? ""}]`;
        } else {
          messageBody = "[Interactief bericht]";
        }
        break;

      default:
        return jsonError(`Onbekend berichttype: ${type}`, 400);
    }

    // Add reply-to context if provided
    if (context?.message_id) {
      metaPayload.context = { message_id: context.message_id };
    }

    // Send to Meta Cloud API
    const metaResponse = await fetch(
      `${META_API_BASE}/${creds.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metaPayload),
      }
    );

    const metaResult = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta API error:", metaResult);
      return jsonError(
        metaResult?.error?.message ?? "Bericht versturen mislukt",
        metaResponse.status === 400 ? 400 : 502
      );
    }

    const waMessageId = metaResult.messages?.[0]?.id;

    // Log to communications table (service client bypasses RLS)
    const { error: logError } = await serviceClient.from("communications").insert({
      organization_id: orgId,
      channel: "whatsapp",
      direction: "outbound",
      subject: `WhatsApp naar ${normalizedTo}`,
      body: messageBody,
      candidate_id: candidate_id ?? null,
      sent_by: userId,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: waMessageId,
      whatsapp_status: "pending",
      message_type: type,
    });

    if (logError) {
      console.error("Communication log failed:", logError);
      // Don't fail the request — message was already sent successfully
    }

    // Record rate limit usage
    await serviceClient.rpc("record_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
    });

    return jsonOk({ success: true, message_id: waMessageId });
  } catch (err) {
    console.error("whatsapp-send error:", err);
    return jsonError("Interne fout bij versturen", 500);
  }
});
