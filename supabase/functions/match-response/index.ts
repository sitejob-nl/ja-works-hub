import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Publieke voorstel-respons voor opdrachtgevers (/match/reageer/:token).
// Token-based, geen login: de 32-byte token IS het geheim. Draait met service-role
// zodat RLS niet hoeft te worden opengezet voor anon (SEC-4 dropte die policy).
// Geeft alleen de minimale data terug die de responspagina toont — GEEN score,
// GEEN BSN/IBAN, GEEN interne contactdata buiten de accountmanager voor "vraag stellen".

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import { storagePathFromCvValue } from "../_shared/candidate-dossier.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// --- Rate-limiting (publiek, ongeauthenticeerd): per gehashte IP + globaal. ---
const MAX_PER_IP_PER_HOUR = 80;
const MAX_GLOBAL_PER_HOUR = 1500;
const CV_SIGNED_TTL = 300; // 5 min — korte TTL, per request opnieuw, nooit permanent embedden.

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

// Opdrachtgever-beslissingen. Legacy ja/nee blijft werken (oude links / WhatsApp).
const DECISIONS = ["op_gesprek", "direct_starten", "afwijzen"] as const;
type Decision = typeof DECISIONS[number];
const LEGACY_MAP: Record<string, Decision> = { interesse: "direct_starten", geen_interesse: "afwijzen" };
const STATUS_MAP: Record<Decision, string> = {
  op_gesprek: "afspraak_op_kantoor",
  direct_starten: "geaccepteerd",
  afwijzen: "afgewezen",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const action = body.action === "respond" ? "respond" : "get";

    if (!token) return json({ error: "Token ontbreekt" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate-limit + toegangslog (service-only tabel). Blokkeert token-brute-force.
    const ipHash = await hashIp(clientIp(req));
    const since = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: ipCount }, { count: globalCount }] = await Promise.all([
      service.from("match_response_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", since),
      service.from("match_response_attempts").select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);
    if ((ipCount ?? 0) >= MAX_PER_IP_PER_HOUR || (globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR) {
      return json({ error: "Te veel verzoeken. Probeer het later opnieuw." }, 429);
    }
    await service.from("match_response_attempts").insert({ ip_hash: ipHash, token: token.slice(0, 12), action });

    const { data: tok } = await service
      .from("match_proposal_tokens")
      .select(
        "id, match_id, response, used_at, expires_at, matches!match_proposal_tokens_match_id_fkey(status, organization_id, candidate_id, vacancy_id, candidates!matches_candidate_id_fkey(first_name, last_name, ai_summary, ai_positive_signals, ai_risk_factors, cv_file_url), vacancies!matches_vacancy_id_fkey(title, created_by, companies:company_id(name)))",
      )
      .eq("token", token)
      .maybeSingle();

    if (!tok) return json({ status: "invalid" });

    const expired = new Date(tok.expires_at) < new Date();
    const matchRow = (tok.matches as any) ?? null;
    const orgId = matchRow?.organization_id ?? null;
    const candidate = matchRow?.candidates ?? null;
    const vacancy = matchRow?.vacancies ?? null;
    const company = vacancy?.companies ?? null;
    const view = {
      candidate: candidate ? { first_name: candidate.first_name, last_name: candidate.last_name } : null,
      vacancy: vacancy ? { title: vacancy.title } : null,
    };

    if (action === "get") {
      if (tok.used_at) return json({ status: "used", response: tok.response, ...view });
      if (expired) return json({ status: "expired" });

      // Volledige (maar geminimaliseerde) payload: logo, rapport zonder score/AI-label,
      // korte-TTL CV-link, afwijsredenen, accountmanager-contact voor "vraag stellen".
      const [orgRes, mgrRes, reasonsRes] = await Promise.all([
        service.from("organizations").select("logo_url, name, email, phone").eq("id", orgId).maybeSingle(),
        vacancy?.created_by
          ? service.from("profiles").select("full_name, email, phone").eq("id", vacancy.created_by).maybeSingle()
          : Promise.resolve({ data: null }),
        service.from("match_feedback_reasons").select("id, reason")
          .eq("organization_id", orgId).eq("applies_to", "afgewezen").eq("is_active", true)
          .order("sort_order", { ascending: true }),
      ]);
      const org = (orgRes as any).data;
      const mgr = (mgrRes as any).data;

      let cvUrl: string | null = null;
      const cvPath = storagePathFromCvValue(candidate?.cv_file_url);
      if (cvPath) {
        const { data: signed } = await service.storage.from("documents").createSignedUrl(cvPath, CV_SIGNED_TTL);
        cvUrl = signed?.signedUrl ?? null;
      }

      return json({
        status: "ok",
        org_logo_url: org?.logo_url ?? null,
        org_name: org?.name ?? null,
        candidate: view.candidate,
        vacancy: view.vacancy,
        company: company ? { name: company.name } : null,
        report: candidate
          ? {
            summary: candidate.ai_summary ?? null,
            strong_signals: Array.isArray(candidate.ai_positive_signals) ? candidate.ai_positive_signals : [],
            attention_points: Array.isArray(candidate.ai_risk_factors) ? candidate.ai_risk_factors : [],
          }
          : null,
        cv_url: cvUrl,
        rejection_reasons: (reasonsRes as any).data ?? [],
        contact: {
          manager_email: mgr?.email ?? org?.email ?? null,
          manager_phone: mgr?.phone ?? org?.phone ?? null,
        },
      });
    }

    // action === "respond"
    const decision: Decision | null = DECISIONS.includes(body.decision) ? body.decision : (LEGACY_MAP[body.response] ?? null);
    if (!decision) return json({ error: "Ongeldige reactie" }, 400);
    if (expired) return json({ status: "expired" });

    const rejectionReasonId = typeof body.rejection_reason_id === "string" ? body.rejection_reason_id : null;
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

    if (decision === "afwijzen") {
      if (!rejectionReasonId) return json({ error: "Reden is verplicht" }, 400);
      // Reden moet bij deze org horen en op 'afgewezen' van toepassing zijn.
      const { data: reason } = await service.from("match_feedback_reasons")
        .select("id").eq("id", rejectionReasonId).eq("organization_id", orgId).eq("applies_to", "afgewezen").maybeSingle();
      if (!reason) return json({ error: "Ongeldige reden" }, 400);
    }

    // Atomair single-use: alleen bijwerken als nog niet gebruikt (TOCTOU-safe).
    const { data: updated, error: updErr } = await service
      .from("match_proposal_tokens")
      .update({ response: decision, used_at: new Date().toISOString() })
      .eq("id", tok.id)
      .is("used_at", null)
      .select("id");

    if (updErr) return json({ error: "Kon reactie niet verwerken" }, 500);
    if (!updated || updated.length === 0) {
      return json({ status: "used", response: tok.response, ...view });
    }

    const newStatus = STATUS_MAP[decision];
    const matchUpdate: Record<string, unknown> = { status: newStatus, status_changed_at: new Date().toISOString() };
    if (decision === "op_gesprek" && typeof body.interview_date === "string") matchUpdate.interview_date = body.interview_date;
    if (decision === "direct_starten" && typeof body.desired_start_date === "string") matchUpdate.desired_start_date = body.desired_start_date;
    await service.from("matches").update(matchUpdate).eq("id", tok.match_id);

    // Business-event vastleggen (publiek → created_by NULL).
    await service.from("match_feedback_events").insert({
      organization_id: orgId,
      match_id: tok.match_id,
      from_status: matchRow?.status ?? null,
      to_status: newStatus,
      reason_id: rejectionReasonId,
      notes: note,
      created_by: null,
    });

    // Bij acceptatie/gesprek: interne opvolg-taak (de publieke pagina kan geen popup openen).
    if (decision !== "afwijzen") {
      const candName = candidate ? `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() : "kandidaat";
      const label = decision === "direct_starten" ? "wil direct starten" : "wil op gesprek";
      await service.from("recruiter_tasks").insert({
        organization_id: orgId,
        assigned_to: vacancy?.created_by ?? null,
        title: `Klant accepteerde voorstel — plan plaatsing (${candName})`,
        description: `De opdrachtgever ${label} voor "${vacancy?.title ?? ""}".${note ? ` Opmerking: ${note}` : ""}`,
        priority: "high",
        status: "open",
        category: "plaatsing",
        related_entity_type: "match",
        related_entity_id: tok.match_id,
      });
    }

    // Best-effort audit (schemamismatch mag de publieke flow niet breken).
    try {
      await service.from("audit_log").insert({
        organization_id: orgId,
        user_id: null,
        action: "status_change",
        table_name: "matches",
        record_id: tok.match_id,
        new_values: { decision, to_status: newStatus, via: "public_match_response" },
      } as any);
    } catch (_e) { /* ignore */ }

    return json({ status: "done", response: decision, ...view });
  } catch (err) {
    console.error("match-response error:", err);
    return json({ error: "Interne fout" }, 500);
  }
});
