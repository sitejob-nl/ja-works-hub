import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderText(value: string | null | undefined): string {
  return escapeHtml(value ?? "").replace(/\n/g, "<br>");
}

function renderList(items: unknown, color = "#1e3a5f"): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const safeItems = items
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 5);
  if (safeItems.length === 0) return "";
  return `<ul style="margin:8px 0 0;padding-left:18px;color:${color};font-size:14px;line-height:1.5;">${
    safeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
  }</ul>`;
}

function renderReportRow(label: string, content: string): string {
  if (!content) return "";
  return `<tr><td style="padding:14px 20px;border-top:1px solid #dbeafe;">
    <span style="color:#1d4ed8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(label)}</span><br>
    ${content}
  </td></tr>`;
}

function buildProposalEmailHtml(data: {
  orgName: string;
  orgLogoUrl: string | null;
  orgEmail: string | null;
  orgPhone: string | null;
  contactName: string;
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  summary: string | null;
  functionGroup: string | null;
  classification: string | null;
  reliabilityScore: number | null;
  positiveSignals: string[] | null;
  riskFactors: string[] | null;
  targetFunctions: string[] | null;
  interviewQuestions: string[] | null;
  matchReasoning: string | null;
  responseUrl: string;
}): string {
  const profileBadges = [
    data.functionGroup ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;">${escapeHtml(data.functionGroup)}</span>` : "",
    data.classification ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#f8fafc;color:#334155;font-size:12px;">${escapeHtml(data.classification)}</span>` : "",
    data.reliabilityScore != null ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:12px;">Betrouwbaarheid ${Math.round(data.reliabilityScore)}%</span>` : "",
  ].join("");
  const reportRows = [
    renderReportRow("AI samenvatting", data.summary ? `<span style="color:#1e3a5f;font-size:14px;line-height:1.5;">${renderText(data.summary)}</span>` : ""),
    renderReportRow("Profiel", profileBadges),
    renderReportRow("Sterke signalen", renderList(data.positiveSignals, "#064e3b")),
    renderReportRow("Aandachtspunten", renderList(data.riskFactors, "#92400e")),
    renderReportRow("Passende functies", renderList(data.targetFunctions, "#1e3a5f")),
    renderReportRow("Vragen voor vervolggesprek", renderList(data.interviewQuestions, "#334155")),
    renderReportRow("Matchnotitie", data.matchReasoning ? `<span style="color:#475569;font-size:13px;line-height:1.5;">${renderText(data.matchReasoning)}</span>` : ""),
  ].join("");
  const hasReport = reportRows.trim().length > 0;
  const contactLine = [data.orgEmail, data.orgPhone]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ");

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#0f172a;padding:24px 32px;">
          ${data.orgLogoUrl ? `<img src="${escapeHtml(data.orgLogoUrl)}" alt="${escapeHtml(data.orgName)}" style="max-height:46px;max-width:180px;display:block;">` : `<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${escapeHtml(data.orgName)}</h1>`}
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;color:#1e293b;font-size:18px;">Kandidaatvoorstel</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Wij hebben een geschikte kandidaat gevonden voor ${escapeHtml(data.companyName)}: ${escapeHtml(data.vacancyTitle)}</p>

          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Beste ${escapeHtml(data.contactName)},</p>
          <p style="margin:0 0 24px;color:#334155;font-size:14px;">
            Graag stellen wij de volgende kandidaat aan u voor:
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #bfdbfe;">
              <span style="color:#1d4ed8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Kandidaat</span><br>
              <strong style="color:#1e3a5f;font-size:15px;">${escapeHtml(data.candidateName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #bfdbfe;">
              <span style="color:#1d4ed8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Functie</span><br>
              <strong style="color:#1e3a5f;font-size:15px;">${escapeHtml(data.vacancyTitle)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <span style="color:#1d4ed8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Opdrachtgever</span><br>
              <strong style="color:#1e3a5f;font-size:15px;">${escapeHtml(data.companyName)}</strong>
            </td></tr>
          </table>

          ${hasReport ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <strong style="color:#0f172a;font-size:15px;">AI-kandidaatrapport</strong>
            </td></tr>
            ${reportRows}
          </table>` : ""}

          <p style="margin:0 0 16px;color:#334155;font-size:14px;">
            Klik op onderstaande knop om aan te geven of u interesse heeft in deze kandidaat:
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center" style="padding:12px 0;">
              <a href="${escapeHtml(data.responseUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:600;">
                Reageer op dit voorstel
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;color:#334155;font-size:14px;">
            Met vriendelijke groet,<br><strong>${escapeHtml(data.orgName)}</strong>
            ${contactLine ? `<br><span style="color:#64748b;font-size:12px;">${contactLine}</span>` : ""}
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Dit is een automatisch gegenereerd bericht van ${escapeHtml(data.orgName)}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const orgId = auth.organizationId;
    const userId = auth.userId;
    const serviceClient = createAdminClient();

    const body = await req.json();
    const { match_id, preview } = body;

    if (!match_id) {
      return json({ error: "match_id is required" }, 400);
    }

    const { data: match, error: mErr } = await serviceClient
      .from("matches")
      .select(`
        *,
        candidates:candidate_id(id, first_name, last_name, email, phone, ai_summary, ai_function_group, ai_classification, ai_reliability_score, ai_positive_signals, ai_risk_factors, ai_target_functions, ai_interview_questions),
        vacancies:vacancy_id(id, title, companies:company_id(id, name, email))
      `)
      .eq("id", match_id)
      .eq("organization_id", orgId)
      .single();

    if (mErr || !match) {
      return json({ error: "Match not found" }, 404);
    }

    const candidate = (match as any).candidates;
    const vacancy = (match as any).vacancies;
    const company = vacancy?.companies;

    if (!candidate) {
      return json({ error: "Candidate not found" }, 404);
    }

    if (!company?.email) {
      return json({ error: "Opdrachtgever heeft geen e-mailadres" }, 400);
    }

    const candidateName = `${candidate.first_name} ${candidate.last_name}`.trim();

    const { data: org } = await serviceClient
      .from("organizations")
      .select("name, email, phone, logo_url")
      .eq("id", orgId)
      .maybeSingle();
    const orgName = org?.name || "je organisatie";

    const { data: contacts } = await serviceClient
      .from("company_contacts")
      .select("*")
      .eq("company_id", company.id)
      .eq("organization_id", orgId)
      .order("is_primary", { ascending: false })
      .limit(1);

    const contactName = contacts?.[0]?.full_name ?? company.name;
    const contactEmail = contacts?.[0]?.email ?? company.email;
    const subject = `Kandidaatvoorstel: ${candidateName} voor ${vacancy.title}`;

    const emailData = {
      orgName,
      orgLogoUrl: org?.logo_url ?? null,
      orgEmail: org?.email ?? null,
      orgPhone: org?.phone ?? null,
      contactName,
      candidateName,
      vacancyTitle: vacancy.title,
      companyName: company.name,
      summary: candidate.ai_summary ?? match.match_reasoning ?? null,
      functionGroup: candidate.ai_function_group ?? null,
      classification: candidate.ai_classification ?? null,
      reliabilityScore: candidate.ai_reliability_score ?? null,
      positiveSignals: candidate.ai_positive_signals ?? null,
      riskFactors: candidate.ai_risk_factors ?? null,
      targetFunctions: candidate.ai_target_functions ?? null,
      interviewQuestions: candidate.ai_interview_questions ?? null,
      matchReasoning: match.match_reasoning ?? null,
    };

    if (preview) {
      const html = buildProposalEmailHtml({ ...emailData, responseUrl: "#preview" });
      return json({
        preview: true,
        to: contactEmail,
        contact_name: contactName,
        subject,
        html,
      });
    }

    const { data: token, error: tokenErr } = await serviceClient
      .from("match_proposal_tokens")
      .insert({
        match_id: match.id,
        organization_id: orgId,
        contact_email: contactEmail,
      })
      .select("token")
      .single();

    if (tokenErr || !token) {
      return json({ error: "Failed to create proposal token" }, 500);
    }

    const responseUrl = await buildOrganizationPublicUrl(serviceClient, orgId, `/match-response/${token.token}`);
    const html = buildProposalEmailHtml({ ...emailData, responseUrl });

    const outlookResult = await sendViaOutlookAccount({
      orgId,
      to: contactEmail,
      subject,
      htmlBody: html,
      sentBy: userId,
      companyId: company.id,
    });

    await serviceClient
      .from("matches")
      .update({
        status: "voorgesteld_bij_klant",
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", match_id)
      .eq("organization_id", orgId);

    return json({
      success: true,
      sent_via: outlookResult.success ? "outlook" : "draft",
      outlook_error: outlookResult.success ? undefined : outlookResult.error,
      response_url: responseUrl,
    });
  } catch (err: any) {
    console.error("send-match-proposal error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
