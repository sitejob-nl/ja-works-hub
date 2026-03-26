import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function sanitizeCvText(text: string): string {
  let clean = text;
  clean = clean.replace(/ignore (all |previous |above |prior )?instructions?/gi, '[REMOVED]');
  clean = clean.replace(/forget (all |previous |above |prior )?instructions?/gi, '[REMOVED]');
  clean = clean.replace(/you are now/gi, '[REMOVED]');
  clean = clean.replace(/new role:/gi, '[REMOVED]');
  clean = clean.replace(/system prompt/gi, '[REMOVED]');
  clean = clean.replace(/\[INST\]/gi, '[REMOVED]');
  clean = clean.replace(/<\|im_start\|>/gi, '[REMOVED]');
  clean = clean.replace(/<\|im_end\|>/gi, '[REMOVED]');
  if (clean.length > 15000) {
    clean = clean.substring(0, 15000) + '\n[CV tekst ingekort]';
  }
  return clean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: standard pattern (user-scoped client) ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Ongeldige sessie" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: "Geen organisatie" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = profile.organization_id;
    const body = await req.json();
    const { cv_text, candidate_id } = body;

    if (!cv_text || cv_text.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: "CV tekst te kort (min 50 tekens)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!candidate_id) {
      return new Response(
        JSON.stringify({ error: "candidate_id is verplicht" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service role client for writes
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: candidate } = await adminClient
      .from("candidates")
      .select("id, organization_id, ai_status")
      .eq("id", candidate_id)
      .single();

    if (!candidate || candidate.organization_id !== orgId) {
      return new Response(
        JSON.stringify({ error: "Kandidaat niet gevonden of geen toegang" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (candidate.ai_status === 'analyzing') {
      return new Response(
        JSON.stringify({ error: "Analyse loopt al voor deze kandidaat" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Set status + save raw text
    await adminClient
      .from("candidates")
      .update({ ai_status: 'analyzing', cv_raw_text: cv_text })
      .eq("id", candidate_id)
      .eq("organization_id", orgId);

    const sanitizedText = sanitizeCvText(cv_text);
    const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL");
    const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");

    if (!OLLAMA_BASE_URL || !OLLAMA_API_KEY) {
      console.error("[analyze-cv] OLLAMA_BASE_URL or OLLAMA_API_KEY not configured");
      await adminClient
        .from("candidates")
        .update({ ai_status: 'failed' })
        .eq("id", candidate_id)
        .eq("organization_id", orgId);

      return new Response(
        JSON.stringify({ error: "VPS niet geconfigureerd (OLLAMA_BASE_URL/OLLAMA_API_KEY ontbreekt)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-cv-callback`;
    const workerUrl = `${OLLAMA_BASE_URL}/analyze`;

    console.log(`[analyze-cv] Starting for candidate=${candidate_id} org=${orgId} workerUrl=${workerUrl}`);

    try {
      const workerResp = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({
          cv_text: sanitizedText,
          candidate_id,
          organization_id: orgId,
          user_id: user.id,
          callback_url: callbackUrl,
        }),
      });

      const workerBody = await workerResp.text();
      console.log(`[analyze-cv] Worker response: ${workerResp.status} ${workerBody}`);

      if (!workerResp.ok) {
        console.error(`[analyze-cv] Worker rejected: ${workerResp.status} ${workerBody}`);
        await adminClient
          .from("candidates")
          .update({ ai_status: 'failed' })
          .eq("id", candidate_id)
          .eq("organization_id", orgId);

        return new Response(
          JSON.stringify({ error: `VPS worker fout: ${workerResp.status}`, details: workerBody }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (fetchErr) {
      console.error(`[analyze-cv] Cannot reach VPS:`, fetchErr);
      await adminClient
        .from("candidates")
        .update({ ai_status: 'failed' })
        .eq("id", candidate_id)
        .eq("organization_id", orgId);

      return new Response(
        JSON.stringify({ error: `Kan VPS niet bereiken: ${(fetchErr as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "CV analyse gestart. Resultaat verschijnt automatisch.",
        candidate_id,
        status: "analyzing",
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-cv] Error:", error);
    return new Response(
      JSON.stringify({ error: `Fout: ${(error as Error).message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
