// Publieke kandidaat-interesse-respons (/baan/interesse/:token) — de MEDEWERKER
// reageert op een baanvoorstel uit de kandidaat-voorstelmail. Token-based, geen login;
// draait met service-role (match_candidate_tokens is deny-all RLS, bewust).
//
// Spiegelt match-response (opdrachtgever-variant): IP-rate-limit via
// match_response_attempts, single-use token, minimale payload (vacaturetitel + branding —
// GEEN opdrachtgevernaam, GEEN score, GEEN interne data). De fase-transitie is gedeeld
// met de WhatsApp-ja/nee-knoppen (_shared/match-interest.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import {
  applyMatchInterest,
  recordMatchCandidateTokenResponse,
} from "../_shared/match-interest.ts";
import { createMatchFollowUpTask } from "../_shared/match-lifecycle.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Zelfde limieten als match-response — gedeelde throttle-tabel.
const MAX_PER_IP_PER_HOUR = 80;
const MAX_GLOBAL_PER_HOUR = 1500;

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

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
    await service.from("match_response_attempts").insert({
      ip_hash: ipHash,
      token: token.slice(0, 12),
      action: `candidate_${action}`,
    });

    const { data: tok } = await service
      .from("match_candidate_tokens")
      .select(
        "id, match_id, organization_id, response, used_at, expires_at, matches!match_candidate_tokens_match_id_fkey(status, assigned_to, vacancies!matches_vacancy_id_fkey(title, location, created_by), candidates!matches_candidate_id_fkey(first_name))",
      )
      .eq("token", token)
      .maybeSingle();
    if (!tok) return json({ status: "invalid" });

    const expired = new Date(tok.expires_at) < new Date();
    const matchRow = (tok.matches as any) ?? null;
    const orgId = tok.organization_id;
    const vacancy = matchRow?.vacancies ?? null;
    const view = {
      vacancy_title: vacancy?.title ?? null,
      vacancy_location: vacancy?.location ?? null,
      first_name: matchRow?.candidates?.first_name ?? null,
    };

    if (action === "get") {
      if (tok.used_at) return json({ status: "used", response: tok.response, ...view });
      if (expired) return json({ status: "expired", ...view });
      const { data: org } = await service
        .from("organizations")
        .select("name, logo_url, email, phone")
        .eq("id", orgId)
        .maybeSingle();
      return json({
        status: "ok",
        ...view,
        org_name: org?.name ?? null,
        org_logo_url: org?.logo_url ?? null,
        org_email: org?.email ?? null,
        org_phone: org?.phone ?? null,
      });
    }

    // action === "respond"
    const answer = body.answer === "ja" ? "ja" : body.answer === "nee" ? "nee" : null;
    if (!answer) return json({ error: "Ongeldige reactie" }, 400);
    if (expired) return json({ status: "expired", ...view });
    if (tok.used_at) return json({ status: "used", response: tok.response, ...view });

    // Race-safe single-use: eerste reactie wint.
    const recorded = await recordMatchCandidateTokenResponse(service, {
      tokenId: tok.id,
      response: answer,
    });
    if (!recorded.accepted) return json({ status: "used", response: tok.response, ...view });

    await applyMatchInterest(service, {
      orgId,
      matchId: tok.match_id,
      isYes: answer === "ja",
      channel: "email",
    });

    // Interne opvolg-taak bij interesse (spiegelt de klant-reactieflow).
    if (answer === "ja") {
      const candName = view.first_name ?? "kandidaat";
      await createMatchFollowUpTask(service, {
        orgId,
        matchId: tok.match_id,
        // Zelfde routing als de klant-reactieflow: accountmanager van de match,
        // vacature-eigenaar als vangnet.
        assignedTo: matchRow?.assigned_to ?? vacancy?.created_by ?? null,
        title: `Kandidaat heeft interesse — opvolgen (${candName})`,
        description: `${candName} reageerde 'Ja, ik heb interesse' op het baanvoorstel "${vacancy?.title ?? ""}" via e-mail. Plan een gesprek in.`,
        priority: "high",
        category: "matching",
      });
    }

    // Best-effort audit (mag de publieke flow niet breken).
    try {
      await service.from("audit_log").insert({
        organization_id: orgId,
        user_id: null,
        action: "status_change",
        table_name: "matches",
        record_id: tok.match_id,
        new_values: { answer, via: "public_candidate_interest" },
      } as any);
    } catch (_e) { /* ignore */ }

    return json({ status: "done", response: answer, ...view });
  } catch (err) {
    console.error("candidate-interest error:", err);
    return json({ error: "Interne fout" }, 500);
  }
});
