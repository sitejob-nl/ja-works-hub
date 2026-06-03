// Kandidaatdossier-analyse — twee providers:
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
import { analyzeWithGemini, GEMINI_DEFAULT_MODEL, geminiPricingForModel } from "../_shared/gemini-cv.ts";
import { logAiUsage, writeCvAnalysisToCandidate } from "../_shared/cv-write.ts";
import { sanitizeOrgPrompt } from "../_shared/sanitize-org-prompt.ts";
import { buildCandidateDossier } from "../_shared/candidate-dossier.ts";
import { buildVpsPrompt, CV_ANALYSIS_SCHEMA, CV_ANALYSIS_TOOL_NAME } from "../_shared/cv-prompt.ts";

type AiProvider = "vps" | "cloud" | "gemini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Pre-flight reservering: een synchrone analyse wordt geweigerd als saldo < dit bedrag.
// Cloud (Anthropic ~3 cent/CV) houdt een ruime 25-cent buffer aan. Gemini is met de
// maxOutputTokens-cap ~1 cent/dossier, dus een lagere drempel volstaat en blokkeert
// orgs met klein saldo niet onnodig.
const CLOUD_PREFLIGHT_RESERVATION_CENTS = 25;
const GEMINI_PREFLIGHT_RESERVATION_CENTS = 5;

// Max bestandsgrootte die we als VISION-input naar Gemini sturen. Boven dit punt slaan
// we het bestand over (Gemini-payloadlimiet + kosten). 10 MB.
const VISION_MAX_BYTES = 10 * 1024 * 1024;

// Base64-encoding zonder Node's Buffer (Deno edge runtime). btoa kan geen grote strings
// in één keer aan via String.fromCharCode(...arr) (stack-overflow), dus chunked.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// PRIVACY: de dossier-TEKST wordt gepseudonimiseerd, maar een meegestuurde CV-AFBEELDING
// kan NIET gepseudonimiseerd worden — de ruwe scan (incl. naam) gaat naar Google. Daarom
// stuurt buildCandidateDossier alleen visionFile voor CV-documenten (type 'cv' / CV-naam),
// nooit voor ID-bewijs/paspoort/rijbewijs e.d. Hier downloaden we die bytes.
// deno-lint-ignore no-explicit-any
async function loadVisionFileParts(
  admin: any,
  visionFile: { file_path: string; mimeType: string } | null,
): Promise<Array<{ mimeType: string; dataB64: string }>> {
  if (!visionFile) return [];
  try {
    const { data: blob, error } = await admin.storage.from("documents").download(visionFile.file_path);
    if (error || !blob) {
      console.warn(`[analyze-cv] VISION-bestand downloaden mislukt (${visionFile.file_path}): ${error?.message ?? "onbekend"}`);
      return [];
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > VISION_MAX_BYTES) {
      console.warn(`[analyze-cv] VISION-bestand te groot (${bytes.byteLength} bytes > ${VISION_MAX_BYTES}); overgeslagen`);
      return [];
    }
    return [{ mimeType: visionFile.mimeType, dataB64: bytesToBase64(bytes) }];
  } catch (e) {
    console.warn(`[analyze-cv] VISION-bestand verwerken mislukt: ${(e as Error).message}`);
    return [];
  }
}

