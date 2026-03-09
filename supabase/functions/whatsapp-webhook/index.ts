import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
      },
    });
  }

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find config by webhook secret — we don't know the tenant yet
    // Since webhook_secret is unique per tenant, use it for lookup
    const { data: configs, error: findError } = await serviceClient
      .from("whatsapp_config")
      .select("*")
      .eq("webhook_secret", webhookSecret);

    if (findError || !configs || configs.length === 0) {
      console.error("No config found for webhook secret");
      return new Response("OK", { status: 200 }); // Always return 200
    }

    const config = configs[0];
    const orgId = config.organization_id;

    // Process changes
    const entry = body; // The body IS the entry object from SiteJob Connect
    const changes = entry.changes || [];

    for (const change of changes) {
      const value = change.value;

      // Process inbound messages
      if (value?.messages) {
        for (const msg of value.messages) {
          const contact = value.contacts?.[0];
          const senderName = contact?.profile?.name || msg.from;
          const phoneNumberId = value.metadata?.phone_number_id;

          // Extract body text based on message type
          let bodyText = "";
          switch (msg.type) {
            case "text":
              bodyText = msg.text?.body || "";
              break;
            case "image":
              bodyText = `[Afbeelding] ${msg.image?.caption || ""}`.trim();
              break;
            case "video":
              bodyText = `[Video] ${msg.video?.caption || ""}`.trim();
              break;
            case "audio":
              bodyText = "[Spraakbericht]";
              break;
            case "document":
              bodyText = `[Document: ${msg.document?.filename || "bestand"}] ${msg.document?.caption || ""}`.trim();
              break;
            case "sticker":
              bodyText = "[Sticker]";
              break;
            case "location":
              bodyText = `[Locatie: ${msg.location?.name || `${msg.location?.latitude}, ${msg.location?.longitude}`}]`;
              break;
            case "contacts":
              bodyText = `[Contact: ${msg.contacts?.[0]?.name?.formatted_name || "onbekend"}]`;
              break;
            case "reaction":
              bodyText = `[Reactie: ${msg.reaction?.emoji || ""}]`;
              break;
            case "interactive":
              if (msg.interactive?.type === "button_reply") {
                bodyText = msg.interactive.button_reply?.title || "";
              } else if (msg.interactive?.type === "list_reply") {
                bodyText = msg.interactive.list_reply?.title || "";
              }
              break;
            case "button":
              bodyText = msg.button?.text || "";
              break;
            default:
              bodyText = `[${msg.type}]`;
          }

          // Check for duplicate
          const { data: existing } = await serviceClient
            .from("communications")
            .select("id")
            .eq("whatsapp_message_id", msg.id)
            .eq("organization_id", orgId)
            .maybeSingle();

          if (existing) {
            console.log("Duplicate message skipped:", msg.id);
            continue;
          }

          // Try to find candidate by phone number
          const fromNumber = msg.from;
          let candidateId: string | null = null;

          // Search by phone (try different formats)
          const phoneVariants = [
            fromNumber,
            `+${fromNumber}`,
            fromNumber.replace(/^31/, "+31"),
            fromNumber.replace(/^31/, "0"),
          ];

          for (const phone of phoneVariants) {
            const { data: candidate } = await serviceClient
              .from("candidates")
              .select("id")
              .eq("organization_id", orgId)
              .eq("phone", phone)
              .maybeSingle();

            if (candidate) {
              candidateId = candidate.id;
              break;
            }
          }

          // Check for opt-out keywords
          const optOutKeywords = ["stop", "afmelden", "unsubscribe", "uitschrijven", "stoppen"];
          const messageText = bodyText.toLowerCase().trim();
          const isOptOut = optOutKeywords.some(keyword => messageText === keyword || messageText.startsWith(keyword + " "));

          // Insert communication
          const { error: insertError } = await serviceClient
            .from("communications")
            .insert({
              organization_id: orgId,
              channel: "whatsapp",
              direction: "inbound",
              subject: `WhatsApp van ${senderName}`,
              body: bodyText,
              candidate_id: candidateId,
              whatsapp_message_id: msg.id,
              sent_at: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
            });

          if (insertError) {
            console.error("Insert error:", insertError);
          } else {
            console.log("Inbound message stored:", msg.id, "candidate:", candidateId);
          }

          // Handle opt-out if detected and candidate found
          if (isOptOut && candidateId) {
            console.log("Opt-out keyword detected, processing opt-out for:", candidateId);
            
            try {
              const optOutUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/opt-out-handler`;
              await fetch(optOutUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  candidate_id: candidateId,
                  channel: "whatsapp",
                }),
              });
              
              console.log("Opt-out processed for:", candidateId);
            } catch (optOutError) {
              console.error("Failed to process opt-out:", optOutError);
            }
          }
        }
      }

      // Process status updates
      if (value?.statuses) {
        for (const status of value.statuses) {
          const { error: updateError } = await serviceClient
            .from("communications")
            .update({ whatsapp_status: status.status })
            .eq("whatsapp_message_id", status.id)
            .eq("organization_id", orgId);

          if (updateError) {
            console.error("Status update error:", updateError);
          } else {
            console.log("Status updated:", status.id, "->", status.status);
          }
        }
      }
    }

    // Always return 200
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    // Always return 200 to prevent retries
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
