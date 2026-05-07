import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, jsonError, callVoysApi } from "../_shared/voys-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!profile) {
      return jsonError("Profile not found", 404);
    }

    const orgId = profile.organization_id;

    // Get decrypted Voys token
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenData, error: rpcError } = await serviceClient.rpc("get_voys_token", {
      p_org_id: orgId,
    });

    if (rpcError || !tokenData || tokenData.length === 0) {
      return jsonError("Voys niet geconfigureerd", 400);
    }

    const voysConfig = tokenData[0];
    const apiToken = voysConfig.api_token;
    const clientUuid = voysConfig.client_uuid;

    // Fetch recent calls from Voys
    const { data: callsData, status: callsStatus } = await callVoysApi(
      apiToken,
      "call/personalized/?per_page=100&timezone=Europe/Amsterdam",
      "GET"
    );

    if (callsStatus !== 200) {
      return jsonError("Kon gesprekken niet ophalen van Voys", callsStatus);
    }

    const calls = Array.isArray(callsData) ? callsData : [];

    // Get existing voys_call_ids to avoid duplicates
    const voysCallIds = calls.map((c: any) => c.id).filter(Boolean);
    if (voysCallIds.length === 0) {
      return jsonResponse({ synced: 0, message: "Geen gesprekken gevonden" });
    }

    const { data: existingComms } = await serviceClient
      .from("communications")
      .select("voys_call_id")
      .eq("organization_id", orgId)
      .in("voys_call_id", voysCallIds);

    const existingIds = new Set((existingComms || []).map((c: any) => c.voys_call_id));

    // Get all candidates with phone numbers for matching
    const { data: candidates } = await serviceClient
      .from("candidates")
      .select("id, phone, first_name, last_name")
      .eq("organization_id", orgId)
      .not("phone", "is", null);

    // Build phone-to-candidate lookup (normalize phone numbers)
    const phoneToCandidate: Record<string, { id: string; name: string }> = {};
    for (const c of candidates || []) {
      if (c.phone) {
        const normalized = normalizePhone(c.phone);
        phoneToCandidate[normalized] = {
          id: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        };
      }
    }

    // Get company contacts for matching
    const { data: contacts } = await serviceClient
      .from("company_contacts")
      .select("id, phone, company_id, first_name, last_name")
      .not("phone", "is", null);

    // Filter to org's companies
    const { data: orgCompanies } = await serviceClient
      .from("companies")
      .select("id")
      .eq("organization_id", orgId);
    const orgCompanyIds = new Set((orgCompanies || []).map((c: any) => c.id));

    const phoneToContact: Record<string, { contact_id: string; company_id: string; name: string }> = {};
    for (const c of contacts || []) {
      if (c.phone && orgCompanyIds.has(c.company_id)) {
        const normalized = normalizePhone(c.phone);
        phoneToContact[normalized] = {
          contact_id: c.id,
          company_id: c.company_id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        };
      }
    }

    // Process new calls
    const newComms: any[] = [];
    const transcriptionFetches: { callId: string; commIndex: number }[] = [];

    for (const call of calls) {
      if (!call.id || existingIds.has(call.id)) continue;

      // Determine the external phone number
      const isIncoming = call.direction === "incoming";
      const externalParty = isIncoming ? call.from : call.to;
      const externalPhone = externalParty?.phone_number;
      const normalizedPhone = externalPhone ? normalizePhone(externalPhone) : null;

      // Match to candidate or company contact
      const candidateMatch = normalizedPhone ? phoneToCandidate[normalizedPhone] : null;
      const contactMatch = normalizedPhone ? phoneToContact[normalizedPhone] : null;

      // Build the body text
      const callerName = isIncoming
        ? (call.from?.caller_name || externalPhone || "Onbekend")
        : (call.to?.phone_number || "Onbekend");

      const directionLabel = isIncoming ? "Inkomend" : "Uitgaand";
      const durationMinutes = call.duration_in_seconds
        ? Math.round(call.duration_in_seconds / 60)
        : 0;
      const answeredLabel = call.answered ? "Beantwoord" : "Niet beantwoord";

      const bodyParts = [
        `${directionLabel} gesprek - ${answeredLabel}`,
        `Duur: ${durationMinutes} min`,
        externalPhone ? `Nummer: ${externalPhone}` : null,
        callerName !== externalPhone ? `Naam: ${callerName}` : null,
      ].filter(Boolean);

      const comm: any = {
        organization_id: orgId,
        channel: "voip",
        direction: isIncoming ? "inbound" : "outbound",
        body: bodyParts.join("\n"),
        call_duration_seconds: call.duration_in_seconds || 0,
        call_summary: call.summary || null,
        voys_call_id: call.id,
        sent_at: call.start_time || new Date().toISOString(),
        sent_by: null,
      };

      if (candidateMatch) {
        comm.candidate_id = candidateMatch.id;
      } else if (contactMatch) {
        comm.company_contact_id = contactMatch.contact_id;
        comm.company_id = contactMatch.company_id;
      }

      newComms.push(comm);

      // Queue transcription fetch if call was answered and we have client_uuid
      if (call.answered && clientUuid) {
        transcriptionFetches.push({
          callId: call.id,
          commIndex: newComms.length - 1,
        });
      }
    }

    // Fetch transcriptions (batch, max 10 at a time to avoid rate limits)
    for (let i = 0; i < transcriptionFetches.length && i < 10; i++) {
      const { callId, commIndex } = transcriptionFetches[i];
      try {
        const { data: transcriptionData, status: tStatus } = await callVoysApi(
          apiToken,
          `transcription-storage/clients/${clientUuid}/calls/${callId}/transcriptions`,
          "GET"
        );
        if (tStatus === 200 && transcriptionData) {
          const text = typeof transcriptionData === "string"
            ? transcriptionData
            : (transcriptionData as any).text || null;
          if (text) {
            newComms[commIndex].transcription = text;
          }
        }
      } catch (e) {
        // Transcription not available, continue
        console.warn(`Transcription fetch failed for call ${callId}:`, e);
      }
    }

    // Insert new communications
    let synced = 0;
    if (newComms.length > 0) {
      const { error: insertError } = await serviceClient
        .from("communications")
        .insert(newComms);

      if (insertError) {
        console.error("Insert error:", insertError);
        return jsonError("Fout bij opslaan gesprekken: " + insertError.message, 500);
      }
      synced = newComms.length;
    }

    // Update last_sync_at
    await serviceClient
      .from("voys_config")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    return jsonResponse({
      synced,
      total_calls: calls.length,
      already_synced: existingIds.size,
      matched_candidates: newComms.filter((c: any) => c.candidate_id).length,
      matched_contacts: newComms.filter((c: any) => c.company_contact_id).length,
      with_transcription: newComms.filter((c: any) => c.transcription).length,
    });
  } catch (err) {
    console.error("Voys sync error:", err);
    return jsonError("Internal server error", 500);
  }
});

/**
 * Normalize a phone number for matching.
 * Strips spaces, dashes, and converts local Dutch format to international.
 */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s()-]/g, "");
  // Convert Dutch local format to international
  if (cleaned.startsWith("06")) {
    cleaned = "+31" + cleaned.slice(1);
  } else if (cleaned.startsWith("0")) {
    cleaned = "+31" + cleaned.slice(1);
  }
  return cleaned;
}
