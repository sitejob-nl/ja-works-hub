// Callback voor de async VPS-pijplijn (Ollama Qwen3 op Hetzner).
// Wordt door de VPS-worker aangeroepen na succesvolle of mislukte analyse.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage, writeCvAnalysisToCandidate } from "../_shared/cv-write.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function parseAnalysis(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return value;
    return JSON.parse(match[0]);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: VPS-worker authenticeert zich met OLLAMA_API_KEY
    const authHeader = req.headers.get("Authorization");
    const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");

    if (!authHeader || !OLLAMA_API_KEY || authHeader !== `Bearer ${OLLAMA_API_KEY}`) {
      console.error("[analyze-cv-callback] Invalid auth");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      candidate_id,
      organization_id,
      user_id,
      analysis,
      error: analysisError,
      model,
      duration_ms,
      tokens,
    } = body;

    if (!candidate_id || !organization_id) {
      return new Response(
        JSON.stringify({ error: "candidate_id en organization_id verplicht" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Failure-pad
    if (analysisError) {
      console.error(`[analyze-cv-callback] Analysis failed for ${candidate_id}: ${analysisError}`);
      await supabase
        .from("candidates")
        .update({ ai_status: "failed" })
        .eq("id", candidate_id)
        .eq("organization_id", organization_id);

      await supabase.from("audit_log").insert({
        organization_id,
        user_id: user_id || null,
        action: "update",
        table_name: "candidates",
        record_id: candidate_id,
        new_values: { ai_status: "failed", error: analysisError },
        reason: "AI CV-analyse mislukt (VPS)",
      });

      return new Response(JSON.stringify({ success: false, error: analysisError }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Success-pad — gemeenschappelijke write-helper
    console.log(`[analyze-cv-callback] Writing result for candidate=${candidate_id} org=${organization_id}`);

    let parsedAnalysis: unknown;
    try {
      parsedAnalysis = parseAnalysis(analysis);
    } catch (parseErr) {
      console.error("[analyze-cv-callback] Parse failed:", parseErr);
      await supabase
        .from("candidates")
        .update({ ai_status: "failed" })
        .eq("id", candidate_id)
        .eq("organization_id", organization_id);

      return new Response(
        JSON.stringify({ success: false, error: `Analyse-JSON ongeldig: ${(parseErr as Error).message}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      await writeCvAnalysisToCandidate(supabase, candidate_id, organization_id, parsedAnalysis as any);
    } catch (writeErr) {
      console.error("[analyze-cv-callback] Write failed:", writeErr);
      return new Response(
        JSON.stringify({ success: false, error: (writeErr as Error).message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Usage-log: VPS heeft cost_cents = 0 (gratis voor klant in v1)
    await logAiUsage(supabase, {
      organization_id,
      user_id: user_id || null,
      provider: "vps",
      model: model ?? "qwen3-14b",
      input_tokens: typeof tokens === "number" ? tokens : null,
      output_tokens: null,
      cost_cents: 0,
      candidate_id,
      duration_ms: typeof duration_ms === "number" ? duration_ms : null,
    });

    await supabase.from("audit_log").insert({
      organization_id,
      user_id: user_id || null,
      action: "update",
      table_name: "candidates",
      record_id: candidate_id,
      new_values: {
        ai_status: "completed",
        ai_reliability_score: (parsedAnalysis as any)?.samenvatting?.plaatsbaarheid_score,
        provider: "vps",
        model,
        duration_ms,
        tokens,
      },
      reason: "AI CV-analyse voltooid via VPS",
    });

    console.log(`[analyze-cv-callback] Done for ${candidate_id} (${duration_ms}ms, ${tokens} tokens)`);

    return new Response(
      JSON.stringify({ success: true, candidate_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[analyze-cv-callback] Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
