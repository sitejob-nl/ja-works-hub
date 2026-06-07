import { createAdminClient, jsonResponse, requireInternalProfile } from "../_shared/auth.ts";
import { isOutboundPaused } from "../_shared/outbound-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MATCHES = 200;

const uniqueStrings = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];

const candidateName = (candidate: any) =>
  `${candidate?.first_name ?? ""} ${candidate?.last_name ?? ""}`.trim() || "kandidaat";

const markerForMatch = (matchId: string) => `[match-bulk-notification:${matchId}]`;

const optedOut = (prefs: Map<string, Set<string>>, candidateId: string, channel: string) =>
  prefs.get(candidateId)?.has(channel) === true;

function buildNotificationCopy(match: any) {
  const candidate = match.candidates;
  const vacancy = match.vacancies;
  const company = vacancy?.companies;
  const vacancyTitle = vacancy?.title ?? "een passende vacature";
  const companyName = company?.name ?? null;
  const companyLine = companyName ? ` bij ${companyName}` : "";

  return {
    title: `Nieuwe vacature: ${vacancyTitle}`,
    appMessage: `${companyName ? `${companyName} zoekt versterking. ` : ""}Je recruiter heeft je gematcht op deze vacature en neemt contact met je op.`,
    emailSubject: `Nieuwe vacature: ${vacancyTitle}`,
    emailBody: [
      `Hoi ${candidate?.first_name ?? ""},`,
      "",
      `We hebben een mogelijke match voor je gevonden: ${vacancyTitle}${companyLine}.`,
      "Je recruiter neemt contact met je op om de details en je interesse te bespreken.",
      "",
      "Met vriendelijke groet,",
      "JA Werkt",
    ].join("\n"),
    whatsappBody: `Hoi ${candidate?.first_name ?? ""}, we hebben een mogelijke match voor je gevonden: ${vacancyTitle}${companyLine}. Je recruiter neemt contact met je op.`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const matchIds = uniqueStrings(body.match_ids ?? body.matchIds);
  if (matchIds.length === 0) return jsonResponse({ error: "match_ids_required" }, 400, corsHeaders);
  if (matchIds.length > MAX_MATCHES) {
    return jsonResponse({ error: `max_${MAX_MATCHES}_matches` }, 400, corsHeaders);
  }

  const admin = createAdminClient();
  const emailPaused = await isOutboundPaused(admin, auth.organizationId, "email");
  const whatsappPaused = await isOutboundPaused(admin, auth.organizationId, "whatsapp");

  try {
    const { data: matches, error: matchError } = await admin
      .from("matches")
      .select(`
        id,
        candidate_id,
        vacancy_id,
        candidates!matches_candidate_id_fkey(id, first_name, last_name, email, phone, portal_enabled),
        vacancies!matches_vacancy_id_fkey(id, title, companies!vacancies_company_id_fkey(id, name))
      `)
      .eq("organization_id", auth.organizationId)
      .in("id", matchIds);

    if (matchError) throw matchError;
    const rows = (matches ?? []) as any[];
    const candidateIds = [...new Set(rows.map((match) => match.candidate_id).filter(Boolean))];

    const preferenceMap = new Map<string, Set<string>>();
    if (candidateIds.length > 0) {
      const { data: preferences, error: prefError } = await admin
        .from("communication_preferences")
        .select("candidate_id, channel, opted_out")
        .eq("organization_id", auth.organizationId)
        .in("candidate_id", candidateIds)
        .in("channel", ["email", "whatsapp"]);
      if (prefError) throw prefError;

      for (const pref of preferences ?? []) {
        if (!pref.opted_out) continue;
        if (!preferenceMap.has(pref.candidate_id)) preferenceMap.set(pref.candidate_id, new Set());
        preferenceMap.get(pref.candidate_id)!.add(pref.channel);
      }
    }

    const { data: existingNotifications, error: notificationLookupError } = await admin
      .from("employee_notifications")
      .select("reference_id")
      .eq("organization_id", auth.organizationId)
      .eq("reference_table", "matches")
      .in("reference_id", matchIds);
    if (notificationLookupError) throw notificationLookupError;
    const notifiedMatches = new Set((existingNotifications ?? []).map((row: any) => row.reference_id).filter(Boolean));

    const existingCommunicationMarkers = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: existingCommunications, error: communicationLookupError } = await admin
        .from("communications")
        .select("channel, body")
        .eq("organization_id", auth.organizationId)
        .eq("message_type", "bulk_match_notification")
        .in("candidate_id", candidateIds);
      if (communicationLookupError) throw communicationLookupError;

      for (const communication of existingCommunications ?? []) {
        const bodyText = String((communication as any).body ?? "");
        for (const matchId of matchIds) {
          if (bodyText.includes(markerForMatch(matchId))) {
            existingCommunicationMarkers.add(`${(communication as any).channel}:${matchId}`);
          }
        }
      }
    }

    const now = new Date().toISOString();
    const notificationRows: any[] = [];
    const communicationRows: any[] = [];
    const skipped: Record<string, number> = {
      missing_candidate: 0,
      portal_disabled: 0,
      duplicate_app: 0,
      missing_email: 0,
      email_paused: 0,
      email_opted_out: 0,
      duplicate_email: 0,
      missing_phone: 0,
      whatsapp_paused: 0,
      whatsapp_opted_out: 0,
      duplicate_whatsapp: 0,
    };

    for (const match of rows) {
      const candidate = match.candidates;
      if (!candidate?.id) {
        skipped.missing_candidate++;
        continue;
      }

      const copy = buildNotificationCopy(match);
      const marker = markerForMatch(match.id);

      if (candidate.portal_enabled) {
        if (notifiedMatches.has(match.id)) {
          skipped.duplicate_app++;
        } else {
          notificationRows.push({
            organization_id: auth.organizationId,
            candidate_id: candidate.id,
            type: "overig",
            severity: "info",
            title: copy.title,
            message: copy.appMessage,
            reference_table: "matches",
            reference_id: match.id,
            created_at: now,
          });
        }
      } else {
        skipped.portal_disabled++;
      }

      if (!candidate.email) {
        skipped.missing_email++;
      } else if (emailPaused) {
        skipped.email_paused++;
      } else if (optedOut(preferenceMap, candidate.id, "email")) {
        skipped.email_opted_out++;
      } else if (existingCommunicationMarkers.has(`email:${match.id}`)) {
        skipped.duplicate_email++;
      } else {
        communicationRows.push({
          organization_id: auth.organizationId,
          candidate_id: candidate.id,
          channel: "email",
          direction: "outbound",
          subject: copy.emailSubject,
          body: `${copy.emailBody}\n\n${marker}`,
          email_to: [candidate.email],
          sent_at: now,
          sent_by: auth.userId,
          message_type: "bulk_match_notification",
        });
      }

      if (!candidate.phone) {
        skipped.missing_phone++;
      } else if (whatsappPaused) {
        skipped.whatsapp_paused++;
      } else if (optedOut(preferenceMap, candidate.id, "whatsapp")) {
        skipped.whatsapp_opted_out++;
      } else if (existingCommunicationMarkers.has(`whatsapp:${match.id}`)) {
        skipped.duplicate_whatsapp++;
      } else {
        communicationRows.push({
          organization_id: auth.organizationId,
          candidate_id: candidate.id,
          channel: "whatsapp",
          direction: "outbound",
          subject: `WhatsApp concept: ${copy.title}`,
          body: `${copy.whatsappBody}\n\n${marker}`,
          sent_at: now,
          sent_by: auth.userId,
          whatsapp_status: "draft",
          message_type: "bulk_match_notification",
        });
      }
    }

    if (notificationRows.length > 0) {
      const { error } = await admin.from("employee_notifications").insert(notificationRows);
      if (error) throw error;
    }

    if (communicationRows.length > 0) {
      const { error } = await admin.from("communications").insert(communicationRows);
      if (error) throw error;
    }

    const emailRecords = communicationRows.filter((row) => row.channel === "email").length;
    const whatsappRecords = communicationRows.filter((row) => row.channel === "whatsapp").length;

    return jsonResponse({
      success: true,
      requested: matchIds.length,
      matched: rows.length,
      app_notifications: notificationRows.length,
      email_records: emailRecords,
      whatsapp_records: whatsappRecords,
      skipped,
    }, 200, corsHeaders);
  } catch (error) {
    console.error("match-bulk-notify error:", error);
    return jsonResponse({ error: (error as Error).message ?? "Internal server error" }, 500, corsHeaders);
  }
});
