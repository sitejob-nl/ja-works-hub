import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";

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

function appendGeneralTerms(html: string, terms: { name: string; content: string } | null): string {
  if (!terms?.content) return html;
  const section = `
          <div style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;padding:14px 20px;margin:24px 0;">
            <p style="margin:0 0 8px;color:#334155;font-size:14px;font-weight:600;">${escapeHtml(terms.name || "Algemene voorwaarden")}</p>
            <p style="margin:0;color:#334155;font-size:12px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(terms.content)}</p>
          </div>`;
  return html.replace("</td></tr>\n        <!-- Footer -->", `${section}\n        </td></tr>\n        <!-- Footer -->`);
}

function buildClientEmailHtml(data: {
  companyName: string;
  contactName: string;
  candidateName: string;
  functionName: string;
  startDate: string;
  workLocation: string | null;
  workDays: string[] | null;
  candidatePhone: string | null;
  candidateEmail: string | null;
}): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">SiteJob</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;color:#1e293b;font-size:18px;">Plaatsingsbevestiging</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Bevestiging van de nieuwe plaatsing bij ${escapeHtml(data.companyName)}</p>

          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Beste ${escapeHtml(data.contactName)},</p>
          <p style="margin:0 0 24px;color:#334155;font-size:14px;">
            Hierbij bevestigen wij de plaatsing van een nieuwe medewerker bij uw bedrijf. Hieronder vindt u de details.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Medewerker</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(data.candidateName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Functie</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(data.functionName)}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Startdatum</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(formatDate(data.startDate))}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Werklocatie</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(data.workLocation ?? "Nader te bepalen")}</strong>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Werkdagen</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(formatWorkDays(data.workDays))}</strong>
            </td></tr>
          </table>

          ${data.candidatePhone || data.candidateEmail ? `
          <p style="margin:0 0 8px;color:#334155;font-size:14px;font-weight:600;">Contactgegevens medewerker:</p>
          <p style="margin:0 0 24px;color:#334155;font-size:14px;">
            ${data.candidatePhone ? `Telefoon: ${escapeHtml(data.candidatePhone)}<br>` : ""}
            ${data.candidateEmail ? `E-mail: ${escapeHtml(data.candidateEmail)}` : ""}
          </p>` : ""}

          <p style="margin:0 0 8px;color:#334155;font-size:14px;">
            Mocht u vragen hebben, neem dan gerust contact met ons op.
          </p>
          <p style="margin:24px 0 0;color:#334155;font-size:14px;">Met vriendelijke groet,<br><strong>SiteJob</strong></p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Dit is een automatisch gegenereerd bericht van SiteJob.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmployeeEmailHtml(data: {
  candidateName: string;
  functionName: string;
  companyName: string;
  startDate: string;
  workLocation: string | null;
  workDays: string[] | null;
  contactPersonName: string | null;
  contactPersonPhone: string | null;
  contactPersonEmail: string | null;
}): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">SiteJob</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;color:#1e293b;font-size:18px;">Gefeliciteerd met je nieuwe plaatsing!</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Je bent geplaatst als ${escapeHtml(data.functionName)} bij ${escapeHtml(data.companyName)}</p>

          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Beste ${escapeHtml(data.candidateName)},</p>
          <p style="margin:0 0 24px;color:#334155;font-size:14px;">
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
          <p style="margin:0 0 8px;color:#334155;font-size:14px;font-weight:600;">Jouw contactpersoon bij ${escapeHtml(data.companyName)}:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(data.contactPersonName)}</strong><br>
              ${data.contactPersonPhone ? `<span style="color:#64748b;font-size:13px;">Tel: ${escapeHtml(data.contactPersonPhone)}</span><br>` : ""}
              ${data.contactPersonEmail ? `<span style="color:#64748b;font-size:13px;">E-mail: ${escapeHtml(data.contactPersonEmail)}</span>` : ""}
            </td></tr>
          </table>` : ""}

          <p style="margin:0 0 8px;color:#334155;font-size:14px;">
            Heb je vragen? Neem gerust contact met ons op. Wij wensen je veel succes!
          </p>
          <p style="margin:24px 0 0;color:#334155;font-size:14px;">Met vriendelijke groet,<br><strong>SiteJob</strong></p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Dit is een automatisch gegenereerd bericht van SiteJob.</p>
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
        employees:employee_id(
          id,
          candidate_id,
          candidates:candidate_id(id, first_name, last_name, email, phone)
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
    const candidate = employee?.candidates;
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

    const { data: generalTerms } = await supabase
      .from("contract_templates")
      .select("name, content")
      .eq("organization_id", orgId)
      .eq("template_type", "general_terms")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Fetch company contacts once for both emails ──
    const { data: contacts } = await supabase
      .from("company_contacts")
      .select("*")
      .eq("company_id", company.id)
      .order("is_primary", { ascending: false })
      .limit(5);

    const primaryContact = contacts?.find((c: any) => c.is_primary) ?? contacts?.[0] ?? null;

    // ── Client email ──
    if (send_to_client) {
      const clientEmail = primaryContact?.email ?? company?.email;
      const contactName = primaryContact?.full_name ?? companyName;

      if (!clientEmail) {
        warnings.push("Geen e-mailadres gevonden voor opdrachtgever");
      }

      const subject = `Plaatsingsbevestiging - ${functionName} bij ${companyName}`;
      const baseHtml = buildClientEmailHtml({
        companyName,
        contactName,
        candidateName,
        functionName,
        startDate,
        workLocation,
        workDays,
        candidatePhone: candidate.phone,
        candidateEmail: candidate.email,
      });
      const html = appendGeneralTerms(baseHtml, generalTerms as any);

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

    // ── Employee email ──
    if (send_to_employee) {
      const subject = `Plaatsingsbevestiging - ${functionName} bij ${companyName}`;
      const html = buildEmployeeEmailHtml({
        candidateName,
        functionName,
        companyName,
        startDate,
        workLocation,
        workDays,
        contactPersonName: primaryContact?.full_name ?? null,
        contactPersonPhone: primaryContact?.phone ?? null,
        contactPersonEmail: primaryContact?.email ?? null,
      });

      // Send via Outlook if connected
      const empSendResult = await sendViaOutlookAccount({
        orgId,
        to: candidate.email,
        subject,
        htmlBody: html,
        candidateId: candidate.id,
        sentBy: userId,
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

    return json({ success: true, ...results });
  } catch (err) {
    console.error("send-placement-confirmation error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
