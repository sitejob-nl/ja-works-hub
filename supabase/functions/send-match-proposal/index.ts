import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";
import { sanitizeEmailHtml } from "../_shared/outlook-signature.ts";
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

function cleanEditableText(value: unknown, fallback: string, maxLength = 4000): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
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

function renderFactList(items: Array<string | null | undefined>, color = "#1e3a5f"): string {
  return renderList(items.filter((item): item is string => typeof item === "string" && item.trim().length > 0), color);
}

function formatDateNl(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatReliabilityScore(value: number | null | undefined): string | null {
  if (value == null) return null;
  return value <= 10 ? `${Math.round(value)}/10` : `${Math.round(value)}%`;
}

function renderReportRow(label: string, content: string): string {
  if (!content) return "";
  return `<tr><td style="padding:14px 20px;border-top:1px solid #e2e8f0;">
    <span style="color:#0C4D78;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(label)}</span><br>
    ${content}
  </td></tr>`;
}

function buildContentSnapshot(input: {
  match: any;
  candidate: any;
  vacancy: any;
  company: any;
  subject: string;
  introText: string;
  closingText: string;
  emailData: Record<string, unknown>;
  responseUrl: string;
}) {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    subject: input.subject,
    intro_text: input.introText,
    closing_text: input.closingText,
    response_url: input.responseUrl,
    candidate: {
      id: input.candidate.id,
      first_name: input.candidate.first_name ?? null,
      last_name: input.candidate.last_name ?? null,
      name: `${input.candidate.first_name ?? ""} ${input.candidate.last_name ?? ""}`.trim(),
      cv_file_url: input.candidate.cv_file_url ?? null,
      available_from: input.candidate.available_from ?? null,
      arrival_date: input.candidate.arrival_date ?? null,
      availability_notes: input.candidate.availability_notes ?? null,
      address_city: input.candidate.address_city ?? null,
      has_drivers_license: input.candidate.has_drivers_license ?? null,
    },
    vacancy: {
      id: input.vacancy.id,
      title: input.vacancy.title ?? null,
    },
    company: {
      id: input.company.id,
      name: input.company.name ?? null,
    },
    report: {
      summary: input.emailData.summary ?? null,
      function_group: input.emailData.functionGroup ?? null,
      classification: input.emailData.classification ?? null,
      reliability_score: input.emailData.reliabilityScore ?? null,
      skills: input.emailData.skills ?? [],
      certifications: input.emailData.certifications ?? [],
      languages: input.emailData.languages ?? [],
      positive_signals: input.emailData.positiveSignals ?? [],
      risk_factors: input.emailData.riskFactors ?? [],
      target_functions: input.emailData.targetFunctions ?? [],
      interview_questions: input.emailData.interviewQuestions ?? [],
      match_reasoning: input.match.match_reasoning ?? null,
      score: input.match.score ?? null,
      breakdown: input.match.match_breakdown ?? null,
    },
    sections: {
      summary: input.emailData.includeSummary !== false,
      profile: input.emailData.includeProfile !== false,
      skills: input.emailData.includeSkills !== false,
      certifications: input.emailData.includeCertifications !== false,
      languages: input.emailData.includeLanguages !== false,
      availability: input.emailData.includeAvailability !== false,
      positiveSignals: input.emailData.includePositiveSignals !== false,
      riskFactors: input.emailData.includeRiskFactors !== false,
      targetFunctions: input.emailData.includeTargetFunctions !== false,
      interviewQuestions: input.emailData.includeInterviewQuestions === true,
      matchReasoning: input.emailData.includeMatchReasoning !== false,
      reliability: input.emailData.includeReliability === true,
      hideReport: input.emailData.hideReport === true,
    },
  };
}

