import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOutlook } from "./outlook-send.ts";
import { getWhatsAppCredentials, normalizePhone, META_API_BASE } from "./whatsapp-utils.ts";

export interface SickReportCascadeResult {
  task_created: boolean;
  status_updated: boolean;
  email_sent: boolean;
  email_error?: string;
  whatsapp_sent: boolean;
  whatsapp_error?: string;
}

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

async function sendWhatsAppDirect(
  service: SupabaseClient,
  orgId: string,
  to: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const creds = await getWhatsAppCredentials(service, orgId);
  if (!creds) return { ok: false, error: "WhatsApp niet geconfigureerd" };

  const res = await fetch(`${META_API_BASE}/${creds.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to).replace("+", ""),
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Meta API ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Cascade behaviour when a ziekmelding is received, regardless of source
 * (portal form vs WhatsApp auto-detect). Runs with service role privileges.
 *
 * - Create recruiter_task voor intercedent ("Ziekmelding van {naam}")
 * - Update candidate.employee_status = 'ziek' (als was 'actief')
 * - Stuur email naar opdrachtgever contact (indien active placement)
 * - Stuur WhatsApp bevestiging naar de kandidaat
 */
export async function cascadeSickReport(
  service: SupabaseClient,
  sickReportId: string,
  triggeredBy: string | null
): Promise<SickReportCascadeResult> {
  const result: SickReportCascadeResult = {
    task_created: false,
    status_updated: false,
    email_sent: false,
    whatsapp_sent: false,
  };

  const { data: report, error: repErr } = await service
    .from("sick_reports")
    .select(`
      id, organization_id, candidate_id, placement_id, reported_at,
      expected_return_date, notes, client_notified
    `)
    .eq("id", sickReportId)
    .maybeSingle();

  if (repErr || !report) return result;
  const orgId = report.organization_id;

  // Fetch candidate + current placement + company + contacts
  const { data: candidate } = await service
    .from("candidates")
    .select("id, first_name, last_name, email, phone, employee_status")
    .eq("id", report.candidate_id)
    .maybeSingle();

  if (!candidate) return result;

  const candidateName = `${candidate.first_name} ${candidate.last_name}`.trim();

  // Find active placement (use report.placement_id if set, otherwise latest actief)
  let placement: any = null;
  if (report.placement_id) {
    const { data } = await service
      .from("placements")
      .select("id, company_id, function_name, created_by, status, start_date, end_date")
      .eq("id", report.placement_id)
      .maybeSingle();
    placement = data;
  }
  if (!placement) {
    const { data } = await service
      .from("placements")
      .select("id, company_id, function_name, created_by, status, start_date, end_date")
      .eq("candidate_id", candidate.id)
      .eq("status", "actief")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    placement = data;
  }

  // ── 1. Recruiter task ──
  try {
    // Prefer placement.created_by, else first admin/intercedent in org
    let assignedTo = placement?.created_by ?? triggeredBy ?? null;
    if (!assignedTo) {
      const { data: fallback } = await service
        .from("profiles")
        .select("id")
        .eq("organization_id", orgId)
        .in("role", ["admin", "intercedent"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      assignedTo = fallback?.id ?? null;
    }

    if (assignedTo) {
      const { error: taskErr } = await service.from("recruiter_tasks").insert({
        organization_id: orgId,
        assigned_to: assignedTo,
        title: `Ziekmelding van ${candidateName}`,
        description: report.notes ? `Klacht: ${report.notes}` : "Geen toelichting opgegeven.",
        priority: "high",
        status: "open",
        category: "sick_report",
        related_entity_type: "sick_report",
        related_entity_id: report.id,
        due_date: new Date().toISOString().split("T")[0],
      });
      if (!taskErr) result.task_created = true;
    }
  } catch (e) {
    console.warn("recruiter_task insert failed:", e);
  }

  // ── 2. Update candidate status ──
  if (candidate.employee_status === "actief") {
    const { error: statusErr } = await service
      .from("candidates")
      .update({ employee_status: "ziek" })
      .eq("id", candidate.id);
    if (!statusErr) result.status_updated = true;
  }

  // ── 3. Email opdrachtgever ──
  if (placement?.company_id) {
    const { data: contacts } = await service
      .from("company_contacts")
      .select("full_name, email, is_primary")
      .eq("company_id", placement.company_id)
      .not("email", "is", null)
      .order("is_primary", { ascending: false })
      .limit(1);

    const contact = contacts?.[0];
    const { data: company } = await service.from("companies").select("name").eq("id", placement.company_id).maybeSingle();

    if (contact?.email) {
      const subject = `Ziekmelding — ${candidateName}`;
      const html = buildClientEmailHtml({
        contactName: contact.full_name ?? "",
        candidateName,
        functionName: placement.function_name ?? "onbekende functie",
        companyName: company?.name ?? "",
        reportedAt: report.reported_at,
        expectedReturnDate: report.expected_return_date,
        notes: report.notes,
      });

      const sendResult = await sendViaOutlook({
        orgId,
        to: contact.email,
        subject,
        htmlBody: html,
        companyId: placement.company_id,
        candidateId: candidate.id,
        sentBy: triggeredBy ?? undefined,
      });

      if (sendResult.success) {
        result.email_sent = true;
        await service.from("sick_reports").update({
          client_notified: true,
          client_notified_at: new Date().toISOString(),
        }).eq("id", report.id);

        await service.from("communications").insert({
          organization_id: orgId,
          candidate_id: candidate.id,
          company_id: placement.company_id,
          channel: "email",
          direction: "outbound",
          subject,
          body: `Ziekmelding voor ${candidateName}${report.notes ? ` — ${report.notes}` : ""}`,
          sent_at: new Date().toISOString(),
          sent_by: triggeredBy ?? null,
          email_to: [contact.email],
        });
      } else {
        result.email_error = sendResult.error;
      }
    } else {
      result.email_error = "Geen contactpersoon met e-mail gevonden";
    }
  } else {
    result.email_error = "Geen actieve plaatsing — opdrachtgever niet genotificeerd";
  }

  // ── 4. WhatsApp confirmation to candidate ──
  if (candidate.phone) {
    const wa = await sendWhatsAppDirect(
      service,
      orgId,
      candidate.phone,
      `Hoi ${candidate.first_name},\n\nJe ziekmelding van ${new Date(report.reported_at).toLocaleDateString("nl-NL")} is geregistreerd. Beterschap! Je intercedent neemt contact met je op.\n\n— JA Werkt`
    );
    result.whatsapp_sent = wa.ok;
    if (!wa.ok) result.whatsapp_error = wa.error;
  }

  return result;
}

function buildClientEmailHtml(data: {
  contactName: string;
  candidateName: string;
  functionName: string;
  companyName: string;
  reportedAt: string;
  expectedReturnDate: string | null;
  notes: string | null;
}): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#ea580c;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Ziekmelding</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Beste ${escapeHtml(data.contactName || data.companyName)},</p>
          <p style="margin:0 0 24px;color:#334155;font-size:14px;">
            Hierbij melden wij dat <strong>${escapeHtml(data.candidateName)}</strong> zich ziek heeft gemeld voor de plaatsing als <strong>${escapeHtml(data.functionName)}</strong>.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-radius:6px;border:1px solid #fed7aa;margin-bottom:16px;">
            <tr><td style="padding:14px 20px;border-bottom:1px solid #fed7aa;">
              <span style="color:#9a3412;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Medewerker</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(data.candidateName)}</strong>
            </td></tr>
            <tr><td style="padding:14px 20px;border-bottom:1px solid #fed7aa;">
              <span style="color:#9a3412;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Gemeld op</span><br>
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(formatDate(data.reportedAt))}</strong>
            </td></tr>
            ${data.expectedReturnDate ? `<tr><td style="padding:14px 20px;border-bottom:1px solid #fed7aa;">
              <span style="color:#9a3412;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Verwachte terugkeer</span><br>
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(formatDate(data.expectedReturnDate))}</strong>
            </td></tr>` : ""}
            ${data.notes ? `<tr><td style="padding:14px 20px;">
              <span style="color:#9a3412;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Toelichting</span><br>
              <span style="color:#334155;font-size:14px;white-space:pre-wrap;">${escapeHtml(data.notes)}</span>
            </td></tr>` : ""}
          </table>

          <p style="margin:24px 0 0;color:#334155;font-size:14px;">Voor vragen over vervanging of herstel kunt u contact opnemen met uw intercedent.</p>
          <p style="margin:16px 0 0;color:#334155;font-size:14px;">Met vriendelijke groet,<br><strong>JA Werkt</strong></p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Automatische ziekmelding-notificatie.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
