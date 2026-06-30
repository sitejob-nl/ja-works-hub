// supabase/functions/whatsapp-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone, sendOutboundWhatsAppText } from "../_shared/whatsapp-utils.ts";
import { cascadeSickReport } from "../_shared/sick-report-handler.ts";
import { getWhatsAppAutomationSettings } from "../_shared/whatsapp-automation-settings.ts";
import { advanceMatchStatus } from "../_shared/match-lifecycle.ts";

const OPT_OUT_KEYWORDS = ["stop", "afmelden", "uitschrijven", "stoppen", "unsubscribe"];
// Substring match — any of these anywhere in the message triggers sick flow.
// Intentionally permissive: false positives just create an extra sick_report
// which the intercedent reviews and can cancel.
const SICK_KEYWORDS = [
  "ziekmelding",
  "ziekgemeld",
  "ziek gemeld",
  "ik ben ziek",
  "ben ziek",
  "te ziek",
  "niet komen",
  "niet werken",
  "thuisblijven",
  "sick today",
  "call in sick",
  "im sick",
  "i'm sick",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-webhook-secret",
      },
    });
  }

  // Always return 200 to prevent SiteJob Connect retries
  const ok = () =>
    new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      console.error("Missing X-Webhook-Secret header");
      return ok();
    }

    const body = await req.json();

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // O(1) org lookup: find config by waba_id from payload body.id field
    const wabaId = body.id;
    let config: any = null;

    if (wabaId) {
      const { data } = await serviceClient
        .from("whatsapp_config")
        .select("id, organization_id, webhook_secret")
        .eq("waba_id", wabaId)
        .eq("is_active", true)
        .maybeSingle();
      config = data;
    }

    // Fallback: loop all active configs, decrypt each webhook_secret, compare
    if (!config) {
      const { data: configs } = await serviceClient
        .from("whatsapp_config")
        .select("id, organization_id, webhook_secret")
        .eq("is_active", true);

      if (configs) {
        for (const c of configs) {
          const { data: decrypted } = await serviceClient.rpc("decrypt_sensitive", {
            ciphertext: c.webhook_secret,
          });
          if (decrypted === webhookSecret) {
            config = c;
            break;
          }
        }
      }
    }

    if (!config) {
      console.error("No matching config for webhook secret");
      return ok();
    }

    // Validate webhook secret for the waba_id match path (always validate)
    if (wabaId) {
      if (!config.webhook_secret) {
        console.error("No webhook_secret stored for config — rejecting");
        return ok();
      }
      const { data: decrypted } = await serviceClient.rpc("decrypt_sensitive", {
        ciphertext: config.webhook_secret,
      });
      if (decrypted !== webhookSecret) {
        console.error("Webhook secret mismatch");
        return ok();
      }
    }

    const orgId = config.organization_id;
    const changes = body.changes || [];

    for (const change of changes) {
      const value = change.value;
      if (!value) continue;

      // Process inbound messages
      if (value.messages) {
        for (const msg of value.messages) {
          await processInboundMessage(
            serviceClient,
            orgId,
            msg,
            value.contacts,
            value.metadata
          );
        }
      }

      // Process status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await processStatusUpdate(serviceClient, status);
        }
      }
    }

    return ok();
  } catch (err) {
    console.error("whatsapp-webhook error:", err);
    return ok();
  }
});

// Interesse-respons op een bulk match-bericht (VacancyMatchesTab "Interesse-bericht").
// De ja/nee-knoppen dragen een reply-id match_ja:<matchId> / match_nee:<matchId>; hiermee
// verschuift de match automatisch naar de juiste fase (Carerix-stijl "ja/nee → fase").
async function handleMatchInterest(supabase: any, orgId: string, replyId: string) {
  const isYes = replyId.startsWith("match_ja:");
  const matchId = replyId.slice(replyId.indexOf(":") + 1);
  if (!matchId) return;
  const { data: match } = await supabase
    .from("matches")
    .select("id, status, match_score, match_breakdown")
    .eq("id", matchId)
    .eq("organization_id", orgId)
    .maybeSingle();
  // Niet terugzetten als de match al verder of terminaal is.
  if (!match || ["geaccepteerd", "geplaatst", "afgewezen"].includes(match.status)) return;
  const newStatus = isYes ? "afspraak_voorgesteld" : "afgewezen";
  await advanceMatchStatus(supabase, {
    orgId,
    matchId,
    toStatus: newStatus,
    currentMatch: { ...match, organization_id: orgId },
    requireReason: false,
    eventMode: "always",
    notes: isYes
      ? "Kandidaat reageerde 'Ja, interesse' via WhatsApp — afspraakvoorstel opvolgen"
      : "Kandidaat reageerde 'Nee, bedankt' via WhatsApp",
  });
}