async function ensureProposalToken(
  serviceClient: ReturnType<typeof createAdminClient>,
  params: {
    orgId: string;
    matchId: string;
    contactEmail?: string | null;
    tokenId?: string | null;
  },
): Promise<{ id: string; token: string }> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const selectCols = "id, token, expires_at, used_at, response, contact_email";

  const updateContactEmail = async (id: string) => {
    if (!params.contactEmail) return;
    await serviceClient
      .from("match_proposal_tokens")
      .update({ contact_email: params.contactEmail })
      .eq("id", id)
      .eq("organization_id", params.orgId)
      .eq("match_id", params.matchId);
  };

  if (params.tokenId) {
    const { data: existing } = await serviceClient
      .from("match_proposal_tokens")
      .select(selectCols)
      .eq("id", params.tokenId)
      .eq("organization_id", params.orgId)
      .eq("match_id", params.matchId)
      .maybeSingle();

    if (
      existing &&
      !existing.used_at &&
      !existing.response &&
      new Date(existing.expires_at).getTime() > Date.now()
    ) {
      await updateContactEmail(existing.id);
      return { id: existing.id, token: existing.token };
    }
  }

  const { data: reusable } = await serviceClient
    .from("match_proposal_tokens")
    .select(selectCols)
    .eq("organization_id", params.orgId)
    .eq("match_id", params.matchId)
    .is("used_at", null)
    .is("response", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable) {
    await updateContactEmail(reusable.id);
    return { id: reusable.id, token: reusable.token };
  }

  const { data: created, error } = await serviceClient
    .from("match_proposal_tokens")
    .insert({
      match_id: params.matchId,
      organization_id: params.orgId,
      contact_email: params.contactEmail ?? null,
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();

  if (error || !created) throw new Error("Failed to create proposal token");
  return { id: created.id, token: created.token };
}

function buildProposalEmailHtml(data: {
  theme: BrandTheme;
  orgEmail: string | null;
  orgPhone: string | null;
  contactName: string;
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  introText: string;
  closingText: string;
  summary: string | null;
  functionGroup: string | null;
  classification: string | null;
  reliabilityScore: number | null;
  skills: string[] | null;
  certifications: string[] | null;
  languages: string[] | null;
  availableFrom: string | null;
  arrivalDate: string | null;
  availabilityNotes: string | null;
  hasDriversLicense: boolean | null;
  addressCity: string | null;
  positiveSignals: string[] | null;
  riskFactors: string[] | null;
  targetFunctions: string[] | null;
  interviewQuestions: string[] | null;
  matchReasoning: string | null;
  responseUrl: string;
  hideReport?: boolean;
  hideReliability?: boolean;
  includeSummary?: boolean;
  includeProfile?: boolean;
  includeSkills?: boolean;
  includeCertifications?: boolean;
  includeLanguages?: boolean;
  includeAvailability?: boolean;
  includePositiveSignals?: boolean;
  includeRiskFactors?: boolean;
  includeTargetFunctions?: boolean;
  includeInterviewQuestions?: boolean;
  includeMatchReasoning?: boolean;
  includeReliability?: boolean;
}): string {
  const { theme } = data;
  const includeReliability = data.includeReliability === true && data.reliabilityScore != null;
  const profileBadges = [
    data.includeProfile !== false && data.functionGroup ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:${theme.navyHex};font-size:12px;">${escapeHtml(data.functionGroup)}</span>` : "",
    data.includeProfile !== false && data.classification ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#f8fafc;color:#334155;font-size:12px;">${escapeHtml(data.classification)}</span>` : "",
    includeReliability ? `<span style="display:inline-block;margin:8px 6px 0 0;padding:4px 8px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:12px;">Betrouwbaarheid ${escapeHtml(formatReliabilityScore(data.reliabilityScore) ?? "")}</span>` : "",
  ].join("");
  const availabilityContent = renderFactList([
    data.availableFrom ? `Beschikbaar vanaf ${formatDateNl(data.availableFrom) ?? data.availableFrom}` : null,
    data.arrivalDate ? `Aankomst/check-in ${formatDateNl(data.arrivalDate) ?? data.arrivalDate}` : null,
    data.addressCity ? `Woonplaats/regio: ${data.addressCity}` : null,
    data.hasDriversLicense ? "Rijbewijs aanwezig" : null,
    data.availabilityNotes,
  ], "#334155");
  const reportRows = data.hideReport ? "" : [
    data.includeSummary !== false ? renderReportRow("Samenvatting", data.summary ? `<span style="color:${theme.navyHex};font-size:14px;line-height:1.5;">${renderText(data.summary)}</span>` : "") : "",
    renderReportRow("Profiel", profileBadges),
    data.includeSkills !== false ? renderReportRow("Vaardigheden", renderList(data.skills, theme.navyHex)) : "",
    data.includeCertifications !== false ? renderReportRow("Certificaten", renderList(data.certifications, theme.navyHex)) : "",
    data.includeLanguages !== false ? renderReportRow("Talen", renderList(data.languages, "#334155")) : "",
    data.includeAvailability !== false ? renderReportRow("Beschikbaarheid", availabilityContent) : "",
    data.includePositiveSignals !== false ? renderReportRow("Sterke signalen", renderList(data.positiveSignals, "#064e3b")) : "",
    data.includeRiskFactors !== false ? renderReportRow("Aandachtspunten", renderList(data.riskFactors, "#92400e")) : "",
    data.includeTargetFunctions !== false ? renderReportRow("Passende functies", renderList(data.targetFunctions, theme.navyHex)) : "",
    data.includeInterviewQuestions === true ? renderReportRow("Vragen voor vervolggesprek", renderList(data.interviewQuestions, "#334155")) : "",
    data.includeMatchReasoning !== false ? renderReportRow("Matchnotitie", data.matchReasoning ? `<span style="color:#475569;font-size:13px;line-height:1.5;">${renderText(data.matchReasoning)}</span>` : "") : "",
  ].join("");
  const hasReport = reportRows.trim().length > 0;
  const contactLine = [data.orgEmail, data.orgPhone]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ");

  const content = `<h2 style="margin:0 0 8px;color:${theme.navyHex};font-size:18px;">Kandidaatvoorstel</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Wij hebben een geschikte kandidaat gevonden voor ${escapeHtml(data.companyName)}: ${escapeHtml(data.vacancyTitle)}</p>

          <p style="margin:0 0 24px;color:${theme.textHex};font-size:14px;line-height:1.6;">${renderText(data.introText)}</p>

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

          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;line-height:1.6;">${renderText(data.closingText)}</p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:6px;background:${theme.accentHex};">
            <a href="${escapeHtml(data.responseUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">Bekijk CV en reageer op dit voorstel</a>
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
      proposal_token_id,
      intro_text,
      closing_text,
      hide_ai_report,
      hide_reliability,
      include_sections,
    } = body;

    if (!match_id) {
      return json({ error: "match_id is required" }, 400);
    }

    const { data: match, error: mErr } = await serviceClient
      .from("matches")
      .select(`
        *,
        candidates:candidate_id(id, first_name, last_name, email, phone, cv_file_url, skills, certifications, languages, available_from, arrival_date, availability_notes, has_drivers_license, address_city, ai_summary, ai_function_group, ai_classification, ai_reliability_score, ai_positive_signals, ai_risk_factors, ai_target_functions, ai_interview_questions),
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
    const defaultIntroText = `Beste ${defaultName},\n\nGraag stellen wij ${candidateName} aan u voor voor de functie ${vacancy.title}. Hieronder vindt u de belangrijkste gegevens en onze toelichting.`;
    const defaultClosingText = "Via onderstaande knop kunt u aangeven of u de kandidaat direct wilt laten starten, eerst op gesprek wilt uitnodigen of wilt afwijzen.";
    const introText = cleanEditableText(intro_text, defaultIntroText);
    const closingText = cleanEditableText(closing_text, defaultClosingText);

    // Standaard verbergen we de betrouwbaarheidsscore richting klant; het volledige rapport blijft tenzij uitgezet.
    const hideReliability = hide_reliability !== false;
    const hideReport = hide_ai_report === true;
    const rawSections = include_sections && typeof include_sections === "object" ? include_sections as Record<string, unknown> : {};
    const sectionEnabled = (key: string, defaultValue = true) =>
      Object.prototype.hasOwnProperty.call(rawSections, key) ? rawSections[key] !== false : defaultValue;

    const emailData = {
      theme: brandTheme,
      orgEmail: org?.email ?? null,
      orgPhone: org?.phone ?? null,
      contactName: defaultName,
      candidateName,
      vacancyTitle: vacancy.title,
      companyName: company.name,
      introText,
      closingText,
      summary: candidate.ai_summary ?? match.match_reasoning ?? null,
      functionGroup: candidate.ai_function_group ?? null,
      classification: candidate.ai_classification ?? null,
      reliabilityScore: candidate.ai_reliability_score ?? null,
      skills: candidate.skills ?? null,
      certifications: candidate.certifications ?? null,
      languages: candidate.languages ?? null,
      availableFrom: candidate.available_from ?? null,
      arrivalDate: candidate.arrival_date ?? null,
      availabilityNotes: candidate.availability_notes ?? null,
      hasDriversLicense: candidate.has_drivers_license ?? null,
      addressCity: candidate.address_city ?? null,
      positiveSignals: candidate.ai_positive_signals ?? null,
      riskFactors: candidate.ai_risk_factors ?? null,
      targetFunctions: candidate.ai_target_functions ?? null,
      interviewQuestions: candidate.ai_interview_questions ?? null,
      matchReasoning: match.match_reasoning ?? null,
      hideReport,
      hideReliability,
      includeSummary: !hideReport && sectionEnabled("summary"),
      includeProfile: !hideReport && sectionEnabled("profile"),
      includeSkills: !hideReport && sectionEnabled("skills"),
      includeCertifications: !hideReport && sectionEnabled("certifications"),
      includeLanguages: !hideReport && sectionEnabled("languages"),
      includeAvailability: !hideReport && sectionEnabled("availability"),
      includePositiveSignals: !hideReport && sectionEnabled("positiveSignals"),
      includeRiskFactors: !hideReport && sectionEnabled("riskFactors"),
      includeTargetFunctions: !hideReport && sectionEnabled("targetFunctions"),
      includeInterviewQuestions: !hideReport && sectionEnabled("interviewQuestions", false),
      includeMatchReasoning: !hideReport && sectionEnabled("matchReasoning"),
      includeReliability: !hideReport && sectionEnabled("reliability", !hideReliability),
    };

    const requestedTokenId = typeof proposal_token_id === "string" ? proposal_token_id : null;
    const previewRecipient = (typeof recipient_email === "string" && recipient_email.trim())
      ? recipient_email.trim()
      : defaultEmail;
    const previewToken = await ensureProposalToken(serviceClient, {
      orgId,
      matchId: match.id,
      contactEmail: previewRecipient ?? null,
      tokenId: requestedTokenId,
    });
    const previewResponseUrl = await buildOrganizationPublicUrl(serviceClient, orgId, `/match-response/${previewToken.token}`);

    if (preview) {
      const html = buildProposalEmailHtml({ ...emailData, responseUrl: previewResponseUrl });
      const contentSnapshot = buildContentSnapshot({
        match,
        candidate,
        vacancy,
        company,
        subject,
        introText,
        closingText,
        emailData,
        responseUrl: previewResponseUrl,
      });
      return json({
        preview: true,
        to: defaultEmail,
        contact_name: defaultName,
        subject,
        intro_text: introText,
        closing_text: closingText,
        html,
        proposal_token_id: previewToken.id,
        response_url: previewResponseUrl,
        content_snapshot: contentSnapshot,
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

    const token = await ensureProposalToken(serviceClient, {
      orgId,
      matchId: match.id,
      contactEmail: finalRecipient,
      tokenId: requestedTokenId,
    }).catch(() => null);

    if (!token) {
      return json({ error: "Failed to create proposal token" }, 500);
    }

    const responseUrl = await buildOrganizationPublicUrl(serviceClient, orgId, `/match-response/${token.token}`);
    const html = (typeof htmlOverride === "string" && htmlOverride.trim())
      ? sanitizeEmailHtml(htmlOverride).replaceAll("{{RESPONSE_URL}}", responseUrl)
      : buildProposalEmailHtml({ ...emailData, responseUrl });
    const contentSnapshot = buildContentSnapshot({
      match,
      candidate,
      vacancy,
      company,
      subject,
      introText,
      closingText,
      emailData,
      responseUrl,
    });

    await serviceClient
      .from("match_proposal_tokens")
      .update({ content_snapshot: contentSnapshot })
      .eq("id", token.id)
      .eq("organization_id", orgId)
      .eq("match_id", match.id);

    const outlookResult = await sendViaOutlookAccount({
      orgId,
      to: finalRecipient,
      cc: Array.isArray(cc) ? cc : undefined,
      bcc: Array.isArray(bcc) ? bcc : undefined,
      subject,
      htmlBody: html,
      accountId: account_id ?? undefined,
      sentBy: userId,
      candidateId: candidate.id,
      companyId: company.id,
      companyContactId: finalContactId ?? undefined,
      matchId: match.id,
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
