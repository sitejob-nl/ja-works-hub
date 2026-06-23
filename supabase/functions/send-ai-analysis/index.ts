// send-ai-analysis — render & verstuur AI-analyse rapport van een kandidaat
// naar een opdrachtgever-contact.
//
// Modes:
//   - preview = true → returns rendered HTML (frontend kan dat printen of als PDF downloaden)
//   - preview = false (default) → verstuurt als email body via Outlook + log in communications
//
// AVG: gebruikt het al-gepseudonimiseerde `ai_analysis` blok. Naam van de kandidaat
// wordt enkel gedeeld als de aanroeper een initialen-only weergave NIET wil — de
// aanroepende UI bepaalt of het rapport echte naam of pseudonimisering laat zien.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOutlookAccount } from "../_shared/outlook-send.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function escapeHtml(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return d;
  }
}

function listBlock(label: string, items: string[] | null | undefined, color: string): string {
  if (!items || items.length === 0) return "";
  return `
    <div style="margin-top:18px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:${color};font-weight:600;margin-bottom:6px">${escapeHtml(label)}</div>
      <ul style="margin:0;padding-left:18px;color:#1a1a1a;font-size:13px;line-height:1.5">
        ${items.map(i => `<li style="margin:2px 0">${escapeHtml(i)}</li>`).join("")}
      </ul>
    </div>`;
}

function reliabilityBadge(score: number | null | undefined): string {
  if (score == null) return "";
  const pct = Math.round(score);
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
  return `<span style="display:inline-block;background:${color};color:#fff;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600">Betrouwbaarheid: ${pct}%</span>`;
}

interface BuildReportInput {
  org: any;
  candidate: any;
  introText?: string;
  recipientName?: string;
  showName: boolean;
}

