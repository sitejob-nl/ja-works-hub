import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { sendOutboundWhatsApp } from "../_shared/whatsapp-utils.ts";
import { getWhatsAppAutomationSettings, mergeTemplate as mergeWhatsAppTemplate } from "../_shared/whatsapp-automation-settings.ts";
import { type BrandTheme, loadBrandTheme, renderBrandedEmail } from "../_shared/email-layout.ts";

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
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

function formatWorkDays(days: string[] | null): string {
  if (!days || days.length === 0) return "Nader te bepalen";
  return days.join(", ");
}

function generalTermsSection(terms: { name: string; content: string } | null): string {
  if (!terms?.content) return "";
  return `
          <div style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;padding:14px 20px;margin:24px 0;">
            <p style="margin:0 0 8px;color:#334155;font-size:14px;font-weight:600;">${escapeHtml(terms.name || "Algemene voorwaarden")}</p>
            <p style="margin:0;color:#334155;font-size:12px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(terms.content)}</p>
          </div>`;
}

function mergeTemplate(content: string, vars: Record<string, string | null | undefined>): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, escapeHtml(String(value ?? ""))),
    content,
  );
}

async function sendWhatsAppDirect(service: any, input: {
  orgId: string;
  to: string;
  text: string;
  subject: string;
  candidateId?: string | null;
  companyId?: string | null;
  companyContactId?: string | null;
  placementId?: string | null;
  sentBy?: string | null;
}) {
  const result = await sendOutboundWhatsApp(service, {
    orgId: input.orgId,
    to: input.to,
    type: "text",
    text: { body: input.text },
    subject: input.subject,
    candidateId: input.candidateId ?? null,
    companyId: input.companyId ?? null,
    companyContactId: input.companyContactId ?? null,
    placementId: input.placementId ?? null,
    sentBy: input.sentBy ?? null,
  });
  return { ok: result.success, error: result.error, message_id: result.messageId ?? null };
}

