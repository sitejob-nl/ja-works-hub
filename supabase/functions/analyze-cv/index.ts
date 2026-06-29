// Kandidaatdossier-analyse — draait UITSLUITEND op Gemini (synchroon, ~10s, trekt credits).
//
// De oudere alternatieve routes zijn uitgefaseerd: de async default liet kandidaten
// minutenlang op 'analyzing' hangen. Gemini is de enige screeningprovider.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pseudonymizeCv } from "../_shared/cv-pseudonymize.ts";
import { calculateCostCents } from "../_shared/anthropic-cv.ts";
import { analyzeWithGemini, GEMINI_DEFAULT_MODEL, geminiPricingForModel } from "../_shared/gemini-cv.ts";
import { logAiUsage, writeCvAnalysisToCandidate } from "../_shared/cv-write.ts";
import { sanitizeOrgPrompt } from "../_shared/sanitize-org-prompt.ts";
import { buildCandidateDossier } from "../_shared/candidate-dossier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Pre-flight reservering: een analyse wordt geweigerd als saldo < dit bedrag.
// Gemini is met de maxOutputTokens-cap ~1 cent/dossier, dus een lage drempel volstaat
// en blokkeert orgs met klein saldo niet onnodig.
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
    const { cv_text, candidate_id, model: modelOverride } = body as {
      cv_text?: string;
      candidate_id?: string;
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
      .select("id, organization_id, ai_status, first_name, last_name, status, employee_status, source, cv_file_url, cv_raw_text, notes, available_from, available_until, arrival_date, availability_notes, skills, certifications, languages, address_city, address_country, has_drivers_license, screening_data")
      .eq("id", candidate_id)
      .single();

    if (!candidate || candidate.organization_id !== orgId) {
      return jsonResponse({ error: "Kandidaat niet gevonden of geen toegang" }, 403);
    }

    if (candidate.ai_status === "analyzing") {
      return jsonResponse({ error: "Analyse loopt al voor deze kandidaat" }, 409);
    }

    // Org-settings ophalen voor het optionele prompt-addendum en Gemini-model.
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();
    const orgSettings = (org?.settings as Record<string, unknown> | null) ?? {};

    // Screening draait uitsluitend op Gemini.
    const provider = "gemini";

    // Gemini-model — request > org-setting > env > default
    const geminiModel = modelOverride ||
      (typeof orgSettings.cv_ai_model === "string" && orgSettings.cv_ai_model) ||
      Deno.env.get("GEMINI_MODEL") ||
      GEMINI_DEFAULT_MODEL;

    // Prompt-addendum. Server-side gesanitized en doorgegeven aan Gemini.
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
        "competenties.hard_skills[].vaardigheid wanneer de kandidaat de vaardigheid aantoonbaar heeft. " +
        "Verzin niets en neem een term ALLEEN op met een letterlijk bewijsfragment uit het dossier in het bewijs-veld; " +
        "geen bewijs = niet opnemen:\n" +
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

    // Status + ruwe documenttekst alvast wegschrijven.
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
    // SYNCHROON GEMINI-PAD — trekt credits en schrijft direct weg (geen callback).
    // ===========================================================
    {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) {
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        return jsonResponse(
          { error: "Gemini-provider niet geconfigureerd (GEMINI_API_KEY ontbreekt)" },
          500,
        );
      }

      // Pre-flight: saldo checken
      const { data: credits } = await admin
        .from("organization_credits")
        .select("balance_cents")
        .eq("organization_id", orgId)
        .single();

      const balance = credits?.balance_cents ?? 0;
      const geminiPricing = geminiPricingForModel(geminiModel);
      const pricingIn = geminiPricing.inputCentsPerMtok;
      const pricingOut = geminiPricing.outputCentsPerMtok;
      const reservationCents = GEMINI_PREFLIGHT_RESERVATION_CENTS;

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

      // VISION: gescand/foto-CV (of tekstloze PDF) als inline bestand meesturen naar Gemini.
      const visionParts = await loadVisionFileParts(admin, dossier.visionFile);

      // Gemini-call (synchroon) — met optioneel gesanitized org-addendum
      let result;
      try {
        result = await analyzeWithGemini(
          pseudonymized,
          apiKey,
          promptAddendum,
          { model: geminiModel, fileParts: visionParts.length > 0 ? visionParts : undefined },
        );
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[analyze-cv] Gemini-call mislukt:`, msg);
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", candidate_id);
        // Return 200 with error in body — anders verstopt Supabase functions-js
        // de body achter een FunctionsHttpError en zie je alleen "non-2xx".
        return jsonResponse(
          {
            success: false,
            error: `Gemini-analyse mislukt: ${msg}`,
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

      // Schrijf resultaat naar candidate. dossierText = exact de (gepseudonimiseerde) tekst
      // die het model zag → grounding-filter verifieert bewijsfragmenten daartegen.
      await writeCvAnalysisToCandidate(admin, candidate_id, orgId, result.analysis, {
        dossierText: pseudonymized,
      });

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
        reason: `AI kandidaatdossier-analyse voltooid via Gemini (${result.model})`,
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
  } catch (error) {
    console.error("[analyze-cv] Error:", error);
    return jsonResponse({ error: `Fout: ${(error as Error).message}` }, 500);
  }
});
