import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";
import { type BrandTheme, escapeHtml, loadBrandTheme, renderBrandedEmail } from "../_shared/email-layout.ts";

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
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
}

function formatHours(h: number): string {
  return h.toFixed(2).replace(".", ",");
}

interface TimesheetRow {
  id: string;
  candidate_id: string;
  work_date: string;
  hours: number;
  overtime_hours: number | null;
  travel_km: number | null;
  placements: { companies: { name: string } | null } | null;
  candidates: { first_name: string; last_name: string; email: string | null } | null;
}

function buildEmailHtml(data: {
  candidateName: string;
  rows: TimesheetRow[];
  totalHours: number;
  totalOvertime: number;
  period: string;
  theme: BrandTheme;
}): string {
  const { theme } = data;
  const rowsHtml = data.rows
    .map((r) => {
      const company = r.placements?.companies?.name ?? "—";
      const h = r.hours ?? 0;
      const ot = r.overtime_hours ?? 0;
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:${theme.textHex};font-size:13px;">${escapeHtml(formatDate(r.work_date))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:${theme.textHex};font-size:13px;">${escapeHtml(company)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:${theme.textHex};font-size:13px;text-align:right;">${formatHours(h)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;text-align:right;">${ot > 0 ? formatHours(ot) : "—"}</td>
      </tr>`;
    })
    .join("");

  const content = `<h2 style="margin:0 0 16px;color:${theme.navyHex};font-size:18px;">Urenbevestiging</h2>
          <p style="margin:0 0 16px;color:${theme.textHex};font-size:14px;">Hoi ${escapeHtml(data.candidateName)},</p>
          <p style="margin:0 0 24px;color:${theme.textHex};font-size:14px;">Je uren over <strong>${escapeHtml(data.period)}</strong> zijn goedgekeurd. Hieronder het overzicht:</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:16px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Datum</th>
                <th style="padding:10px 12px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Opdrachtgever</th>
                <th style="padding:10px 12px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Uren</th>
                <th style="padding:10px 12px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Overuren</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr style="background:${theme.navyHex};">
                <td colspan="2" style="padding:12px;color:#ffffff;font-size:13px;font-weight:600;">Totaal</td>
                <td style="padding:12px;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${formatHours(data.totalHours)}</td>
                <td style="padding:12px;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${data.totalOvertime > 0 ? formatHours(data.totalOvertime) : "—"}</td>
              </tr>
            </tfoot>
          </table>

          <p style="margin:16px 0 0;color:${theme.textHex};font-size:14px;">Heb je vragen over deze uren? Neem dan contact op met je intercedent.</p>
          <p style="margin:24px 0 0;color:${theme.textHex};font-size:14px;">Met vriendelijke groet,<br><strong>${escapeHtml(theme.orgName)}</strong></p>`;
  return renderBrandedEmail({
    theme,
    contentHtml: content,
    preheader: `Je uren over ${data.period} zijn goedgekeurd`,
    footerNote: "Dit is een automatisch gegenereerd bericht.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireRolePermission(req, "finance.manage", corsHeaders);
    if (auth instanceof Response) return auth;
    const orgId = auth.organizationId;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { timesheet_ids } = body as { timesheet_ids: string[] };
    if (!Array.isArray(timesheet_ids) || timesheet_ids.length === 0) {
      return json({ error: "timesheet_ids required" }, 400);
    }

    // Fetch timesheets + relations
    const { data: rows, error: rowErr } = await serviceClient
      .from("timesheets")
      .select(`
        id, candidate_id, work_date, hours, overtime_hours, travel_km, status,
        candidates:candidate_id(first_name, last_name, email),
        placements:placement_id(
          companies:company_id(name)
        )
      `)
      .in("id", timesheet_ids)
      .eq("organization_id", orgId)
      .eq("status", "goedgekeurd");

    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!rows || rows.length === 0) return json({ sent: 0, skipped: 0, reason: "Geen goedgekeurde uren gevonden" });

    // Merk-thema (logo + accentkleur) voor de huisstijl-mailframe — org-specifiek, default JA! Werkt.
    const brandTheme = await loadBrandTheme(serviceClient, orgId);

    // Group by candidate
    const byCandidate = new Map<string, TimesheetRow[]>();
    for (const r of rows as any[]) {
      if (!byCandidate.has(r.candidate_id)) byCandidate.set(r.candidate_id, []);
      byCandidate.get(r.candidate_id)!.push(r);
    }

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [candidateId, items] of byCandidate) {
      const first = items[0];
      const candidate = first.candidates;
      if (!candidate?.email) {
        skipped++;
        continue;
      }

      items.sort((a, b) => a.work_date.localeCompare(b.work_date));
      const totalHours = items.reduce((s, r) => s + (r.hours ?? 0), 0);
      const totalOvertime = items.reduce((s, r) => s + (r.overtime_hours ?? 0), 0);
      const name = `${candidate.first_name} ${candidate.last_name}`.trim();

      const dates = items.map((r) => r.work_date);
      const minD = formatDate(dates[0]);
      const maxD = formatDate(dates[dates.length - 1]);
      const period = minD === maxD ? minD : `${minD} – ${maxD}`;

      const html = buildEmailHtml({ candidateName: name, rows: items, totalHours, totalOvertime, period, theme: brandTheme });
      const subject = `Urenbevestiging ${period} — ${formatHours(totalHours)} uur goedgekeurd`;

      const result = await sendViaOutlookAccount({
        orgId,
        to: candidate.email,
        subject,
        htmlBody: html,
        candidateId,
        sentBy: auth.userId,
        senderName: null,
      });

      if (result.success) {
        sent++;
        // Log to communications
        await serviceClient.from("communications").insert({
          organization_id: orgId,
          candidate_id: candidateId,
          channel: "email",
          direction: "outbound",
          subject,
          body: `Urenbevestiging ${period} — ${items.length} regels, ${formatHours(totalHours)} uur`,
          sent_at: new Date().toISOString(),
          sent_by: auth.userId,
          email_to: [candidate.email],
        });
      } else {
        skipped++;
        if (result.error) errors.push(`${name}: ${result.error}`);
      }
    }

    return json({ sent, skipped, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    console.error("send-timesheet-approval error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
