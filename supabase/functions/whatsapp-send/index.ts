// supabase/functions/whatsapp-send/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalProfile } from "../_shared/auth.ts";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  markWhatsAppMessageRead,
  sendOutboundWhatsApp,
} from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Internal-only: portal roles (medewerker/opdrachtgever) mogen nooit namens de
    // organisatie WhatsApp versturen. Alle interne rollen behouden toegang.
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const orgId = auth.organizationId;
    const userId = auth.userId;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const body = await req.json();
    const { to, type, text, template, image, video, audio, document, reaction, interactive, candidate_id, company_id, context } = body;

    if (!to || !type) {
      return jsonError("Veld 'to' en 'type' zijn verplicht", 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Handle read receipts separately — just mark as read, no logging needed
    if (type === "read_receipt") {
      if (!body.message_id) return jsonError("message_id is verplicht", 400);
      const readResult = await markWhatsAppMessageRead(serviceClient, {
        orgId,
        messageId: body.message_id,
      });
      if (!readResult.success) {
        return jsonError(readResult.error ?? "Leesbevestiging versturen mislukt", readResult.httpStatus ?? 502);
      }
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

    // Check rate limit (per minute)
    const { data: withinLimit } = await serviceClient.rpc("check_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
      p_window_type: "minute",
    });

    if (withinLimit === false) {
      return jsonError("Rate limit bereikt, probeer het later opnieuw", 429);
    }

    const sendResult = await sendOutboundWhatsApp(serviceClient, {
      orgId,
      to,
      type,
      text,
      template,
      image,
      video,
      audio,
      document,
      reaction,
      interactive,
      context,
      candidateId: candidate_id ?? null,
      companyId: company_id ?? null,
      sentBy: userId,
    });

    if (sendResult.paused) {
      return jsonOk({
        success: false,
        paused: true,
        message: sendResult.error,
      });
    }

    if (!sendResult.success) {
      return jsonError(sendResult.error ?? "Bericht versturen mislukt", sendResult.httpStatus ?? 502);
    }

    // Record rate limit usage
    await serviceClient.rpc("record_rate_limit", {
      p_org_id: orgId,
      p_channel: "whatsapp",
    });

    return jsonOk({ success: true, message_id: sendResult.messageId });
  } catch (err) {
    console.error("whatsapp-send error:", err);
    return jsonError("Interne fout bij versturen", 500);
  }
});