async function processInboundMessage(
  supabase: any,
  orgId: string,
  msg: any,
  contacts: any[],
  metadata: any
) {
  const from = normalizePhone(msg.from);
  const messageId = msg.id;
  const messageType = msg.type;
  const timestamp = msg.timestamp
    ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  // Extract message body and media_id based on type
  let body = "";
  let mediaId: string | null = null;
  let interactiveReplyId: string | null = null;

  switch (messageType) {
    case "text":
      body = msg.text?.body ?? "";
      break;
    case "image":
      body = msg.image?.caption ?? "[Afbeelding]";
      mediaId = msg.image?.id ?? null;
      break;
    case "video":
      body = msg.video?.caption ?? "[Video]";
      mediaId = msg.video?.id ?? null;
      break;
    case "audio":
      body = "[Audio]";
      mediaId = msg.audio?.id ?? null;
      break;
    case "document":
      body = msg.document?.caption ?? `[Document: ${msg.document?.filename ?? "bestand"}]`;
      mediaId = msg.document?.id ?? null;
      break;
    case "sticker":
      body = "[Sticker]";
      mediaId = msg.sticker?.id ?? null;
      break;
    case "location":
      body = `[Locatie: ${
        msg.location?.name ??
        `${msg.location?.latitude}, ${msg.location?.longitude}`
      }]`;
      break;
    case "contacts":
      body = `[Contact: ${msg.contacts?.[0]?.name?.formatted_name ?? "onbekend"}]`;
      break;
    case "reaction":
      body = `[Reactie: ${msg.reaction?.emoji ?? ""}]`;
      break;
    case "interactive": {
      const ir = msg.interactive;
      body =
        ir?.button_reply?.title ?? ir?.list_reply?.title ?? "[Interactief antwoord]";
      interactiveReplyId = ir?.button_reply?.id ?? ir?.list_reply?.id ?? null;
      break;
    }
    case "button":
      body = msg.button?.text ?? "[Button antwoord]";
      break;
    default:
      body = `[${messageType}]`;
  }

  // Match candidate by normalized phone (E.164, without +, with leading 0)
  const fromWithout = from.replace("+", ""); // e.g. 31612345678
  const fromLocal = from.startsWith("+31")
    ? "0" + from.substring(3) // e.g. 0612345678
    : from;

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id")
    .eq("organization_id", orgId)
    .or(`phone.eq.${from},phone.eq.${fromWithout},phone.eq.${fromLocal}`)
    .maybeSingle();

  const candidateId = candidate?.id ?? null;

  // COM1: als het nummer geen kandidaat is, kijk of het een bedrijfscontact is — dan verschijnt
  // inkomende bedrijfs-WhatsApp ook in de Comm-tab van de opdrachtgever (niet alleen kandidaten).
  let companyId: string | null = null;
  let companyContactId: string | null = null;
  if (!candidateId) {
    const { data: companyContact } = await supabase
      .from("company_contacts")
      .select("id, company_id")
      .eq("organization_id", orgId)
      .or(`phone.eq.${from},phone.eq.${fromWithout},phone.eq.${fromLocal}`)
      .limit(1);
    if (companyContact?.[0]) {
      companyContactId = companyContact[0].id;
      companyId = companyContact[0].company_id;
    }
  }

  const contactName = contacts?.[0]?.profile?.name ?? from;

  // Ja/nee-respons op een bulk match-interesse-bericht → match automatisch naar de juiste fase.
  if (interactiveReplyId && (interactiveReplyId.startsWith("match_ja:") || interactiveReplyId.startsWith("match_nee:"))) {
    await handleMatchInterest(supabase, orgId, interactiveReplyId);
  }

  // Opt-out detection: text messages only, check start of message
  if (messageType === "text" && body) {
    const lowerBody = body.toLowerCase().trim();
    const isOptOut = OPT_OUT_KEYWORDS.some(
      (kw) =>
        lowerBody === kw ||
        lowerBody.startsWith(kw + " ") ||
        lowerBody.startsWith(kw + ".")
    );

    if (isOptOut && candidateId) {
      await supabase.from("communication_preferences").upsert(
        {
          organization_id: orgId,
          candidate_id: candidateId,
          channel: "whatsapp",
          opted_out: true,
          opted_out_at: new Date().toISOString(),
          opted_out_reason: `Auto: "${body}"`,
        },
        { onConflict: "candidate_id,channel,organization_id" }
      );

      // Mark pending campaign recipients as opted_out
      await supabase
        .from("campaign_recipients")
        .update({ status: "opted_out" })
        .eq("candidate_id", candidateId)
        .eq("status", "pending");
    }

    const handledState = !isOptOut && candidateId
      ? await processPendingConversationState(supabase, orgId, candidateId, from, body, timestamp)
      : false;

    // Sick-leave detection — auto-create sick_report + cascade notifications
    const automation = await getWhatsAppAutomationSettings(supabase, orgId);
    const isSick = !isOptOut && SICK_KEYWORDS.some((kw) => lowerBody.includes(kw));
    if (!handledState && automation.sick_report_enabled && isSick && candidateId) {
      if (automation.sick_report_ask_reason) {
        await supabase.from("whatsapp_conversation_states").upsert(
          {
            organization_id: orgId,
            candidate_id: candidateId,
            phone: from,
            flow_type: "sick_report",
            step: "awaiting_reason",
            context: { initial_message: body, reported_at: timestamp },
            expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
          },
          { onConflict: "organization_id,phone,flow_type" },
        );
        await sendWhatsAppDirect(
          supabase,
          orgId,
          from,
          "Dank je, we hebben je ziekmelding ontvangen. Wanneer verwacht je weer te kunnen werken? Stuur alleen een datum of korte planninginfo, geen medische details. Typ 'geen' als je dit nog niet weet.",
          candidateId,
        );
      } else {
        await createSickReportFromWhatsApp(supabase, orgId, candidateId, "geen", timestamp);
      }
    }
  }

  // Insert communication — unique index on whatsapp_message_id handles dedup (catches 23505)
  const { error: insertError } = await supabase.from("communications").insert({
    organization_id: orgId,
    channel: "whatsapp",
    direction: "inbound",
    subject: `WhatsApp van ${contactName} (${from})`,
    body,
    candidate_id: candidateId,
    company_id: companyId,
    company_contact_id: companyContactId,
    sent_at: timestamp,
    whatsapp_message_id: messageId,
    whatsapp_status: "received",
    message_type: messageType,
    media_id: mediaId,
  });

  if (insertError) {
    // 23505 = unique_violation — expected for duplicate delivery, safe to ignore
    if (insertError.code !== "23505" && !insertError.message?.includes("unique")) {
      console.error("Insert communication failed:", insertError);
    } else {
      console.log("Duplicate message skipped:", messageId);
    }
  }
}

