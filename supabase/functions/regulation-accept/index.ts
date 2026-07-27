// regulation-accept — publieke pagina waar een medewerker een reglement leest en bevestigt.
//
// Geen login: de medewerker heeft vaak geen portaalaccount (bij JA Werkt zijn er 2 op 127 actieve
// plaatsingen). Toegang loopt dus via een eenmalige token uit de mail, net als /contract/sign en
// /match/reageer: service-role validatie, single-use, vervaldatum en IP-rate-limit.
//
// De token staat gehasht in regulation_send_tokens, zodat interne gebruikers de verzendstatus
// mogen lezen zonder de link te kunnen reconstrueren en namens iemand te tekenen.
//
// Twee acties:
//   view    -> reglement-meta + korte-TTL signed URL voor de PDF
//   accept  -> regulation_acknowledgements-rij (tijdstip + IP) + token als gebruikt markeren

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Eigen budget per endpoint: we delen de attempts-tabel met match-response, maar tellen op de
// action-prefix zodat drukte daar deze pagina niet dichtzet (en andersom).
const MAX_PER_IP_PER_HOUR = 60;
const MAX_GLOBAL_PER_HOUR = 800;
const ACTION_PREFIX = "regulation:";
const PDF_SIGNED_TTL = 600; // 10 min — lang genoeg om te lezen, kort genoeg om niet te delen.

async function hashHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

/**
 * regulation_acknowledgements.employee_id is NOT NULL en wijst naar de legacy `employees`-tabel,
 * niet naar `candidates`. Zonder deze resolutie faalt de insert (of erger: hangt de ondertekening
 * aan het verkeerde id). Spiegelt src/lib/assignments.ts → resolveEmployeeId.
 */
// deno-lint-ignore no-explicit-any
async function resolveEmployeeId(service: any, candidateId: string, orgId: string): Promise<string | null> {
  const { data: existing } = await service
    .from("employees").select("id").eq("organization_id", orgId).eq("candidate_id", candidateId).maybeSingle();
  if (existing?.id) return existing.id;

  const { data: candidate } = await service
    .from("candidates").select("employee_number, employee_status").eq("id", candidateId).maybeSingle();
  const { data: created } = await service
    .from("employees")
    .insert({
      organization_id: orgId,
      candidate_id: candidateId,
      employee_number: candidate?.employee_number ?? null,
      start_date: new Date().toISOString().split("T")[0],
      status: candidate?.employee_status === "ziek" ? "ziek" : (candidate?.employee_status ?? "actief"),
    })
    .select("id")
    .single();
  return created?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const action = body.action === "accept" ? "accept" : "view";
    if (!token) return json({ error: "Token ontbreekt" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate-limit vóór de tokenlookup: blokkeert brute-force op de tokenruimte.
    const ipHash = await hashHex(clientIp(req));
    const since = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: ipCount }, { count: globalCount }] = await Promise.all([
      service.from("match_response_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).like("action", `${ACTION_PREFIX}%`).gte("created_at", since),
      service.from("match_response_attempts").select("id", { count: "exact", head: true })
        .like("action", `${ACTION_PREFIX}%`).gte("created_at", since),
    ]);
    if ((ipCount ?? 0) >= MAX_PER_IP_PER_HOUR || (globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR) {
      return json({ error: "Te veel verzoeken. Probeer het later opnieuw." }, 429);
    }
    await service.from("match_response_attempts")
      .insert({ ip_hash: ipHash, token: token.slice(0, 12), action: `${ACTION_PREFIX}${action}` });

    const { data: tok } = await service
      .from("regulation_send_tokens")
      .select("id, organization_id, regulation_id, candidate_id, context_type, used_at, expires_at")
      .eq("token_hash", await hashHex(token))
      .maybeSingle();

    if (!tok) return json({ error: "Deze link is niet geldig." }, 404);
    if (new Date(tok.expires_at) < new Date()) {
      return json({ error: "Deze link is verlopen. Vraag je contactpersoon om een nieuwe." }, 410);
    }

    const [{ data: reg }, { data: cand }, { data: org }] = await Promise.all([
      service.from("regulations").select("id, title, version, content, file_url").eq("id", tok.regulation_id).maybeSingle(),
      service.from("candidates").select("first_name").eq("id", tok.candidate_id).maybeSingle(),
      service.from("organizations").select("name, logo_url, settings").eq("id", tok.organization_id).maybeSingle(),
    ]);
    if (!reg) return json({ error: "Reglement niet gevonden." }, 404);

    // Al eerder getekend? Dan tonen we dat, in plaats van een tweede rij te schrijven.
    const { data: existingAck } = await service
      .from("regulation_acknowledgements")
      .select("signed_at")
      .eq("regulation_id", tok.regulation_id)
      .eq("candidate_id", tok.candidate_id)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === "accept") {
      if (existingAck) {
        return json({ ok: true, already: true, signed_at: existingAck.signed_at });
      }
      if (tok.used_at) return json({ error: "Deze link is al gebruikt." }, 409);

      const employeeId = await resolveEmployeeId(service, tok.candidate_id, tok.organization_id);
      if (!employeeId) return json({ error: "Kon de bevestiging niet vastleggen." }, 500);

      const { error: ackErr } = await service.from("regulation_acknowledgements").insert({
        organization_id: tok.organization_id,
        regulation_id: tok.regulation_id,
        employee_id: employeeId,
        candidate_id: tok.candidate_id,
        ip_address: clientIp(req),
      });
      if (ackErr) return json({ error: "Kon de bevestiging niet vastleggen." }, 500);

      await service.from("regulation_send_tokens").update({ used_at: new Date().toISOString() }).eq("id", tok.id);
      return json({ ok: true, signed_at: new Date().toISOString() });
    }

    // view: PDF achter een korte signed URL, nooit permanent embedden.
    let fileUrl: string | null = null;
    if (reg.file_url) {
      const { data: signed } = await service.storage.from("documents").createSignedUrl(reg.file_url, PDF_SIGNED_TTL);
      fileUrl = signed?.signedUrl ?? null;
    }

    return json({
      regulation: {
        title: reg.title,
        version: reg.version,
        content: reg.content ?? "",
        file_url: fileUrl,
      },
      context_type: tok.context_type,
      first_name: cand?.first_name ?? null,
      organization: { name: org?.name ?? null, logo_url: org?.logo_url ?? null },
      already_signed_at: existingAck?.signed_at ?? null,
    });
  } catch (err) {
    console.error("regulation-accept error:", err);
    return json({ error: "Interne fout" }, 500);
  }
});
