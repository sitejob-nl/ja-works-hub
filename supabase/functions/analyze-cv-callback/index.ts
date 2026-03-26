import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: verify this request comes from our VPS worker via OLLAMA_API_KEY
    const authHeader = req.headers.get("Authorization");
    const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");

    if (!authHeader || !OLLAMA_API_KEY || authHeader !== `Bearer ${OLLAMA_API_KEY}`) {
      console.error("[analyze-cv-callback] Invalid auth");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { candidate_id, organization_id, user_id, analysis, error: analysisError, model, duration_ms, tokens } = body;

    if (!candidate_id || !organization_id) {
      return new Response(
        JSON.stringify({ error: "candidate_id en organization_id verplicht" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Handle failure
    if (analysisError) {
      console.error(`[analyze-cv-callback] Analysis failed for ${candidate_id}: ${analysisError}`);
      await supabase
        .from("candidates")
        .update({ ai_status: 'failed' })
        .eq("id", candidate_id)
        .eq("organization_id", organization_id);

      await supabase.from("audit_log").insert({
        organization_id,
        user_id: user_id || null,
        action: "update",
        table_name: "candidates",
        record_id: candidate_id,
        new_values: { ai_status: 'failed', error: analysisError },
        reason: "AI CV-analyse mislukt",
      });

      return new Response(JSON.stringify({ success: false, error: analysisError }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle success: write analysis to candidate
    console.log(`[analyze-cv-callback] Writing result for candidate=${candidate_id} org=${organization_id}`);

    const { error: updateError } = await supabase
      .from("candidates")
      .update({
        ai_analysis: analysis,
        ai_analyzed_at: new Date().toISOString(),
        ai_status: 'completed',
        ai_reliability_score: analysis?.samenvatting?.plaatsbaarheid_score || null,
        ai_function_group: analysis?.doelgroep?.functies?.[0] || null,
        ai_classification: analysis?.eigenschappen?.specialisatie === 'specialist' ? 'specialist' : 'productie',
        ai_interview_questions: analysis?.plaatsingsadvies?.interviewvragen || [],
        ai_risk_factors: analysis?.plaatsingsadvies?.risicos || [],
        ai_summary: analysis?.samenvatting?.profiel || null,
      })
      .eq("id", candidate_id)
      .eq("organization_id", organization_id);

    if (updateError) {
      console.error(`[analyze-cv-callback] DB error:`, updateError);
      return new Response(JSON.stringify({ success: false, error: updateError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit log
    await supabase.from("audit_log").insert({
      organization_id,
      user_id: user_id || null,
      action: "update",
      table_name: "candidates",
      record_id: candidate_id,
      new_values: {
        ai_status: 'completed',
        ai_reliability_score: analysis?.samenvatting?.plaatsbaarheid_score,
        model,
        duration_ms,
        tokens,
      },
      reason: "AI CV-analyse voltooid via VPS/LLM",
    });

    console.log(`[analyze-cv-callback] Done for ${candidate_id} (${duration_ms}ms, ${tokens} tokens)`);

    return new Response(
      JSON.stringify({ success: true, candidate_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-cv-callback] Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