function sanitizeDossierText(text: string): string {
  let clean = text;
  clean = clean.replace(/ignore (all |previous |above |prior )?instructions?/gi, "[REMOVED]");
  clean = clean.replace(/forget (all |previous |above |prior )?instructions?/gi, "[REMOVED]");
  clean = clean.replace(/you are now/gi, "[REMOVED]");
  clean = clean.replace(/new role:/gi, "[REMOVED]");
  clean = clean.replace(/system prompt/gi, "[REMOVED]");
  clean = clean.replace(/\[INST\]/gi, "[REMOVED]");
  clean = clean.replace(/<\|im_start\|>/gi, "[REMOVED]");
  clean = clean.replace(/<\|im_end\|>/gi, "[REMOVED]");
  if (clean.length > 28000) {
    clean = clean.substring(0, 28000) + "\n[Kandidaatdossier ingekort]";
  }
  return clean;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Geef het geanalyseerde document een nette naam + type 'cv'. Carerix-imports krijgen
// placeholder-namen (bv. "73481_462cb2aa") en type 'overig'; het document dat we als
// CV-bron gebruikten verdient een leesbare naam. We raken alleen placeholder-/lege namen
// aan (bestaande nette namen blijven) en zetten type alleen om als het nog niet 'cv' is.
async function relabelSelectedCvDocument(
  // deno-lint-ignore no-explicit-any
  admin: any,
  orgId: string,
  candidate: { first_name?: string | null; last_name?: string | null },
  selected: { id?: string; name?: string | null; type?: string | null; source?: string } | null | undefined,
): Promise<void> {
  if (!selected || selected.source !== "documents" || !selected.id) return;

  const updates: Record<string, unknown> = {};
  const isPlaceholder = !selected.name || /^\d+_[0-9a-f]+$/i.test(selected.name.trim());
  if (isPlaceholder) {
    const naam = [candidate.first_name, candidate.last_name]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(" ");
    updates.name = naam ? `CV – ${naam}` : "CV";
  }
  if (selected.type !== "cv") updates.type = "cv";
  if (Object.keys(updates).length === 0) return;

  try {
    await admin.from("documents").update(updates).eq("id", selected.id).eq("organization_id", orgId);
  } catch (e) {
    console.warn(`[analyze-cv] kon document-label niet bijwerken: ${(e as Error).message}`);
  }
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
    const { cv_text, candidate_id, provider: providerOverride, model: modelOverride } = body as {
      cv_text?: string;
      candidate_id?: string;
      provider?: AiProvider;
      model?: string;
    };

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
      .select("id, organization_id, ai_status, first_name, last_name, status, employee_status, source, cv_file_url, cv_raw_text, notes, availability_notes, skills, certifications, languages, address_city, address_country, has_drivers_license")
      .eq("id", candidate_id)
      .single();

    if (!candidate || candidate.organization_id !== orgId) {
      return jsonResponse({ error: "Kandidaat niet gevonden of geen toegang" }, 403);
    }

    if (candidate.ai_status === "analyzing") {
      return jsonResponse({ error: "Analyse loopt al voor deze kandidaat" }, 409);
    }

    // Org-settings ophalen (provider-keuze + optioneel prompt-addendum voor beide paden)
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();
    const orgSettings = (org?.settings as Record<string, unknown> | null) ?? {};

    // Bepaal provider — override > org-setting > default 'vps'
    let provider: AiProvider = "vps";
    if (providerOverride === "vps" || providerOverride === "cloud" || providerOverride === "gemini") {
      provider = providerOverride;
    } else if (orgSettings.cv_ai_provider === "cloud") {
      provider = "cloud";
    } else if (orgSettings.cv_ai_provider === "gemini") {
      provider = "gemini";
    }

    // Gemini-model — request > org-setting > env > default (alleen relevant bij provider 'gemini')
    const geminiModel = modelOverride ||
      (typeof orgSettings.cv_ai_model === "string" && orgSettings.cv_ai_model) ||
      Deno.env.get("GEMINI_MODEL") ||
      GEMINI_DEFAULT_MODEL;

    // Prompt-addendum. Server-side gesanitized en doorgegeven aan Cloud én VPS.
    const rawAddendum = typeof orgSettings.candidate_analysis_prompt === "string"
      ? orgSettings.candidate_analysis_prompt
      : typeof orgSettings.cv_prompt_addendum === "string"
      ? orgSettings.cv_prompt_addendum
      : "";
    const sanitizedAddendum = sanitizeOrgPrompt(rawAddendum);
    if (sanitizedAddendum.removed > 0 || sanitizedAddendum.truncated) {
      console.warn(
        `[analyze-cv] Org-prompt-addendum gesanitized voor org=${orgId}: ` +
          `removed=${sanitizedAddendum.removed} truncated=${sanitizedAddendum.truncated}`,
      );
    }

    // Org-vaardigheidscatalogus → de AI tagt skills met EXACT deze termen, zodat
    // candidate.skills aansluit op de vacature-vocabulaire (calculate-match/skill_aliases).
    let skillGuidance = "";
    const { data: orgSkills } = await admin
      .from("skills")
      .select("name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name");
    const skillNames = (orgSkills ?? []).map((s) => s.name as string).filter(Boolean);
    if (skillNames.length > 0) {
      skillGuidance =
        "STANDAARD VAARDIGHEIDSTERMEN VAN DEZE ORGANISATIE — gebruik EXACT deze schrijfwijze in " +
        "competenties.hard_skills wanneer de kandidaat de vaardigheid aantoonbaar heeft (verzin niets " +
        "en gebruik geen term zonder bewijs):\n" +
        skillNames.join(", ");
    }

    // Addendum naar de provider: gesanitized org-prompt + (vertrouwde) skills-gids.
    const promptAddendum = [sanitizedAddendum.text, skillGuidance]
      .filter((s) => s && s.trim().length > 0)
      .join("\n\n") || undefined;

    const dossier = await buildCandidateDossier(admin, candidate, { explicitCvText: cv_text });
    // Te weinig data → afwijzen, TENZIJ er een gescande CV (visionFile) is die Gemini kan lezen.
    if (dossier.dossierText.trim().length < 80 && !dossier.visionFile) {
      return jsonResponse({ error: "Te weinig kandidaatdata om te analyseren" }, 400);
    }

    // Status + ruwe documenttekst alvast wegschrijven (gemeenschappelijk voor beide paden)
    await admin
      .from("candidates")
      .update({
        ai_status: "analyzing",
        cv_raw_text: dossier.cvText || cv_text || candidate.cv_raw_text || null,
        cv_has_photo: dossier.hasPhoto,
      })
      .eq("id", candidate_id)
      .eq("organization_id", orgId);

    const sanitized = sanitizeDossierText(dossier.dossierText);
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
    // SYNCHRONE CREDIT-PADEN — Cloud (Anthropic) of Gemini (Google)
    // Beide: synchroon, trekken credits, schrijven direct weg (geen callback).
    // ===========================================================
    if (provider === "cloud" || provider === "gemini") {
      const isGemini = provider === "gemini";
      const apiKey = isGemini
        ? Deno.env.get("GEMINI_API_KEY")
        : Deno.env.get("ANTHROPIC_API_KEY");
      const keyName = isGemini ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";

      if (!apiKey) {
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        return jsonResponse(
          { error: `${isGemini ? "Gemini" : "Cloud"}-provider niet geconfigureerd (${keyName} ontbreekt)` },
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
      // Gemini-tarieven volgen het gekozen model; Cloud volgt de org-credit-tarieven.
      const geminiPricing = geminiPricingForModel(geminiModel);
      const pricingIn = isGemini
        ? geminiPricing.inputCentsPerMtok
        : (credits?.pricing_input_cents_per_mtok ?? 270);
      const pricingOut = isGemini
        ? geminiPricing.outputCentsPerMtok
        : (credits?.pricing_output_cents_per_mtok ?? 1350);
      const reservationCents = isGemini
        ? GEMINI_PREFLIGHT_RESERVATION_CENTS
        : CLOUD_PREFLIGHT_RESERVATION_CENTS;

      if (balance < reservationCents) {
        await admin.from("candidates").update({ ai_status: null }).eq("id", candidate_id);
        return jsonResponse(
          {
            error: "Saldo onvoldoende voor AI-analyse",
            balance_cents: balance,
            required_cents: reservationCents,
          },
          402,
        );
      }

      // VISION-fallback alleen op het Gemini-pad: gescand/foto-CV (of tekstloze PDF)
      // als inline bestand meesturen. Anthropic-pad blijft tekst-only (ongemoeid).
      const visionParts = isGemini
        ? await loadVisionFileParts(admin, dossier.visionFile)
        : [];

      // Provider-call (synchroon) — met optioneel gesanitized org-addendum
      let result;
      try {
        result = isGemini
          ? await analyzeWithGemini(
            pseudonymized,
            apiKey,
            promptAddendum,
            { model: geminiModel, fileParts: visionParts.length > 0 ? visionParts : undefined },
          )
          : await analyzeWithAnthropic(
            pseudonymized,
            apiKey,
            promptAddendum,
          );
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[analyze-cv] ${provider}-call mislukt:`, msg);
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        // Return 200 with error in body — anders verstopt Supabase functions-js
        // de body achter een FunctionsHttpError en zie je alleen "non-2xx".
        return jsonResponse(
          {
            success: false,
            error: `${isGemini ? "Gemini" : "Cloud"}-analyse mislukt: ${msg}`,
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

      // Geef het geanalyseerde (CV-)document meteen een nette naam + type 'cv'.
      await relabelSelectedCvDocument(admin, orgId, candidate, dossier.selectedDocument);

      // Audit + usage-log
      await logAiUsage(admin, {
        organization_id: orgId,
        user_id: user.id,
        provider,
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
          provider,
          model: result.model,
          tokens_in: result.inputTokens,
          tokens_out: result.outputTokens,
          cost_cents: costCents,
          duration_ms: result.durationMs,
          dossier_meta: {
            selected_document: dossier.selectedDocument,
            warnings: dossier.warnings,
            counts: dossier.counts,
          },
        },
        reason: isGemini
          ? `AI kandidaatdossier-analyse voltooid via Gemini (${result.model})`
          : "AI kandidaatdossier-analyse voltooid via Cloud (Anthropic Haiku)",
      });

      return jsonResponse(
        {
          success: true,
          status: "completed",
          provider,
          model: result.model,
          candidate_id,
          balance_cents: consume.new_balance_cents,
          cost_cents: costCents,
          duration_ms: result.durationMs,
          dossier_meta: {
            selected_document: dossier.selectedDocument,
            warnings: dossier.warnings,
            counts: dossier.counts,
          },
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
    const vpsPrompt = buildVpsPrompt(promptAddendum);

    console.log(`[analyze-cv] VPS-call candidate=${candidate_id} org=${orgId}`);

    try {
      const workerResp = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({
          // Backwards compatible: de huidige VPS-worker leest cv_text.
          // Inhoud is voortaan het volledige gepseudonimiseerde kandidaatdossier.
          cv_text: pseudonymized,
          dossier_text: pseudonymized,
          system_prompt: vpsPrompt,
          prompt_addendum: sanitizedAddendum.text || null,
          prompt_version: "candidate_dossier_v2",
          tool_name: CV_ANALYSIS_TOOL_NAME,
          analysis_schema: CV_ANALYSIS_SCHEMA,
          input_meta: {
            selected_document: dossier.selectedDocument,
            warnings: dossier.warnings,
            counts: dossier.counts,
            has_photo: dossier.hasPhoto,
          },
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
        dossier_meta: {
          selected_document: dossier.selectedDocument,
          warnings: dossier.warnings,
          counts: dossier.counts,
        },
        message: "Kandidaatdossier-analyse gestart. Resultaat verschijnt automatisch.",
      },
      202,
    );
  } catch (error) {
    console.error("[analyze-cv] Error:", error);
    return jsonResponse({ error: `Fout: ${(error as Error).message}` }, 500);
  }
});