function buildReportHtml({ org, candidate, introText, recipientName, showName }: BuildReportInput): string {
  const displayName = showName
    ? [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")
    : `Kandidaat ${candidate.employee_number ?? candidate.id?.slice(0, 6) ?? ""}`.trim();

  const intro = introText?.trim()
    ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(introText).replace(/\n/g, "<br>")}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1a1a1a; margin:0; padding:32px; font-size:13px; background:#fff; }
  h1 { font-size:22px; margin:0 0 6px; color:#0C4D78; }
  h2 { font-size:15px; margin:24px 0 8px; color:#0C4D78; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:24px; }
  .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:18px; }
  .meta-box { background:#f8fafc; padding:14px; border-radius:8px; border:1px solid #e2e8f0; }
  .meta-label { font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#64748b; margin-bottom:4px; }
  .meta-value { font-weight:600; color:#0C4D78; }
  .summary { background:#f0f9ff; border-left:3px solid #0284c7; padding:14px; border-radius:4px; font-size:13px; line-height:1.6; color:#0c4a6e; }
  .footer { margin-top:32px; padding-top:14px; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8; text-align:center; }
</style></head>
<body>
  <div class="header">
    <div>
      ${org.logo_url ? `<img src="${escapeHtml(org.logo_url)}" alt="" style="max-height:48px;margin-bottom:8px">` : ""}
      <h1>Kandidaatprofiel</h1>
      <div style="font-size:13px;color:#64748b">AI-analyse rapport · ${formatDate(candidate.ai_analyzed_at)}</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#64748b;line-height:1.5">
      <strong style="color:#0C4D78">${escapeHtml(org.name)}</strong><br>
      ${org.email ? escapeHtml(org.email) + "<br>" : ""}
      ${org.phone ? escapeHtml(org.phone) : ""}
    </div>
  </div>

  ${recipientName ? `<p style="margin:0 0 12px;color:#475569">Beste ${escapeHtml(recipientName)},</p>` : ""}
  ${intro}

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Kandidaat</div>
      <div class="meta-value">${escapeHtml(displayName)}</div>
      ${candidate.ai_function_group ? `<div style="margin-top:6px;font-size:12px;color:#64748b">Functiegroep: <strong style="color:#0C4D78">${escapeHtml(candidate.ai_function_group)}</strong></div>` : ""}
      ${candidate.ai_classification ? `<div style="font-size:12px;color:#64748b">Classificatie: <strong style="color:#0C4D78">${escapeHtml(candidate.ai_classification)}</strong></div>` : ""}
    </div>
    <div class="meta-box">
      <div class="meta-label">Inschatting</div>
      <div>${reliabilityBadge(candidate.ai_reliability_score)}</div>
      ${candidate.ai_stability ? `<div style="margin-top:8px;font-size:12px;color:#64748b">Stabiliteit: <strong style="color:#0C4D78">${escapeHtml(candidate.ai_stability)}</strong></div>` : ""}
    </div>
  </div>

  ${candidate.ai_summary ? `
    <h2>Samenvatting</h2>
    <div class="summary">${escapeHtml(candidate.ai_summary).replace(/\n/g, "<br>")}</div>
  ` : ""}

  ${listBlock("Sterke punten", candidate.ai_positive_signals, "#16a34a")}
  ${listBlock("Aandachtspunten", candidate.ai_red_flags, "#dc2626")}
  ${listBlock("Risicofactoren", candidate.ai_risk_factors, "#d97706")}
  ${listBlock("Geschikte functies", candidate.ai_target_functions, "#0284c7")}
  ${listBlock("Voorgestelde interviewvragen", candidate.ai_interview_questions, "#7c3aed")}

  <div class="footer">
    ${escapeHtml(org.name)} · AI-analyse gegenereerd door JA Werkt · ${formatDate(new Date().toISOString())}
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Self-auth pattern (config has verify_jwt = false, see CLAUDE.md note about ES256 keys)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();
    const orgId = profile?.organization_id;
    if (!orgId) return json({ error: "No organization" }, 403);

    const body = await req.json().catch(() => ({} as any));
    const {
      candidate_id,
      recipient_email,
      recipient_name,
      company_id,
      intro_text,
      preview,
      show_name = true,
    } = body as {
      candidate_id?: string;
      recipient_email?: string;
      recipient_name?: string;
      company_id?: string;
      intro_text?: string;
      preview?: boolean;
      show_name?: boolean;
    };

    if (!candidate_id) return json({ error: "candidate_id is required" }, 400);

    // Fetch candidate (must be in same org)
    const { data: candidate, error: candErr } = await admin
      .from("candidates")
      .select("id, first_name, last_name, employee_number, ai_analyzed_at, ai_status, ai_summary, ai_function_group, ai_classification, ai_reliability_score, ai_stability, ai_positive_signals, ai_red_flags, ai_risk_factors, ai_target_functions, ai_interview_questions")
      .eq("id", candidate_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (candErr || !candidate) return json({ error: "Kandidaat niet gevonden" }, 404);
    if (candidate.ai_status !== "completed") {
      return json({ error: "AI-analyse is nog niet voltooid voor deze kandidaat" }, 400);
    }

    // Fetch org info for header
    const { data: org } = await admin
      .from("organizations")
      .select("name, email, phone, logo_url")
      .eq("id", orgId)
      .single();

    const html = buildReportHtml({
      org: org ?? { name: "JA Werkt" },
      candidate,
      introText: intro_text,
      recipientName: recipient_name,
      showName: show_name,
    });

    if (preview) {
      return json({ html, candidate_id: candidate.id });
    }

    if (!recipient_email?.trim()) {
      return json({ error: "recipient_email is required when preview is false" }, 400);
    }

    const subjectName = show_name
      ? [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")
      : `kandidaat ${candidate.employee_number ?? candidate.id?.slice(0, 6) ?? ""}`.trim();
    const subject = `AI-profielanalyse: ${subjectName}`;

    const sendResult = await sendViaOutlookAccount({
      orgId,
      to: recipient_email.trim(),
      subject,
      htmlBody: html,
      candidateId: candidate.id,
      companyId: company_id || undefined,
      sentBy: userId,
    });

    if (!sendResult.success) {
      return json({
        error: sendResult.error ?? "Versturen mislukt",
        method: sendResult.method,
        communication_paused: sendResult.communicationPaused === true,
      }, sendResult.communicationPaused ? 403 : 500);
    }

    return json({ success: true, method: sendResult.method, candidate_id: candidate.id });
  } catch (err: any) {
    console.error("send-ai-analysis error:", err);
    return json({ error: err.message ?? String(err) }, 500);
  }
});