// Inhoud van een vrije org-template (contract_templates) — body als pre-wrap, in de merk-frame.
function templateToEmailContent(template: { name: string; content: string }, vars: Record<string, string | null | undefined>, theme: BrandTheme): string {
  const body = mergeTemplate(template.content, vars);
  return `<h2 style="margin:0 0 16px;color:${theme.navyHex};font-size:18px;">${escapeHtml(template.name)}</h2>
          <div style="color:${theme.textHex};font-size:14px;line-height:1.6;white-space:pre-wrap;">${body}</div>`;
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
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userId = user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();

    if (!profile) {
      return json({ error: "Profile not found" }, 404);
    }

    const orgId = profile.organization_id;

    // Service client for inserting communications
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Parse input ──
    const body = await req.json();
    const { placement_id, send_to_client, send_to_employee } = body;

    if (!placement_id) {
      return json({ error: "placement_id is required" }, 400);
    }

    if (!send_to_client && !send_to_employee) {
      return json({ error: "At least one recipient required" }, 400);
    }

    // ── Fetch placement with relations ──
    const { data: placement, error: plErr } = await supabase
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
        vacancies:vacancy_id(id, title, work_location)
      `)
      .eq("id", placement_id)
      .single();

    if (plErr || !placement) {
      return json({ error: "Placement not found" }, 404);
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

    if (send_to_employee && !candidate.email) {
      return json({ error: "Kandidaat heeft geen e-mailadres", warnings }, 400);
    }

    const candidateName = `${candidate.first_name} ${candidate.last_name}`.trim();
    const companyName = company?.name ?? "Onbekend bedrijf";
    const functionName = placement.function_name;
    const startDate = placement.start_date;
    const workLocation = vacancy?.work_location ?? placement.work_location ?? null;
    const workDays = placement.work_days ?? null;

    const results: {
      client_email?: { subject: string; html: string; to: string; sent_via?: string };
      employee_email?: { subject: string; html: string; to: string; sent_via?: string };
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
      employee_name: candidateName,
      employee_number: candidate.employee_number,
      start_date: formatDate(startDate),
      function_name: functionName,
      company_name: companyName,
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

    // ── Client email ──
    if (send_to_client) {
      const clientEmail = primaryContact?.email ?? company?.email;
      const contactName = primaryContact?.full_name ?? companyName;

      if (!clientEmail) {
        warnings.push("Geen e-mailadres gevonden voor opdrachtgever");
      }

      const subject = `Plaatsingsbevestiging - ${functionName} bij ${companyName}`;
      const clientContent = clientTemplate
        ? templateToEmailContent(clientTemplate as any, { ...templateVars, contact_name: contactName }, brandTheme)
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
      const html = renderBrandedEmail({
        theme: brandTheme,
        contentHtml: clientContent + generalTermsSection(generalTerms as any),
        preheader: `Plaatsingsbevestiging — ${candidateName} bij ${companyName}`,
        footerNote,
      });

      if (!generalTerms) {
        warnings.push("Geen actieve algemene voorwaarden-template gevonden");
      }

      // Send via Outlook if connected, otherwise store as concept
      let sendResult: { success: boolean; method: "outlook" | "none"; error?: string } = { success: false, method: "none" };
      if (clientEmail) {
        sendResult = await sendViaOutlookAccount({
          orgId,
          to: clientEmail,
          subject,
          htmlBody: html,
          companyId: company.id,
          sentBy: userId,
          senderName: null,
        });
      }

      if (!sendResult.success) {
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
        to: clientEmail ?? "Geen e-mail beschikbaar",
        sent_via: sendResult.method,
      };
    }

    // ── Client WhatsApp confirmation ──
    if (send_to_client && automation.placement_client_whatsapp_enabled) {
      const clientPhone = primaryContact?.phone ?? company?.phone;
      if (clientPhone) {
        const text = mergeWhatsAppTemplate(automation.placement_client_message, {
          ...templateVars,
          contact_name: primaryContact?.full_name ?? companyName,
        } as any);
        const wa = await sendWhatsAppDirect(serviceClient, {
          orgId,
          to: clientPhone,
          text,
          subject: "WhatsApp plaatsingsbevestiging opdrachtgever",
          candidateId: candidate.id,
          companyId: company.id,
          companyContactId: primaryContact?.id ?? null,
          placementId: placement.id,
          sentBy: userId,
        });
        whatsappResults.client_whatsapp = { to: clientPhone, success: wa.ok, error: wa.error };
      } else {
        whatsappResults.client_whatsapp = { success: false, error: "Geen telefoonnummer gevonden voor opdrachtgever" };
      }
    }

    // ── Employee email ──
    if (send_to_employee) {
      const subject = `Plaatsingsbevestiging - ${functionName} bij ${companyName}`;
      const employeeContent = employeeTemplate
        ? templateToEmailContent(employeeTemplate as any, {
          ...templateVars,
          contact_person_name: primaryContact?.full_name ?? "",
          contact_person_phone: primaryContact?.phone ?? "",
          contact_person_email: primaryContact?.email ?? "",
        }, brandTheme)
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

      // Send via Outlook if connected
      const empSendResult = await sendViaOutlookAccount({
        orgId,
        to: candidate.email,
        subject,
        htmlBody: html,
        candidateId: candidate.id,
        sentBy: userId,
        senderName: null,
      });

      if (!empSendResult.success) {
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

      results.employee_email = {
        subject,
        html,
        to: candidate.email,
        sent_via: empSendResult.method,
      };
    }

    // ── Employee WhatsApp confirmation ──
    if (send_to_employee && automation.placement_employee_whatsapp_enabled) {
      if (candidate.phone) {
        const text = mergeWhatsAppTemplate(automation.placement_employee_message, templateVars as any);
        const wa = await sendWhatsAppDirect(serviceClient, {
          orgId,
          to: candidate.phone,
          text,
          subject: "WhatsApp plaatsingsbevestiging medewerker",
          candidateId: candidate.id,
          companyId: company.id,
          placementId: placement.id,
          sentBy: userId,
        });
        whatsappResults.employee_whatsapp = { to: candidate.phone, success: wa.ok, error: wa.error };
      } else {
        whatsappResults.employee_whatsapp = { success: false, error: "Kandidaat heeft geen telefoonnummer" };
      }
    }

    return json({ success: true, ...results, whatsapp: whatsappResults });
  } catch (err) {
    console.error("send-placement-confirmation error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
