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
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatEUR(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount);
}

const DAMAGE_TYPE_LABELS: Record<string, string> = {
  lekke_band: "Lekke band",
  dashboardlampje: "Dashboardlampje",
  motorstoring: "Motorstoring",
  carrosserie: "Carrosserieschade",
  ruitschade: "Ruitschade",
  overig: "Overig",
};

function buildEmailHtml(data: {
  vehicleLabel: string;
  reportedAt: string;
  damageTypeLabel: string;
  description: string;
  costEstimate: number | null;
  employeeName: string;
  employeePhone: string | null;
  employeeEmail: string | null;
  photoUrls: string[];
}): string {
  const photosHtml =
    data.photoUrls.length > 0
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
          <tr>${data.photoUrls
            .slice(0, 4)
            .map(
              (url) =>
                `<td style="padding:4px;width:25%;"><a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="Schadefoto" style="width:100%;max-width:140px;height:auto;border-radius:4px;border:1px solid #e2e8f0;"></a></td>`
            )
            .join("")}</tr>
        </table>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:11px;">Klik op een foto om deze groot te bekijken.</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#dc2626;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Schademelding</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#334155;font-size:14px;">Beste garagemedewerker,</p>
          <p style="margin:0 0 24px;color:#334155;font-size:14px;">
            Hierbij melden wij schade aan onderstaand voertuig. Graag zo spoedig mogelijk inplannen voor reparatie.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border-radius:6px;border:1px solid #fecaca;margin-bottom:16px;">
            <tr><td style="padding:14px 20px;border-bottom:1px solid #fecaca;">
              <span style="color:#991b1b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Voertuig</span><br>
              <strong style="color:#1e293b;font-size:15px;">${escapeHtml(data.vehicleLabel)}</strong>
            </td></tr>
            <tr><td style="padding:14px 20px;border-bottom:1px solid #fecaca;">
              <span style="color:#991b1b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Gemeld op</span><br>
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(formatDate(data.reportedAt))}</strong>
            </td></tr>
            <tr><td style="padding:14px 20px;border-bottom:1px solid #fecaca;">
              <span style="color:#991b1b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Type schade</span><br>
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(data.damageTypeLabel)}</strong>
            </td></tr>
            <tr><td style="padding:14px 20px;border-bottom:1px solid #fecaca;">
              <span style="color:#991b1b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Bestuurder</span><br>
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(data.employeeName)}</strong>
              ${data.employeePhone ? `<br><span style="color:#64748b;font-size:13px;">Tel: ${escapeHtml(data.employeePhone)}</span>` : ""}
              ${data.employeeEmail ? `<br><span style="color:#64748b;font-size:13px;">E-mail: ${escapeHtml(data.employeeEmail)}</span>` : ""}
            </td></tr>
            ${data.costEstimate != null ? `<tr><td style="padding:14px 20px;">
              <span style="color:#991b1b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Geschatte kosten</span><br>
              <strong style="color:#1e293b;font-size:14px;">${escapeHtml(formatEUR(data.costEstimate))}</strong>
            </td></tr>` : ""}
          </table>

          <div style="background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;padding:14px 20px;margin-bottom:16px;">
            <span style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Beschrijving</span>
            <p style="margin:6px 0 0;color:#334155;font-size:14px;white-space:pre-wrap;">${escapeHtml(data.description)}</p>
          </div>

          ${photosHtml}

          <p style="margin:24px 0 0;color:#334155;font-size:14px;">Graag ontvangen wij van u een offerte voor de reparatie. Voor vragen kunt u contact opnemen met JA Werkt.</p>
          <p style="margin:16px 0 0;color:#334155;font-size:14px;">Met vriendelijke groet,<br><strong>JA Werkt</strong></p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">Automatische schademelding.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);
    const orgId = profile.organization_id;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { report_id } = body as { report_id: string };
    if (!report_id) return json({ error: "report_id required" }, 400);

    const { data: report, error: repErr } = await serviceClient
      .from("vehicle_damage_reports")
      .select(`
        id, reported_at, damage_type, description, photos, garage_email, cost_estimate,
        vehicle:vehicle_id(license_plate, brand, model),
        employee:employee_id(candidates:candidate_id(first_name, last_name, phone, email))
      `)
      .eq("id", report_id)
      .eq("organization_id", orgId)
      .single();

    if (repErr || !report) return json({ error: "Schademelding niet gevonden" }, 404);

    const r = report as any;
    if (!r.garage_email) return json({ error: "Geen garage e-mailadres ingevuld" }, 400);

    // Build signed URLs for photos (1 hour TTL)
    const photoUrls: string[] = [];
    for (const path of (r.photos ?? []) as string[]) {
      const { data: signed } = await serviceClient.storage
        .from("documents")
        .createSignedUrl(path, 3600);
      if (signed?.signedUrl) photoUrls.push(signed.signedUrl);
    }

    const vehicle = r.vehicle;
    const vehicleLabel = vehicle
      ? `${vehicle.brand ?? ""} ${vehicle.model ?? ""} — ${vehicle.license_plate ?? ""}`.trim()
      : "Onbekend voertuig";

    const empCand = r.employee?.candidates;
    const employeeName = empCand ? `${empCand.first_name} ${empCand.last_name}`.trim() : "—";
    const damageTypeLabel = DAMAGE_TYPE_LABELS[r.damage_type] ?? r.damage_type;

    const subject = `Schademelding ${vehicleLabel} — ${damageTypeLabel}`;
    const html = buildEmailHtml({
      vehicleLabel,
      reportedAt: r.reported_at,
      damageTypeLabel,
      description: r.description,
      costEstimate: r.cost_estimate,
      employeeName,
      employeePhone: empCand?.phone ?? null,
      employeeEmail: empCand?.email ?? null,
      photoUrls,
    });

    const result = await sendViaOutlookAccount({
      orgId,
      to: r.garage_email,
      subject,
      htmlBody: html,
      sentBy: user.id,
    });

    if (!result.success) {
      return json({ error: result.error ?? "Verzenden mislukt", method: result.method }, 502);
    }

    // Log to communications (no candidate_id since recipient is garage)
    await serviceClient.from("communications").insert({
      organization_id: orgId,
      channel: "email",
      direction: "outbound",
      subject,
      body: `Schademelding voor ${vehicleLabel}`,
      sent_at: new Date().toISOString(),
      sent_by: user.id,
      email_to: [r.garage_email],
    });

    return json({ success: true, to: r.garage_email });
  } catch (err: any) {
    console.error("send-damage-report error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
