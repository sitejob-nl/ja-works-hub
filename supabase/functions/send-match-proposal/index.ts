import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOutlook } from "../_shared/outlook-send.ts";

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

function buildProposalEmailHtml(data: {
  contactName: string;
  candidateName: string;
  vacancyTitle: string;
  companyName: string;
  summary: string | null;
  responseUrl: string;
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
          <h2 style="margin:0 0 8px;color:#1e293b;font-size:18px;">Kandidaat voorstel</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Wij hebben een geschikte kandidaat gevonden voor de functie ${escapeHtml(data.vacancyTitle)}</p>

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
            ${data.summary ? `<tr><td style="padding:16px 20px;">
              <span style="color:#1d4ed8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Samenvatting</span><br>
              <span style="color:#1e3a5f;font-size:14px;">${escapeHtml(data.summary)}</span>
            </td></tr>` : ''}
          </table>

          <p style="margin:0 0 16px;color:#334155;font-size:14px;">
            Klik op onderstaande knop om aan te geven of u interesse heeft in deze kandidaat:
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center" style="padding:12px 0;">
              <a href="${escapeHtml(data.responseUrl)}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:600;">
                Reageer op dit voorstel
              </a>
            </td></tr>
          </table>

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return json({ error: "Profile not found" }, 404);
    }

    const orgId = profile.organization_id;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Parse input ──
    const body = await req.json();
    const { match_id, preview } = body;

    if (!match_id) {
      return json({ error: "match_id is required" }, 400);
    }

    // ── Fetch match with relations ──
    const { data: match, error: mErr } = await supabase
      .from("matches")
      .select(`
        *,
        candidates:candidate_id(id, first_name, last_name, email, phone, ai_summary),
        vacancies:vacancy_id(id, title, companies:company_id(id, name, email))
      `)
      .eq("id", match_id)
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

    // ── Fetch company contact ──
    const { data: contacts } = await supabase
      .from("company_contacts")
      .select("*")
      .eq("company_id", company.id)
      .order("is_primary", { ascending: false })
      .limit(1);

    const contactName = contacts?.[0]?.full_name ?? company.name;
    const contactEmail = contacts?.[0]?.email ?? company.email;

    const subject = `Kandidaat voorstel: ${candidateName} voor ${vacancy.title}`;

    // ── Preview mode: build HTML without creating token or sending ──
    if (preview) {
      const html = buildProposalEmailHtml({
        contactName,
        candidateName,
        vacancyTitle: vacancy.title,
        companyName: company.name,
        summary: candidate.ai_summary ?? match.match_reasoning ?? null,
        responseUrl: "#preview",
      });
      return json({
        preview: true,
        to: contactEmail,
        contact_name: contactName,
        subject,
        html,
      });
    }

    // ── Create proposal token ──
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

    // ── Build response URL ──
    const siteUrl = Deno.env.get("SITE_URL") || Deno.env.get("SUPABASE_URL")!.replace('.supabase.co', '.netlify.app');
    const responseUrl = `${siteUrl}/match-response/${token.token}`;

    // ── Build & send email ──
    const html = buildProposalEmailHtml({
      contactName,
      candidateName,
      vacancyTitle: vacancy.title,
      companyName: company.name,
      summary: candidate.ai_summary ?? match.match_reasoning ?? null,
      responseUrl,
    });

    // Try sending via Outlook
    const outlookResult = await sendViaOutlook({
      orgId,
      to: contactEmail,
      subject,
      htmlBody: html,
      sentBy: user.id,
      companyId: company.id,
    });

    // ── Update match status ──
    await supabase
      .from("matches")
      .update({
        status: "voorgesteld_bij_klant",
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", match_id);

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