async function sendWhatsAppDirect(supabase: any, orgId: string, to: string, text: string, candidateId?: string | null) {
  const result = await sendOutboundWhatsAppText(supabase, {
    orgId,
    to,
    text,
    candidateId: candidateId ?? null,
    subject: `WhatsApp naar ${normalizePhone(to)}`,
  });
  return { ok: result.success, error: result.error };
}

function amsterdamHHMM(iso: string): string {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

async function createSickReportFromWhatsApp(
  supabase: any,
  orgId: string,
  candidateId: string,
  reason: string,
  timestamp: string,
) {
  const automation = await getWhatsAppAutomationSettings(supabase, orgId);
  const cutoff = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: recent } = await supabase
    .from("sick_reports")
    .select("id")
    .eq("candidate_id", candidateId)
    .is("actual_return_date", null)
    .gte("reported_at", cutoff)
    .limit(1);

  if (recent?.length) return null;

  const reportedTime = amsterdamHHMM(timestamp);
  const deadlineLabel = reportedTime <= automation.sick_report_deadline_time ? "voor deadline" : "na deadline";
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("candidate_id", candidateId)
    .maybeSingle();

  const { data: inserted } = await supabase
    .from("sick_reports")
    .insert({
      organization_id: orgId,
      candidate_id: candidateId,
      employee_id: employee?.id ?? null,
      notes: reason.trim().toLowerCase() === "geen"
        ? `Automatisch uit WhatsApp (${deadlineLabel}, deadline ${automation.sick_report_deadline_time}).`
        : `Automatisch uit WhatsApp (${deadlineLabel}, deadline ${automation.sick_report_deadline_time}). Aanvullende planninginformatie ontvangen.`,
      reported_at: timestamp,
    })
    .select("id")
    .single();

  if (inserted?.id) {
    try {
      await cascadeSickReport(supabase, inserted.id, null);
    } catch (e) {
      console.error("cascadeSickReport failed:", e);
    }
  }

  return inserted?.id ?? null;
}

async function processPendingConversationState(
  supabase: any,
  orgId: string,
  candidateId: string,
  phone: string,
  body: string,
  timestamp: string,
) {
  const { data: state } = await supabase
    .from("whatsapp_conversation_states")
    .select("*")
    .eq("organization_id", orgId)
    .eq("phone", phone)
    .eq("flow_type", "sick_report")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!state || state.step !== "awaiting_reason") return false;

  const reportId = await createSickReportFromWhatsApp(
    supabase,
    orgId,
    candidateId,
    body,
    state.context?.reported_at ?? timestamp,
  );

  await supabase
    .from("whatsapp_conversation_states")
    .delete()
    .eq("id", state.id);

  if (!reportId) {
    await sendWhatsAppDirect(
      supabase,
      orgId,
      phone,
      "Je ziekmelding lijkt al geregistreerd. Je intercedent neemt contact met je op.",
      candidateId,
    );
  }

  return true;
}

async function processStatusUpdate(supabase: any, status: any) {
  const messageId = status.id;
  const newStatus = status.status; // sent, delivered, read, failed

  const updateData: Record<string, unknown> = {
    whatsapp_status: newStatus,
  };

  // Store error title in body for failed messages
  if (newStatus === "failed" && status.errors?.length) {
    const err = status.errors[0];
    updateData.body = `[Mislukt: ${err.title ?? err.message ?? "onbekende fout"}]`;
  }

  const { error } = await supabase
    .from("communications")
    .update(updateData)
    .eq("whatsapp_message_id", messageId);

  if (error) {
    console.error("Status update failed for message:", messageId, error);
  }
}
