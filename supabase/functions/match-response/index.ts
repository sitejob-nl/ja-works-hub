import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Publieke voorstel-respons voor opdrachtgevers (/match/reageer/:token).
// Token-based, geen login: de 32-byte token IS het geheim. Draait met service-role
// zodat RLS niet hoeft te worden opengezet voor anon (SEC-4 dropte die policy).
// Geeft alleen de minimale data terug die de responspagina toont.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VALID_RESPONSES = ["interesse", "geen_interesse"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const action = body.action === "respond" ? "respond" : "get";
    const response = body.response;

    if (!token) return json({ error: "Token ontbreekt" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tok } = await service
      .from("match_proposal_tokens")
      .select(
        "id, match_id, response, used_at, expires_at, matches!match_proposal_tokens_match_id_fkey(candidates!matches_candidate_id_fkey(first_name, last_name), vacancies!matches_vacancy_id_fkey(title))",
      )
      .eq("token", token)
      .maybeSingle();

    if (!tok) return json({ status: "invalid" });

    const expired = new Date(tok.expires_at) < new Date();
    const candidate = (tok.matches as any)?.candidates ?? null;
    const vacancy = (tok.matches as any)?.vacancies ?? null;
    // Alleen het strikt noodzakelijke teruggeven — geen contact_email, org-id, etc.
    const view = {
      candidate: candidate ? { first_name: candidate.first_name, last_name: candidate.last_name } : null,
      vacancy: vacancy ? { title: vacancy.title } : null,
    };

    if (action === "get") {
      if (tok.used_at) return json({ status: "used", response: tok.response, ...view });
      if (expired) return json({ status: "expired" });
      return json({ status: "ok", ...view });
    }

    // action === "respond"
    if (!VALID_RESPONSES.includes(response)) return json({ error: "Ongeldige reactie" }, 400);
    if (expired) return json({ status: "expired" });

    // Atomair single-use: alleen bijwerken als nog niet gebruikt (voorkomt dubbele submit / TOCTOU).
    const { data: updated, error: updErr } = await service
      .from("match_proposal_tokens")
      .update({ response, used_at: new Date().toISOString() })
      .eq("id", tok.id)
      .is("used_at", null)
      .select("id");

    if (updErr) return json({ error: "Kon reactie niet verwerken" }, 500);
    if (!updated || updated.length === 0) {
      // Race: al gebruikt tussen lookup en update — geef de vastgelegde reactie terug.
      return json({ status: "used", response: tok.response, ...view });
    }

    const newStatus = response === "interesse" ? "geaccepteerd" : "afgewezen";
    await service
      .from("matches")
      .update({ status: newStatus, status_changed_at: new Date().toISOString() })
      .eq("id", tok.match_id);

    return json({ status: "done", response, ...view });
  } catch (err) {
    console.error("match-response error:", err);
    return json({ error: "Interne fout" }, 500);
  }
});
