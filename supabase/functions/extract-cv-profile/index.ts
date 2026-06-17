// CV-veldextractie voor het "nieuwe kandidaat"-formulier.
// Stateless: er bestaat nog geen candidate-rij. Neemt ruwe CV-tekst (client-side
// geëxtraheerd), stuurt die synchroon naar Gemini en geeft gestructureerde velden
// terug om het formulier vooraf in te vullen. Trekt ~1ct credits via consume_ai_credits.
//
// NB: dit pad is NIET gepseudonimiseerd (we willen juist naam/adres terug). De
// kwalitatieve dossieranalyse (analyze-cv) blijft wél gepseudonimiseerd.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractCvProfile } from "../_shared/cv-extract.ts";
import { calculateCostCents } from "../_shared/anthropic-cv.ts";
import { GEMINI_DEFAULT_MODEL, geminiPricingForModel } from "../_shared/gemini-cv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Synchrone Gemini-extractie is met de output-cap ~1ct/CV. Een kleine reservering
// volstaat en blokkeert orgs met klein saldo niet onnodig (mirror van analyze-cv).
const GEMINI_PREFLIGHT_RESERVATION_CENTS = 5;

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
    // --- Auth (self-auth: verify_jwt = false in config.toml) ---
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
    const { cv_text } = body as { cv_text?: string };

    if (!cv_text || cv_text.trim().length < 50) {
      return jsonResponse({ error: "CV-tekst is te kort om te analyseren (minimaal 50 tekens)" }, 400);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return jsonResponse(
        { error: "Automatisch invullen niet beschikbaar (GEMINI_API_KEY ontbreekt)" },
        500,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Model — org-setting > env > default
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();
    const orgSettings = (org?.settings as Record<string, unknown> | null) ?? {};
    const model = (typeof orgSettings.cv_ai_model === "string" && orgSettings.cv_ai_model) ||
      Deno.env.get("GEMINI_MODEL") ||
      GEMINI_DEFAULT_MODEL;

    // Org-vaardigheidscatalogus → het model tagt skills met EXACT deze termen,
    // zodat de formulier-skillpicker (die alleen catalogus-skills toont) ze herkent.
    const { data: orgSkills } = await admin
      .from("skills")
      .select("name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name");
    const skillCatalog = (orgSkills ?? []).map((s) => s.name as string).filter(Boolean);

    // Pre-flight: saldo checken
    const { data: credits } = await admin
      .from("organization_credits")
      .select("balance_cents")
      .eq("organization_id", orgId)
      .single();

    const balance = credits?.balance_cents ?? 0;
    if (balance < GEMINI_PREFLIGHT_RESERVATION_CENTS) {
      return jsonResponse(
        {
          error: "Saldo onvoldoende voor automatisch invullen",
          balance_cents: balance,
          required_cents: GEMINI_PREFLIGHT_RESERVATION_CENTS,
        },
        402,
      );
    }

    // Gemini-call (synchroon)
    let result;
    try {
      result = await extractCvProfile(cv_text, apiKey, { model, skillCatalog });
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[extract-cv-profile] Gemini-call mislukt:", msg);
      return jsonResponse({ error: `Automatisch invullen mislukt: ${msg}` }, 502);
    }

    const pricing = geminiPricingForModel(model);
    const costCents = calculateCostCents(
      result.inputTokens,
      result.outputTokens,
      pricing.inputCentsPerMtok,
      pricing.outputCentsPerMtok,
    );

    // Atomic decrement via RPC (race-safe met SELECT FOR UPDATE)
    const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", {
      p_org_id: orgId,
      p_amount_cents: costCents,
    });

    if (consumeErr) {
      console.error("[extract-cv-profile] consume_ai_credits RPC fout:", consumeErr);
      return jsonResponse({ error: "Saldo-afschrijving mislukt" }, 500);
    }

    const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
    if (!consume?.ok) {
      // Race: saldo viel tussentijds onder kosten. Niets afgeschreven.
      return jsonResponse(
        {
          error: "Saldo onvoldoende — automatisch invullen niet doorgegaan",
          balance_cents: consume?.new_balance_cents ?? 0,
          required_cents: costCents,
        },
        402,
      );
    }

    // Usage-log (best-effort; mag de flow nooit breken)
    try {
      await admin.from("ai_usage_log").insert({
        feature: "cv_field_extract",
        organization_id: orgId,
        user_id: user.id,
        provider: "gemini",
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_cents: costCents,
        candidate_id: null,
        duration_ms: result.durationMs,
      });
    } catch (e) {
      console.error("[extract-cv-profile] Kon ai_usage_log niet schrijven:", (e as Error).message);
    }

    return jsonResponse(
      {
        success: true,
        fields: result.fields,
        model: result.model,
        cost_cents: costCents,
        balance_cents: consume.new_balance_cents,
        duration_ms: result.durationMs,
      },
      200,
    );
  } catch (error) {
    console.error("[extract-cv-profile] Error:", error);
    return jsonResponse({ error: `Fout: ${(error as Error).message}` }, 500);
  }
});
