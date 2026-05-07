// CV-analyse — twee providers:
//   1. VPS (Ollama Qwen3 op Hetzner) — async, callback komt 1-3 min later terug
//      op analyze-cv-callback. Gratis voor klant.
//   2. Cloud (Anthropic Claude Haiku 4.5) — synchroon, ~5-10s. Trekt credits.
//
// Provider-keuze:
//   - body.provider override ('vps' | 'cloud')
//   - anders organizations.settings.cv_ai_provider
//   - default 'vps'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pseudonymizeCv } from "../_shared/cv-pseudonymize.ts";
import { analyzeWithAnthropic, calculateCostCents } from "../_shared/anthropic-cv.ts";
import { logAiUsage, writeCvAnalysisToCandidate } from "../_shared/cv-write.ts";
import { sanitizeOrgPrompt } from "../_shared/sanitize-org-prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Pre-flight reservering: Cloud-call wordt geweigerd als saldo < dit bedrag.
// 25 cent dekt ruim de ~3 cent per gemiddelde CV en voorkomt dat een grote CV
// na de Anthropic-call alsnog blokkeert door net-niet-genoeg saldo.
const CLOUD_PREFLIGHT_RESERVATION_CENTS = 25;

function sanitizeCvText(text: string): string {
  let clean = text;
  clean = clean.replace(/ignore (all |previous |above |prior )?instructions?/gi, "[REMOVED]");
  clean = clean.replace(/forget (all |previous |above |prior )?instructions?/gi, "[REMOVED]");
  clean = clean.replace(/you are now/gi, "[REMOVED]");
  clean = clean.replace(/new role:/gi, "[REMOVED]");
  clean = clean.replace(/system prompt/gi, "[REMOVED]");
  clean = clean.replace(/\[INST\]/gi, "[REMOVED]");
  clean = clean.replace(/<\|im_start\|>/gi, "[REMOVED]");
  clean = clean.replace(/<\|im_end\|>/gi, "[REMOVED]");
  if (clean.length > 15000) {
    clean = clean.substring(0, 15000) + "\n[CV tekst ingekort]";
  }
  return clean;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Niet geautoriseerd" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Ongeldige sessie" }, 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile?.organization_id) {
      return jsonResponse({ error: "Geen organisatie" }, 403);
    }

    const orgId = profile.organization_id as string;
    const body = await req.json();
    const { cv_text, candidate_id, provider: providerOverride } = body as {
      cv_text?: string;
      candidate_id?: string;
      provider?: "vps" | "cloud";
    };

    if (!cv_text || cv_text.trim().length < 50) {
      return jsonResponse({ error: "CV tekst te kort (min 50 tekens)" }, 400);
    }
    if (!candidate_id) {
      return jsonResponse({ error: "candidate_id is verplicht" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Candidate ophalen + tenant-check
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, organization_id, ai_status, first_name, last_name")
      .eq("id", candidate_id)
      .single();

    if (!candidate || candidate.organization_id !== orgId) {
      return jsonResponse({ error: "Kandidaat niet gevonden of geen toegang" }, 403);
    }

    if (candidate.ai_status === "analyzing") {
      return jsonResponse({ error: "Analyse loopt al voor deze kandidaat" }, 409);
    }

    // Org-settings ophalen (provider-keuze + optioneel prompt-addendum voor Cloud-pad)
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();
    const orgSettings = (org?.settings as Record<string, unknown> | null) ?? {};

    // Bepaal provider — override > org-setting > default 'vps'
    let provider: "vps" | "cloud" = "vps";
    if (providerOverride === "vps" || providerOverride === "cloud") {
      provider = providerOverride;
    } else if (orgSettings.cv_ai_provider === "cloud") {
      provider = "cloud";
    }

    // Prompt-addendum (alleen relevant voor Cloud-pad). Server-side gesanitized.
    const rawAddendum = typeof orgSettings.cv_prompt_addendum === "string"
      ? orgSettings.cv_prompt_addendum
      : "";
    const sanitizedAddendum = sanitizeOrgPrompt(rawAddendum);
    if (sanitizedAddendum.removed > 0 || sanitizedAddendum.truncated) {
      console.warn(
        `[analyze-cv] Org-prompt-addendum gesanitized voor org=${orgId}: ` +
          `removed=${sanitizedAddendum.removed} truncated=${sanitizedAddendum.truncated}`,
      );
    }

    // Status + raw text alvast wegschrijven (gemeenschappelijk voor beide paden)
    await admin
      .from("candidates")
      .update({ ai_status: "analyzing", cv_raw_text: cv_text })
      .eq("id", candidate_id)
      .eq("organization_id", orgId);

    const sanitized = sanitizeCvText(cv_text);
    const { text: pseudonymized, meta: pseudoMeta } = pseudonymizeCv(sanitized, {
      first_name: candidate.first_name,
      last_name: candidate.last_name,
    });

    await admin
      .from("candidates")
      .update({
        cv_pseudonymized_at: new Date().toISOString(),
        cv_pseudonymization_meta: pseudoMeta,
      })
      .eq("id", candidate_id)
      .eq("organization_id", orgId);

    // ===========================================================
    // CLOUD-PAD — synchroon, trekt credits
    // ===========================================================
    if (provider === "cloud") {
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
      if (!ANTHROPIC_API_KEY) {
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        return jsonResponse(
          { error: "Cloud-provider niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)" },
          500,
        );
      }

      // Pre-flight: saldo checken
      const { data: credits } = await admin
        .from("organization_credits")
        .select("balance_cents, pricing_input_cents_per_mtok, pricing_output_cents_per_mtok")
        .eq("organization_id", orgId)
        .single();

      const balance = credits?.balance_cents ?? 0;
      const pricingIn = credits?.pricing_input_cents_per_mtok ?? 270;
      const pricingOut = credits?.pricing_output_cents_per_mtok ?? 1350;

      if (balance < CLOUD_PREFLIGHT_RESERVATION_CENTS) {
        await admin.from("candidates").update({ ai_status: null }).eq("id", candidate_id);
        return jsonResponse(
          {
            error: "Saldo onvoldoende voor Cloud-analyse",
            balance_cents: balance,
            required_cents: CLOUD_PREFLIGHT_RESERVATION_CENTS,
          },
          402,
        );
      }

      // Anthropic-call (synchroon) — met optioneel gesanitized org-addendum
      let result;
      try {
        result = await analyzeWithAnthropic(
          pseudonymized,
          ANTHROPIC_API_KEY,
          sanitizedAddendum.text || undefined,
        );
      } catch (e) {
        const msg = (e as Error).message;
        console.error("[analyze-cv] Anthropic-call mislukt:", msg);
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        // Return 200 with error in body — anders verstopt Supabase functions-js
        // de body achter een FunctionsHttpError en zie je alleen "non-2xx".
        return jsonResponse(
          {
            success: false,
            error: `Cloud-analyse mislukt: ${msg}`,
            detail: msg,
          },
          200,
        );
      }

      const costCents = calculateCostCents(
        result.inputTokens,
        result.outputTokens,
        pricingIn,
        pricingOut,
      );

      // Atomic decrement via RPC (race-safe met SELECT FOR UPDATE)
      const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", {
        p_org_id: orgId,
        p_amount_cents: costCents,
      });

      if (consumeErr) {
        console.error("[analyze-cv] consume_ai_credits RPC fout:", consumeErr);
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        return jsonResponse({ error: "Saldo-afschrijving mislukt" }, 500);
      }

      // RPC returnt array van { ok, new_balance_cents }
      const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
      if (!consume?.ok) {
        // Race: saldo viel in de tussentijd onder kosten. Niets afschrijven, niets schrijven.
        await admin.from("candidates").update({ ai_status: null }).eq("id", candidate_id);
        return jsonResponse(
          {
            error: "Saldo onvoldoende — analyse niet doorgegaan, geen kosten in rekening gebracht",
            balance_cents: consume?.new_balance_cents ?? 0,
            required_cents: costCents,
          },
          402,
        );
      }

      // Schrijf resultaat naar candidate
      await writeCvAnalysisToCandidate(admin, candidate_id, orgId, result.analysis);

      // Audit + usage-log
      await logAiUsage(admin, {
        organization_id: orgId,
        user_id: user.id,
        provider: "cloud",
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_cents: costCents,
        candidate_id,
        duration_ms: result.durationMs,
      });

      await admin.from("audit_log").insert({
        organization_id: orgId,
        user_id: user.id,
        action: "update",
        table_name: "candidates",
        record_id: candidate_id,
        new_values: {
          ai_status: "completed",
          provider: "cloud",
          model: result.model,
          tokens_in: result.inputTokens,
          tokens_out: result.outputTokens,
          cost_cents: costCents,
          duration_ms: result.durationMs,
        },
        reason: "AI CV-analyse voltooid via Cloud (Anthropic Haiku)",
      });

      return jsonResponse(
        {
          success: true,
          status: "completed",
          provider: "cloud",
          candidate_id,
          balance_cents: consume.new_balance_cents,
          cost_cents: costCents,
          duration_ms: result.durationMs,
        },
        200,
      );
    }

    // ===========================================================
    // VPS-PAD — async, callback verwerkt het resultaat
    // ===========================================================
    const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL");
    const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");

    if (!OLLAMA_BASE_URL || !OLLAMA_API_KEY) {
      await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
      return jsonResponse(
        { error: "VPS niet geconfigureerd (OLLAMA_BASE_URL/OLLAMA_API_KEY ontbreekt)" },
        500,
      );
    }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-cv-callback`;
    const workerUrl = `${OLLAMA_BASE_URL}/analyze`;

    console.log(`[analyze-cv] VPS-call candidate=${candidate_id} org=${orgId}`);

    try {
      const workerResp = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({
          cv_text: pseudonymized,
          candidate_id,
          organization_id: orgId,
          user_id: user.id,
          callback_url: callbackUrl,
        }),
      });

      if (!workerResp.ok) {
        const errBody = await workerResp.text();
        console.error(`[analyze-cv] Worker rejected: ${workerResp.status} ${errBody}`);
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        return jsonResponse(
          { error: `VPS worker fout: ${workerResp.status}`, details: errBody },
          502,
        );
      }
    } catch (fetchErr) {
      console.error(`[analyze-cv] Cannot reach VPS:`, fetchErr);
      await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
      return jsonResponse(
        { error: `Kan VPS niet bereiken: ${(fetchErr as Error).message}` },
        502,
      );
    }

    return jsonResponse(
      {
        success: true,
        status: "analyzing",
        provider: "vps",
        candidate_id,
        message: "CV analyse gestart. Resultaat verschijnt automatisch.",
      },
      202,
    );
  } catch (error) {
    console.error("[analyze-cv] Error:", error);
    return jsonResponse({ error: `Fout: ${(error as Error).message}` }, 500);
  }
});
