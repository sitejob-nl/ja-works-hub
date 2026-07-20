import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { sendOutboundWhatsApp } from "../_shared/whatsapp-utils.ts";
import { getWhatsAppAutomationSettings, mergeTemplate as mergeWhatsAppTemplate } from "../_shared/whatsapp-automation-settings.ts";
import { buildTemplatePayload, fetchApprovedTemplate, isWithinServiceWindow } from "../_shared/whatsapp-template.ts";
import { type BrandTheme, loadBrandTheme, renderBrandedEmail } from "../_shared/email-layout.ts";
import {
  escapeHtml,
  generalTermsSection,
  mergeTemplateText,
  templateToEmailContent,
} from "../_shared/placement-mail.ts";

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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatAmount(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount);
}

function formatWorkDays(days: string[] | null): string {
  if (!days || days.length === 0) return "Nader te bepalen";
  return days.join(", ");
}

function extractTemplateVariables(content: string): string[] {
  const matches = Array.from(content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), (match) => match[1]);
  return Array.from(new Set(matches));
}

function unknownTemplateVariables(content: string, vars: Record<string, unknown>): string[] {
  return extractTemplateVariables(content).filter((key) => !(key in vars));
}

/**
 * Verstuurt een plaatsingsbevestiging via WhatsApp, bewust van de Meta 24u-regel.
 *
 * Binnen het servicevenster (ontvanger appte < 24u geleden) mag vrije tekst; daarbuiten
 * bezorgt Meta alleen goedgekeurde templates. Een plaatsingsbevestiging is proactief, dus
 * dat laatste is het normale geval. Zonder ingestelde template sturen we buiten het venster
 * bewust NIETS — dat is beter dan een bericht dat Meta stil weigert (fout 131047).
 */
async function sendPlacementWhatsApp(service: any, input: {
  orgId: string;
  to: string;
  text: string;
  subject: string;
  templateName: string;
  templateVarOrder: string[];
  vars: Record<string, unknown>;
  candidateId?: string | null;
  companyId?: string | null;
  companyContactId?: string | null;
  placementId?: string | null;
  sentBy?: string | null;
}) {
  const shared = {
    orgId: input.orgId,
    to: input.to,
    subject: input.subject,
    candidateId: input.candidateId ?? null,
    companyId: input.companyId ?? null,
    companyContactId: input.companyContactId ?? null,
    placementId: input.placementId ?? null,
    sentBy: input.sentBy ?? null,
  };

  const inWindow = await isWithinServiceWindow(service, {
    orgId: input.orgId,
    candidateId: input.candidateId ?? null,
    companyContactId: input.companyContactId ?? null,
  });

  if (inWindow) {
    const result = await sendOutboundWhatsApp(service, { ...shared, type: "text", text: { body: input.text } });
    return { ok: result.success, error: result.error, message_id: result.messageId ?? null, route: "tekst" };
  }

  const template = await fetchApprovedTemplate(service, input.orgId, input.templateName);
  if (!template) {
    return {
      ok: false,
      route: "geblokkeerd",
      message_id: null,
      error: input.templateName
        ? `De ingestelde WhatsApp-template "${input.templateName}" is niet gevonden of niet goedgekeurd door Meta. Buiten het 24-uursvenster is er niets verstuurd.`
        : "Buiten het 24-uursvenster mag WhatsApp alleen een goedgekeurde template versturen. Stel die in bij Instellingen → WhatsApp-automatisering; er is nu niets verstuurd.",
    };
  }

  const values = input.templateVarOrder.map((key) => input.vars[key]);
  const result = await sendOutboundWhatsApp(service, {
    ...shared,
    type: "template",
    template: buildTemplatePayload(template, values),
  });
  return { ok: result.success, error: result.error, message_id: result.messageId ?? null, route: "template" };
}

