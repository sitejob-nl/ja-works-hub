import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";
import { sanitizeEmailHtml } from "../_shared/outlook-signature.ts";
import { storagePathFromCvValue } from "../_shared/candidate-dossier.ts";
import { type BrandTheme, renderBrandedEmail, resolveBrandTheme } from "../_shared/email-layout.ts";

// 14 dagen — gelijk aan de DB-default op match_proposal_tokens.expires_at; expliciet
// gezet zodat de TTL in code zichtbaar is.
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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
  return `<tr><td style="padding:14px 20px;border-top:1px solid #e2e8f0;">
    <span style="color:#0C4D78;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(label)}</span><br>
    ${content}
  </td></tr>`;
}

function buildProposalEmailHtml(data: {
  theme: BrandTheme;
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
  hideReport?: boolean;
  hideReliability?: boolean;
}): string {
  const { theme } = data;
  const profileBadges = [
    data.functionGroup ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:${theme.navyHex};font-size:12px;">${escapeHtml(data.functionGroup)}</span>` : "",
    data.classification ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#f8fafc;color:#334155;font-size:12px;">${escapeHtml(data.classification)}</span>` : "",
    (!data.hideReliability && data.reliabilityScore != null) ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:12px;">Betrouwbaarheid ${Math.round(data.reliabilityScore)}%</span>` : "",
  ].join("");
  const reportRows = data.hideReport ? "" : [
    renderReportRow("Samenvatting", data.summary ? `<span style="color:${theme.navyHex};font-size:14px;line-height:1.5;">${renderText(data.summary)}</span>` : ""),
    renderReportRow("Profiel", profileBadges),
    renderReportRow("Sterke signalen", renderList(data.positiveSignals, "#064e3b")),
    renderReportRow("Aandachtspunten", renderList(data.riskFactors, "#92400e")),
    renderReportRow("Passende functies", renderList(data.targetFunctions, theme.navyHex)),
    renderReportRow("Vragen voor vervolggesprek", renderList(data.interviewQuestions, "#334155")),
    renderReportRow("Matchnotitie", data.matchReasoning ? `<span style="color:#475569;font-size:13px;line-height:1.5;">${renderText(data.matchReasoning)}</span>` : ""),
  ].join("");
  const hasReport = reportRows.trim().length > 0;
  const contactLine = [data.orgEmail, data.orgPhone]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ");

  const content = `<h2 style="margin:0 0 8px;color:${theme.navyHex};font-size:18px;">Kandidaatvoorstel</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Wij hebben een geschikte kandidaat gevonden voor ${escapeHtml(data.companyName)}: ${escapeHtml(data.vacancyTitle)}</p>

          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">Beste ${escapeHtml(data.contactName)},</p>
          <p style="margin:0 0 24px;color:${theme.textHex};font-size:14px;">
            Graag stellen wij de volgende kandidaat aan u voor:
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:${theme.navyHex};font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Kandidaat</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(data.candidateName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:${theme.navyHex};font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Functie</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(data.vacancyTitle)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <span style="color:${theme.navyHex};font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Opdrachtgever</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(data.companyName)}</strong>
            </td></tr>
          </table>

          ${hasReport ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <strong style="color:${theme.navyHex};font-size:15px;">Kandidaatprofiel</strong>
            </td></tr>
            ${reportRows}
          </table>` : ""}

          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">
            Klik op onderstaande knop om aan te geven of u interesse heeft in deze kandidaat:
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:6px;background:${theme.accentHex};">
            <a href="${escapeHtml(data.responseUrl)}" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">Reageer op dit voorstel</a>
          </td></tr></table>

          <p style="margin:8px 0 0;color:${theme.textHex};font-size:14px;">
            Met vriendelijke groet,<br><strong>${escapeHtml(theme.orgName)}</strong>
            ${contactLine ? `<br><span style="color:#64748b;font-size:12px;">${contactLine}</span>` : ""}
          </p>`;
  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: `Kandidaatvoorstel: ${data.candidateName} voor ${data.vacancyTitle}`,
    footerNote: "Dit is een automatisch gegenereerd bericht.",
  });
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
    const {
      match_id,
      preview,
      account_id,
      recipient_email,
      company_contact_id,
      cc,
      bcc,
      subject: subjectOverride,
      html: htmlOverride,
      hide_ai_report,
      hide_reliability,
      include_cv,
    } = body;

    if (!match_id) {
      return json({ error: "match_id is required" }, 400);
    }

    const { data: match, error: mErr } = await serviceClient
      .from("matches")
      .select(`
        *,
        candidates:candidate_id(id, first_name, last_name, email, phone, cv_file_url, ai_summary, ai_function_group, ai_classification, ai_reliability_score, ai_positive_signals, ai_risk_factors, ai_target_functions, ai_interview_questions),
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

    const candidateName = `${candidate.first_name} ${candidate.last_name}`.trim();

    const { data: org } = await serviceClient
      .from("organizations")
      .select("name, email, phone, logo_url, settings")
      .eq("id", orgId)
      .maybeSingle();
    const brandTheme = resolveBrandTheme(org);

    const { data: contacts } = await serviceClient
      .from("company_contacts")
      .select("id, full_name, email, is_primary")
      .eq("company_id", company.id)
      .eq("organization_id", orgId)
      .order("is_primary", { ascending: false });

    const contactRows = (contacts ?? []).filter((c) => c.email);
    const primaryContact = contactRows.find((c) => c.is_primary) ?? contactRows[0] ?? null;

    // Ontvanger-opties voor de UI: algemene bedrijfsmail + alle contactpersonen (primaire met ster).
    const recipientOptions = [
      ...(company.email ? [{ email: company.email, name: `${company.name} (algemeen)`, is_primary: false, contact_id: null }] : []),
      ...contactRows.map((c) => ({ email: c.email, name: c.full_name ?? c.email, is_primary: !!c.is_primary, contact_id: c.id })),
    ];

    const defaultEmail = primaryContact?.email ?? company.email;
    const defaultName = primaryContact?.full_name ?? company.name;

    if (!preview && !defaultEmail && !(typeof recipient_email === "string" && recipient_email.trim())) {
      return json({ error: "Opdrachtgever heeft geen e-mailadres" }, 400);
    }
    const subject = (typeof subjectOverride === "string" && subjectOverride.trim())
      ? subjectOverride.trim()
      : `Kandidaatvoorstel: ${candidateName} voor ${vacancy.title}`;

    // Standaard verbergen we de betrouwbaarheidsscore richting klant; het volledige rapport blijft tenzij uitgezet.
    const hideReliability = hide_reliability !== false;
    const hideReport = hide_ai_report === true;

    const emailData = {
      theme: brandTheme,
      orgEmail: org?.email ?? null,
      orgPhone: org?.phone ?? null,
      contactName: defaultName,
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
      hideReport,
      hideReliability,
    };

    if (preview) {
      // Placeholder ipv het echte token (bestaat nog niet); op verzenden vervangen.
      const html = buildProposalEmailHtml({ ...emailData, responseUrl: "{{RESPONSE_URL}}" });
      return json({
        preview: true,
        to: defaultEmail,
        contact_name: defaultName,
        subject,
        html,
        recipients: recipientOptions,
        has_cv: !!candidate.cv_file_url,
      });
    }

    // Definitieve ontvanger + bijbehorend contact bepalen.
    const finalRecipient = (typeof recipient_email === "string" && recipient_email.trim())
      ? recipient_email.trim()
      : defaultEmail;
    const matchedContact = contactRows.find((c) => c.email === finalRecipient) ?? null;
    const finalContactId = company_contact_id ?? matchedContact?.id ?? primaryContact?.id ?? null;

    // CV als bijlage (optioneel).
    let cvAttachment: { name: string; content_type: string; content_base64: string } | undefined;
    if (include_cv && candidate.cv_file_url) {
      const cvPath = storagePathFromCvValue(candidate.cv_file_url);
      if (cvPath) {
        const { data: file, error: dlErr } = await serviceClient.storage.from("documents").download(cvPath);
        if (!dlErr && file) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const ext = cvPath.split(".").pop()?.toLowerCase() ?? "";
          const contentType = ext === "pdf" ? "application/pdf"
            : (ext === "doc" || ext === "docx") ? "application/msword" : "application/octet-stream";
          cvAttachment = { name: `CV ${candidateName}.${ext || "pdf"}`, content_type: contentType, content_base64: btoa(binary) };
        }
      }
    }

    const { data: token, error: tokenErr } = await serviceClient
      .from("match_proposal_tokens")
      .insert({
        match_id: match.id,
        organization_id: orgId,
        contact_email: finalRecipient,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      .select("token")
      .single();

    if (tokenErr || !token) {
      return json({ error: "Failed to create proposal token" }, 500);
    }

    const responseUrl = await buildOrganizationPublicUrl(serviceClient, orgId, `/match-response/${token.token}`);
    const html = (typeof htmlOverride === "string" && htmlOverride.trim())
      ? sanitizeEmailHtml(htmlOverride).replaceAll("{{RESPONSE_URL}}", responseUrl)
      : buildProposalEmailHtml({ ...emailData, responseUrl });

    const outlookResult = await sendViaOutlookAccount({
      orgId,
      to: finalRecipient,
      cc: Array.isArray(cc) ? cc : undefined,
      bcc: Array.isArray(bcc) ? bcc : undefined,
      subject,
      htmlBody: html,
      attachments: cvAttachment ? [cvAttachment] : undefined,
      accountId: account_id ?? undefined,
      sentBy: userId,
      companyId: company.id,
      companyContactId: finalContactId ?? undefined,
    });

    if (!outlookResult.success) {
      return json({
        success: false,
        sent_via: outlookResult.method,
        outlook_error: outlookResult.error,
        communication_paused: outlookResult.communicationPaused === true,
        response_url: responseUrl,
        status_advanced: false,
      }, outlookResult.communicationPaused ? 409 : 502);
    }

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
      sent_via: "outlook",
      status_advanced: true,
      response_url: responseUrl,
    });
  } catch (err: any) {
    console.error("send-match-proposal error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
