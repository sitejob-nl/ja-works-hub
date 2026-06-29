import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { buildIcsEvent } from "../_shared/ics.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function html(text: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#334155;line-height:1.55;">${
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>")
  }</div>`;
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatNl(value: string): string {
  return new Date(value).toLocaleString("nl-NL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const matchId = typeof body.match_id === "string" ? body.match_id : "";
    const confirmedAt = typeof body.interview_confirmed_at === "string" ? body.interview_confirmed_at : "";
    const location = typeof body.interview_location === "string" ? body.interview_location.trim() : "";
    const interviewType = typeof body.interview_type === "string" ? body.interview_type : "op_kantoor";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    const notifyCandidate = body.notify_candidate !== false;
    const notifyCompany = body.notify_company !== false;
    const accountId = typeof body.account_id === "string" ? body.account_id : undefined;

    if (!matchId) return json({ error: "match_id_required" }, 400);
    if (!confirmedAt || Number.isNaN(new Date(confirmedAt).getTime())) return json({ error: "confirmed_at_invalid" }, 400);
    if (!location) return json({ error: "location_required" }, 400);

    const admin = createAdminClient();
    const { data: match, error: matchError } = await admin
      .from("matches")
      .select(`
        id, organization_id, status, candidate_id, vacancy_id,
        candidates:candidate_id(id, first_name, last_name, email),
        vacancies:vacancy_id(id, title, created_by, companies:company_id(id, name, email))
      `)
      .eq("id", matchId)
      .eq("organization_id", auth.organizationId)
      .single();
    if (matchError || !match) return json({ error: "match_not_found" }, 404);

    const candidate = (match as any).candidates;
    const vacancy = (match as any).vacancies;
    const company = vacancy?.companies;
    const { data: contactRows } = await admin
      .from("company_contacts")
      .select("id, full_name, email, is_primary")
      .eq("organization_id", auth.organizationId)
      .eq("company_id", company.id)
      .not("email", "is", null)
      .order("is_primary", { ascending: false });
    const companyContact = (contactRows ?? [])[0] ?? null;
    const companyEmail = companyContact?.email ?? company?.email ?? null;

    const candidateName = `${candidate?.first_name ?? ""} ${candidate?.last_name ?? ""}`.trim() || "kandidaat";
    const vacancyTitle = vacancy?.title ?? "de functie";
    const dateLabel = formatNl(confirmedAt);
    const title = `Afspraak ${candidateName} - ${vacancyTitle}`;
    const description = [
      `Afspraak voor kandidaat ${candidateName}`,
      `Functie: ${vacancyTitle}`,
      company?.name ? `Opdrachtgever: ${company.name}` : null,
      note ? `Opmerking: ${note}` : null,
    ].filter(Boolean).join("\n");
    const ics = buildIcsEvent({
      uid: `match-${match.id}@ja-werkt`,
      title,
      description,
      location,
      startsAt: confirmedAt,
      durationMinutes: 60,
    });
    const attachment = {
      name: "afspraak.ics",
      content_type: "text/calendar; charset=utf-8; method=REQUEST",
      content_base64: toBase64(ics),
    };

    const update = {
      status: "afspraak_op_kantoor",
      status_changed_at: new Date().toISOString(),
      interview_date: confirmedAt,
      interview_confirmed_at: confirmedAt,
      interview_location: location,
      interview_type: interviewType,
      interview_confirmed_by: auth.userId,
    };
    const { error: updateError } = await admin
      .from("matches")
      .update(update)
      .eq("id", match.id)
      .eq("organization_id", auth.organizationId);
    if (updateError) return json({ error: updateError.message }, 500);

    await admin.from("match_feedback_events").insert({
      organization_id: auth.organizationId,
      match_id: match.id,
      from_status: match.status ?? null,
      to_status: "afspraak_op_kantoor",
      notes: `Afspraak definitief gemaakt: ${dateLabel} (${location})${note ? `\n${note}` : ""}`,
      created_by: auth.userId,
    } as any);

    const sent: Record<string, unknown> = {};
    if (notifyCandidate && candidate?.email) {
      const res = await sendViaOutlookAccount({
        orgId: auth.organizationId,
        to: candidate.email,
        subject: `Afspraak bevestigd: ${vacancyTitle}`,
        htmlBody: html(`Hoi ${candidate.first_name ?? ""},\n\nDe afspraak voor ${vacancyTitle} is definitief gepland op ${dateLabel}.\nLocatie/type: ${location}.\n\nDe agenda-uitnodiging staat als bijlage bij deze mail.`),
        attachments: [attachment],
        accountId,
        sentBy: auth.userId,
        candidateId: candidate.id,
        companyId: company?.id,
        matchId: match.id,
      });
      sent.candidate = res;
    }
    if (notifyCompany && companyEmail) {
      const res = await sendViaOutlookAccount({
        orgId: auth.organizationId,
        to: companyEmail,
        subject: `Afspraak bevestigd: ${candidateName} - ${vacancyTitle}`,
        htmlBody: html(`Beste ${companyContact?.full_name ?? company?.name ?? ""},\n\nDe afspraak met ${candidateName} voor ${vacancyTitle} is definitief gepland op ${dateLabel}.\nLocatie/type: ${location}.\n\nDe agenda-uitnodiging staat als bijlage bij deze mail.`),
        attachments: [attachment],
        accountId,
        sentBy: auth.userId,
        candidateId: candidate?.id,
        companyId: company?.id,
        companyContactId: companyContact?.id,
        matchId: match.id,
      });
      sent.company = res;
    }

    return json({ success: true, sent });
  } catch (error) {
    console.error("confirm-match-interview error:", error);
    return json({ error: (error as Error).message ?? "internal_error" }, 500);
  }
});