function buildClientEmailContent(data: {
  companyName: string;
  contactName: string;
  candidateName: string;
  functionName: string;
  startDate: string;
  workLocation: string | null;
  workDays: string[] | null;
  candidatePhone: string | null;
  candidateEmail: string | null;
  orgName: string;
}, theme: BrandTheme): string {
  return `<h2 style="margin:0 0 8px;color:${theme.navyHex};font-size:18px;">Plaatsingsbevestiging</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Bevestiging van de nieuwe plaatsing bij ${escapeHtml(data.companyName)}</p>

          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">Beste ${escapeHtml(data.contactName)},</p>
          <p style="margin:0 0 24px;color:${theme.textHex};font-size:14px;">
            Hierbij bevestigen wij de plaatsing van een nieuwe medewerker bij uw bedrijf. Hieronder vindt u de details.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Medewerker</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(data.candidateName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Functie</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(data.functionName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Startdatum</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(formatDate(data.startDate))}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Werklocatie</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(data.workLocation ?? "Nader te bepalen")}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Werkdagen</span><br>
              <strong style="color:${theme.navyHex};font-size:15px;">${escapeHtml(formatWorkDays(data.workDays))}</strong>
            </td></tr>
          </table>

          ${data.candidatePhone || data.candidateEmail ? `
          <p style="margin:0 0 8px;color:${theme.textHex};font-size:14px;font-weight:600;">Contactgegevens medewerker:</p>
          <p style="margin:0 0 24px;color:${theme.textHex};font-size:14px;">
            ${data.candidatePhone ? `Telefoon: ${escapeHtml(data.candidatePhone)}<br>` : ""}
            ${data.candidateEmail ? `E-mail: ${escapeHtml(data.candidateEmail)}` : ""}
          </p>` : ""}

          <p style="margin:0 0 8px;color:${theme.textHex};font-size:14px;">
            Mocht u vragen hebben, neem dan gerust contact met ons op.
          </p>
          <p style="margin:24px 0 0;color:${theme.textHex};font-size:14px;">Met vriendelijke groet,<br><strong>${escapeHtml(data.orgName)}</strong></p>`;
}

