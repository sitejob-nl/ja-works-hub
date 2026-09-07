// CV-veldextractie voor het "nieuwe kandidaat"-formulier.
// Stateless: er bestaat nog geen candidate-rij. Neemt ruwe CV-tekst (client-side
// geëxtraheerd), stuurt die synchroon naar Gemini en geeft gestructureerde velden
// terug om het formulier vooraf in te vullen. Kosten worden vóór de call gereserveerd
// en samen met het verbruik in het gedeelde AI-grootboek afgerekend.
//
// NB: dit pad is NIET gepseudonimiseerd (we willen juist naam/adres terug). De
// kwalitatieve dossieranalyse (analyze-cv) blijft wél gepseudonimiseerd.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import { AiAccountingError } from "../_shared/ai-accounting.ts";
import { extractCvProfile } from "../_shared/cv-extract.ts";
import { GEMINI_DEFAULT_MODEL } from "../_shared/gemini-cv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const auth = await requireRolePermission(req, "candidates.edit", corsHeaders);
    if (auth instanceof Response) return auth;
    const user = auth.user;
    const orgId = auth.organizationId;

    const body = await req.json();
    const { cv_text, nationality_options, language_options, country_options } = body as {
      cv_text?: string;
      nationality_options?: string[];
      language_options?: string[];
      country_options?: string[];
    };

    if (!cv_text || cv_text.trim().length < 50) {
      return jsonResponse({ error: "CV-tekst is te kort om te analyseren (minimaal 50 tekens)" }, 400);
    }

    const nationalityCatalog = Array.isArray(nationality_options)
      ? nationality_options.filter((s) => typeof s === "string").slice(0, 300)
      : [];
    const languageCatalog = Array.isArray(language_options)
      ? language_options.filter((s) => typeof s === "string").slice(0, 200)
      : [];
    const countryCatalog = Array.isArray(country_options)
      ? country_options.filter((s) => typeof s === "string").slice(0, 300)
      : [];

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

    // Gemini-call (synchroon)
    let result;
    try {
      result = await extractCvProfile(cv_text, apiKey, {
        model,
        skillCatalog,
        nationalityCatalog,
        languageCatalog,
        countryCatalog,
      }, { admin, organizationId: orgId, userId: user.id, feature: "cv_field_extract", candidateId: null });
    } catch (e) {
      if (e instanceof AiAccountingError) return jsonResponse({ error: e.message, code: e.code, request_id: e.requestId, cost_cents: e.costCents, balance_cents: e.balanceCents }, e.status);
      const msg = (e as Error).message;
      console.error("[extract-cv-profile] Gemini-call mislukt:", msg);
      return jsonResponse({ error: `Automatisch invullen mislukt: ${msg}` }, 502);
    }

    return jsonResponse(
      {
        success: true,
        fields: result.fields,
        model: result.model,
        cost_cents: result.costCents,
        balance_cents: result.balanceCents,
        request_id: result.requestId,
        duration_ms: result.durationMs,
      },
      200,
    );
  } catch (error) {
    console.error("[extract-cv-profile] Error:", error);
    return jsonResponse({ error: `Fout: ${(error as Error).message}` }, 500);
  }
});