function buildEmployeeEmailContent(data: {
  candidateName: string;
  functionName: string;
  companyName: string;
  startDate: string;
  workLocation: string | null;
  workDays: string[] | null;
  contactPersonName: string | null;
  contactPersonPhone: string | null;
  contactPersonEmail: string | null;
  orgName: string;
}, theme: BrandTheme): string {
  return `<h2 style="margin:0 0 8px;color:${theme.navyHex};font-size:18px;">Gefeliciteerd met je nieuwe plaatsing!</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Je bent geplaatst als ${escapeHtml(data.functionName)} bij ${escapeHtml(data.companyName)}</p>

          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">Beste ${escapeHtml(data.candidateName)},</p>
          <p style="margin:0 0 24px;color:${theme.textHex};font-size:14px;">
            Goed nieuws! Je plaatsing is bevestigd. Hieronder vind je alle belangrijke details.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:6px;border:1px solid #bbf7d0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #bbf7d0;">
              <span style="color:#15803d;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Functie</span><br>
              <strong style="color:#14532d;font-size:15px;">${escapeHtml(data.functionName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #bbf7d0;">
              <span style="color:#15803d;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Bedrijf</span><br>
              <strong style="color:#14532d;font-size:15px;">${escapeHtml(data.companyName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #bbf7d0;">
              <span style="color:#15803d;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Startdatum</span><br>
              <strong style="color:#14532d;font-size:15px;">${escapeHtml(formatDate(data.startDate))}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #bbf7d0;">
              <span style="color:#15803d;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Werklocatie</span><br>
              <strong style="color:#14532d;font-size:15px;">${escapeHtml(data.workLocation ?? "Nader te bepalen")}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <span style="color:#15803d;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Werkdagen</span><br>
              <strong style="color:#14532d;font-size:15px;">${escapeHtml(formatWorkDays(data.workDays))}</strong>
            </td></tr>
          </table>

          ${data.contactPersonName ? `
          <p style="margin:0 0 8px;color:${theme.textHex};font-size:14px;font-weight:600;">Jouw contactpersoon bij ${escapeHtml(data.companyName)}:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <strong style="color:${theme.navyHex};font-size:14px;">${escapeHtml(data.contactPersonName)}</strong><br>
              ${data.contactPersonPhone ? `<span style="color:#64748b;font-size:13px;">Tel: ${escapeHtml(data.contactPersonPhone)}</span><br>` : ""}
              ${data.contactPersonEmail ? `<span style="color:#64748b;font-size:13px;">E-mail: ${escapeHtml(data.contactPersonEmail)}</span>` : ""}
            </td></tr>
          </table>` : ""}

          <p style="margin:0 0 8px;color:${theme.textHex};font-size:14px;">
            Heb je vragen? Neem gerust contact met ons op. Wij wensen je veel succes!
          </p>
          <p style="margin:24px 0 0;color:${theme.textHex};font-size:14px;">Met vriendelijke groet,<br><strong>${escapeHtml(data.orgName)}</strong></p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization")!;
    const auth = await requireRolePermission(req, "placements.edit", corsHeaders);
    if (auth instanceof Response) return auth;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const userId = auth.userId;
    const orgId = auth.organizationId;

    // Service client for inserting communications
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Parse input ──
    // Twee modi: (a) placement_id — bestaande plaatsing (verzenden of preview),
    // (b) preview + placement_data — mails renderen vóórdat de plaatsing bestaat
    // (plaatsingswizard, stap Controle). Preview verstuurt niets en logt niets.
    const body = await req.json();
    const { placement_id, send_to_client, send_to_employee, placement_data } = body;
    const preview = body.preview === true;

    // Bewerkte mail vanuit de wizard. De gebruiker bewerkt platte tékst, geen HTML —
    // de merk-frame en de gegevenstabel blijven zo altijd intact en er kan geen
    // ruwe HTML uit de UI de mail in lekken.
    const overrides = {
      accountId: typeof body.account_id === "string" ? body.account_id : null,
      client: {
        subject: typeof body.client_subject === "string" ? body.client_subject.trim() : null,
        bodyText: typeof body.client_body === "string" ? body.client_body : null,
        cc: Array.isArray(body.client_cc) ? body.client_cc.filter((e: unknown) => typeof e === "string") : [],
        bcc: Array.isArray(body.client_bcc) ? body.client_bcc.filter((e: unknown) => typeof e === "string") : [],
        to: typeof body.client_to === "string" && body.client_to.trim() ? body.client_to.trim() : null,
      },
      employee: {
        subject: typeof body.employee_subject === "string" ? body.employee_subject.trim() : null,
        bodyText: typeof body.employee_body === "string" ? body.employee_body : null,
        cc: Array.isArray(body.employee_cc) ? body.employee_cc.filter((e: unknown) => typeof e === "string") : [],
        bcc: Array.isArray(body.employee_bcc) ? body.employee_bcc.filter((e: unknown) => typeof e === "string") : [],
      },
    };

    if (!placement_id && !(preview && placement_data)) {
      return json({ error: "placement_id is required" }, 400);
    }

    if (!send_to_client && !send_to_employee) {
      return json({ error: "At least one recipient required" }, 400);
    }

    let placement: any;
    if (placement_id) {
      // ── Fetch placement with relations ──
      const { data, error: plErr } = await supabase
        .from("placements")
        .select(`
          *,
          companies:company_id(id, name, email, phone, address_city),
          candidate:candidate_id(id, first_name, last_name, email, phone, employee_number),
          employees:employee_id(
            id,
            candidate_id,
            candidates:candidate_id(id, first_name, last_name, email, phone, employee_number)
          ),
          vacancies:vacancy_id(id, title, location)
        `)
        .eq("id", placement_id)
        .single();

      if (plErr || !data) {
        return json({ error: "Placement not found" }, 404);
      }
      placement = data;
    } else {
      // Preview zonder bestaande plaatsing: relaties los ophalen (RLS via user-client).
      if (!placement_data.candidate_id || !placement_data.company_id) {
        return json({ error: "placement_data requires candidate_id and company_id" }, 400);
      }
      const [{ data: companyRow }, { data: candidateRow }, vacancyRes] = await Promise.all([
        supabase.from("companies").select("id, name, email, phone, address_city")
          .eq("id", placement_data.company_id).maybeSingle(),
        supabase.from("candidates").select("id, first_name, last_name, email, phone, employee_number")
          .eq("id", placement_data.candidate_id).maybeSingle(),
        placement_data.vacancy_id
          ? supabase.from("vacancies").select("id, title, location").eq("id", placement_data.vacancy_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!companyRow) return json({ error: "Company not found" }, 404);
      if (!candidateRow) return json({ error: "Candidate not found" }, 404);
      placement = {
        ...placement_data,
        id: null,
        companies: companyRow,
        candidate: candidateRow,
        employees: null,
        vacancies: (vacancyRes as any)?.data ?? null,
      };
    }

    const company = (placement as any).companies;
    const employee = (placement as any).employees;
    const candidate = (placement as any).candidate ?? employee?.candidates;
    const vacancy = (placement as any).vacancies;

    if (!candidate) {
      return json({ error: "Candidate not found for this placement" }, 404);
    }

    // ── Validate: candidate must have email and phone ──
    const warnings: string[] = [];
    if (!candidate.email) warnings.push("Kandidaat heeft geen e-mailadres");
    if (!candidate.phone) warnings.push("Kandidaat heeft geen telefoonnummer");

    if (send_to_employee && !candidate.email && !preview) {
      return json({ error: "Kandidaat heeft geen e-mailadres", warnings }, 400);
    }

    const candidateName = `${candidate.first_name} ${candidate.last_name}`.trim();
    const companyName = company?.name ?? "Onbekend bedrijf";
    const functionName = placement.function_name;
    const startDate = placement.start_date;
    const workLocation = placement.work_location ?? vacancy?.location ?? null;
    const workDays = placement.work_days ?? null;

    const results: {
      client_email?: { subject: string; html: string; body_text: string; to: string; sent_via?: string };
      employee_email?: { subject: string; html: string; body_text: string; to: string; sent_via?: string };
      warnings: string[];
    } = { warnings };

    const activeTemplateQuery = (type: string) => supabase
      .from("contract_templates")
      .select("name, content")
      .eq("organization_id", orgId)
      .eq("template_type", type)
      .eq("is_active", true)
      .eq("template_status", "actief")
      .eq("is_placeholder", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: generalTerms } = await activeTemplateQuery("general_terms");
    const { data: clientTemplate } = await activeTemplateQuery("placement_confirmation_client");
    const { data: employeeTemplate } = await activeTemplateQuery("placement_confirmation_employee");
    const automation = await getWhatsAppAutomationSettings(serviceClient, orgId);
    // Merk-thema (logo + accentkleur) voor de huisstijl-mailframe — org-specifiek, default JA! Werkt.
    const brandTheme = await loadBrandTheme(serviceClient, orgId);
    const footerNote = "Dit is een automatisch gegenereerd bericht.";

    const missingTemplates: string[] = [];
    if (send_to_client && !clientTemplate) missingTemplates.push("plaatsingsbevestiging opdrachtgever");
    if (send_to_employee && !employeeTemplate) missingTemplates.push("plaatsingsbevestiging medewerker");
    if (send_to_client && !generalTerms) missingTemplates.push("algemene voorwaarden");
    if (missingTemplates.length > 0) {
      return json({
        error: `Actieve juridische template(s) ontbreken: ${missingTemplates.join(", ")}`,
        warnings,
      }, 400);
    }

    const templateVars = {
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      employee_name: candidateName,
      employee_number: candidate.employee_number,
      start_date: formatDate(startDate),
      end_date: formatDate(placement.end_date),
      expected_end_date: formatDate(placement.expected_end_date),
      function_name: functionName,
      // Bij een plaatsing vanuit een match is function_name voorgevuld met de
      // vacaturetitel. Dan zou een aparte "Vacature"-regel exact hetzelfde zeggen als
      // "Functie"; leeg laten, dan valt de regel vanzelf weg in de opmaak.
      vacancy_title: vacancy?.title && vacancy.title !== functionName ? vacancy.title : "",
      hourly_rate: formatAmount(placement.hourly_rate),
      client_hourly_rate: formatAmount(placement.client_hourly_rate),
      overtime_rate: formatAmount(placement.overtime_rate),
      contract_hours: placement.cao_hours?.toString() ?? "",
      contract_type: "",
      company_name: companyName,
      company_phone: company?.phone,
      company_email: company?.email,
      organization_name: brandTheme.orgName,
      work_location: workLocation ?? "Nader te bepalen",
      work_days: formatWorkDays(workDays),
      candidate_phone: candidate.phone,
      candidate_email: candidate.email,
      today: formatDate(new Date().toISOString()),
    };

    // ── Fetch company contacts once for both emails ──
    const { data: contacts } = await supabase
      .from("company_contacts")
      .select("*")
      .eq("company_id", company.id)
      .order("is_primary", { ascending: false })
      .limit(5);

    const primaryContact = contacts?.find((c: any) => c.is_primary) ?? contacts?.[0] ?? null;
    const whatsappResults: any = {};
    const clientTemplateVars = { ...templateVars, contact_name: primaryContact?.full_name ?? companyName };
    const employeeTemplateVars = {
      ...templateVars,
      contact_person_name: primaryContact?.full_name ?? "",
      contact_person_phone: primaryContact?.phone ?? "",
      contact_person_email: primaryContact?.email ?? "",
    };
    const templateErrors: string[] = [];
    if (clientTemplate) {
      const unknown = unknownTemplateVariables((clientTemplate as any).content, clientTemplateVars);
      if (unknown.length > 0) templateErrors.push(`plaatsingsbevestiging opdrachtgever: ${unknown.join(", ")}`);
    }
    if (employeeTemplate) {
      const unknown = unknownTemplateVariables((employeeTemplate as any).content, employeeTemplateVars);
      if (unknown.length > 0) templateErrors.push(`plaatsingsbevestiging medewerker: ${unknown.join(", ")}`);
    }
    if (generalTerms) {
      const unknown = unknownTemplateVariables((generalTerms as any).content, templateVars);
      if (unknown.length > 0) templateErrors.push(`algemene voorwaarden: ${unknown.join(", ")}`);
    }
    if (templateErrors.length > 0) {
      return json({
        error: `Actieve template bevat onbekende variabele(n): ${templateErrors.join("; ")}`,
        warnings,
      }, 400);
    }

    // ── Client email ──
    if (send_to_client) {
      const clientEmail = overrides.client.to ?? primaryContact?.email ?? company?.email;
      const contactName = primaryContact?.full_name ?? companyName;

      if (!clientEmail) {
        warnings.push("Geen e-mailadres gevonden voor opdrachtgever");
      }

      // Onderwerp noemt de kandidaat: de opdrachtgever ziet in zijn inbox meteen om wie het gaat.
      const subject = overrides.client.subject ||
        `Plaatsingsbevestiging — ${candidateName} als ${functionName} bij ${companyName}`;
      const clientBodyText = overrides.client.bodyText ??
        (clientTemplate ? mergeTemplateText((clientTemplate as any).content, { ...templateVars, contact_name: contactName }) : "");
      const clientContent = clientTemplate || overrides.client.bodyText
        ? templateToEmailContent(clientBodyText, "Plaatsingsbevestiging", `Bevestiging van de plaatsing van ${candidateName} bij ${companyName}`, brandTheme)
        : buildClientEmailContent({
        companyName,
        contactName,
        candidateName,
        functionName,
        startDate,
        workLocation,
        workDays,
        candidatePhone: candidate.phone,
        candidateEmail: candidate.email,
        orgName: brandTheme.orgName,
      }, brandTheme);
      const termsText = generalTerms ? mergeTemplateText((generalTerms as any).content, templateVars) : "";
      const html = renderBrandedEmail({
        theme: brandTheme,
        contentHtml: clientContent + generalTermsSection(termsText),
        preheader: `Plaatsingsbevestiging — ${candidateName} bij ${companyName}`,
        footerNote,
      });

      if (!generalTerms) {
        warnings.push("Geen actieve algemene voorwaarden-template gevonden");
      }

      // Send via Outlook if connected, otherwise store as concept (preview doet geen van beide)
      let sendResult: { success: boolean; method: "outlook" | "none" | "preview"; error?: string; communicationPaused?: boolean } = { success: false, method: preview ? "preview" : "none" };
      if (clientEmail && !preview) {
        sendResult = await sendViaOutlookAccount({
          orgId,
          to: clientEmail,
          cc: overrides.client.cc,
          bcc: overrides.client.bcc,
          accountId: overrides.accountId,
          subject,
          htmlBody: html,
          companyId: company.id,
          sentBy: userId,
          senderName: null,
        });
      }

      // Kill-switch heeft zelf al een concept gelogd — dan geen tweede fallback-insert.
      if (!sendResult.success && !sendResult.communicationPaused && !preview) {
        // Fallback: store as concept in communications
        await serviceClient.from("communications").insert({
          organization_id: orgId,
          channel: "email",
          direction: "outbound",
          subject,
          body: html,
          sent_by: userId,
          company_id: company.id,
          company_contact_id: primaryContact?.id ?? null,
        });
      }

      results.client_email = {
        subject,
        html,
        body_text: clientBodyText,
        to: clientEmail ?? "Geen e-mail beschikbaar",
        sent_via: sendResult.method,
      };
    }

    // ── Client WhatsApp confirmation ──
    if (!preview && send_to_client && automation.placement_client_whatsapp_enabled) {
      const clientPhone = primaryContact?.phone ?? company?.phone;
      if (clientPhone) {
        const clientVars = { ...templateVars, contact_name: primaryContact?.full_name ?? companyName };
        const text = mergeWhatsAppTemplate(automation.placement_client_message, clientVars as any);
        const wa = await sendPlacementWhatsApp(serviceClient, {
          orgId,
          to: clientPhone,
          text,
          subject: "WhatsApp plaatsingsbevestiging opdrachtgever",
          templateName: automation.placement_client_template_name,
          templateVarOrder: automation.placement_client_template_vars,
          vars: clientVars as any,
          candidateId: candidate.id,
          companyId: company.id,
          companyContactId: primaryContact?.id ?? null,
          placementId: placement.id,
          sentBy: userId,
        });
        whatsappResults.client_whatsapp = { to: clientPhone, success: wa.ok, error: wa.error, route: wa.route };
      } else {
        whatsappResults.client_whatsapp = { success: false, error: "Geen telefoonnummer gevonden voor opdrachtgever" };
      }
    }

    // ── Employee email ──
    if (send_to_employee) {
      const subject = overrides.employee.subject ||
        `Je plaatsing als ${functionName} bij ${companyName} is bevestigd`;
      const employeeBodyText = overrides.employee.bodyText ??
        (employeeTemplate ? mergeTemplateText((employeeTemplate as any).content, employeeTemplateVars) : "");
      const employeeContent = employeeTemplate || overrides.employee.bodyText
        ? templateToEmailContent(employeeBodyText, "Je plaatsing is bevestigd", `${functionName} bij ${companyName}`, brandTheme)
        : buildEmployeeEmailContent({
        candidateName,
        functionName,
        companyName,
        startDate,
        workLocation,
        workDays,
        contactPersonName: primaryContact?.full_name ?? null,
        contactPersonPhone: primaryContact?.phone ?? null,
        contactPersonEmail: primaryContact?.email ?? null,
        orgName: brandTheme.orgName,
      }, brandTheme);
      const html = renderBrandedEmail({
        theme: brandTheme,
        contentHtml: employeeContent,
        preheader: `Je plaatsing als ${functionName} bij ${companyName} is bevestigd`,
        footerNote,
      });

      // Send via Outlook if connected (preview verstuurt en logt niets)
      let empSendResult: { success: boolean; method: "outlook" | "none" | "preview"; error?: string; communicationPaused?: boolean } = { success: false, method: "preview" };
      if (!preview) {
        empSendResult = await sendViaOutlookAccount({
          orgId,
          to: candidate.email,
          cc: overrides.employee.cc,
          bcc: overrides.employee.bcc,
          accountId: overrides.accountId,
          subject,
          htmlBody: html,
          candidateId: candidate.id,
          sentBy: userId,
          senderName: null,
        });

        // Kill-switch heeft zelf al een concept gelogd — dan geen tweede fallback-insert.
        if (!empSendResult.success && !empSendResult.communicationPaused) {
          // Fallback: store as concept
          await serviceClient.from("communications").insert({
            organization_id: orgId,
            channel: "email",
            direction: "outbound",
            subject,
            body: html,
            sent_by: userId,
            candidate_id: candidate.id,
          });
        }
      }

      results.employee_email = {
        subject,
        html,
        body_text: employeeBodyText,
        to: candidate.email ?? "Geen e-mail beschikbaar",
        sent_via: empSendResult.method,
      };
    }

    // ── Employee WhatsApp confirmation ──
    if (!preview && send_to_employee && automation.placement_employee_whatsapp_enabled) {
      if (candidate.phone) {
        const text = mergeWhatsAppTemplate(automation.placement_employee_message, templateVars as any);
        const wa = await sendPlacementWhatsApp(serviceClient, {
          orgId,
          to: candidate.phone,
          text,
          subject: "WhatsApp plaatsingsbevestiging medewerker",
          templateName: automation.placement_employee_template_name,
          templateVarOrder: automation.placement_employee_template_vars,
          vars: templateVars as any,
          candidateId: candidate.id,
          companyId: company.id,
          placementId: placement.id,
          sentBy: userId,
        });
        whatsappResults.employee_whatsapp = { to: candidate.phone, success: wa.ok, error: wa.error, route: wa.route };
      } else {
        whatsappResults.employee_whatsapp = { success: false, error: "Kandidaat heeft geen telefoonnummer" };
      }
    }

    return json({ success: true, preview, ...results, whatsapp: whatsappResults });
  } catch (err) {
    console.error("send-placement-confirmation error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
