// Batch backfill voor AI kandidaatdossier-analyse.
//
// Twee modi (body.provider):
//   - 'vps'              → async: per kandidaat dossier → VPS-worker, callback verwerkt het. (gratis)
//   - 'gemini' | 'cloud' → synchroon: per kandidaat dossier → Gemini/Anthropic, direct wegschrijven
//                          + credits afschrijven. Self-triggerend met lichte concurrency.
//
// Auth: org-admin (eigen org), superadmin (org via body), of service-role (self-trigger, org via body).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pseudonymizeCv } from "../_shared/cv-pseudonymize.ts";
import { buildCandidateDossier, type CandidateForDossier } from "../_shared/candidate-dossier.ts";
import { sanitizeOrgPrompt } from "../_shared/sanitize-org-prompt.ts";
import { buildVpsPrompt, CV_ANALYSIS_SCHEMA, CV_ANALYSIS_TOOL_NAME } from "../_shared/cv-prompt.ts";
import { analyzeWithGemini, GEMINI_DEFAULT_MODEL, geminiPricingForModel } from "../_shared/gemini-cv.ts";
import { analyzeWithAnthropic, calculateCostCents } from "../_shared/anthropic-cv.ts";
import { logAiUsage, writeCvAnalysisToCandidate } from "../_shared/cv-write.ts";
import { internalFunctionHeaders, isServiceRoleRequest } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AiProvider = "vps" | "cloud" | "gemini";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
const VPS_THROTTLE_MS = 1500;
// Synchrone modus: aantal Gemini/Anthropic-calls dat we parallel laten lopen.
// NB: de preflight-saldocheck is per kandidaat, niet over de chunk — op de saldo-rand
// kunnen tot SYNC_CONCURRENCY-1 betaalde provider-calls plaatsvinden zonder dat er
// credit voor wordt afgeschreven (consume_ai_credits is wél race-safe → geen overdraft).
// Bewust geaccepteerd: ~enkele centen, hooguit één keer per uitgeputte run.
const SYNC_CONCURRENCY = 4;
// Soft deadline waarna we self-triggeren (edge runtime wall-clock ~150s).
const SOFT_DEADLINE_MS = 70_000;
// Kandidaten die langer dan dit in 'analyzing' staan zijn van een gekilde run; resetten.
const STALE_ANALYZING_MS = 15 * 60 * 1000;
// Preflight-reservering (zie analyze-cv): Gemini ~1ct/dossier, Cloud duurder.
const GEMINI_PREFLIGHT_RESERVATION_CENTS = 5;
const CLOUD_PREFLIGHT_RESERVATION_CENTS = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BatchResult {
  candidate_id: string;
  status: "queued" | "completed" | "skipped" | "failed";
  reason?: string;
  cost_cents?: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Max bestandsgrootte die we als VISION-input naar Gemini sturen (Gemini-payloadlimiet
// + kosten). 10 MB. Identiek aan analyze-cv.
const VISION_MAX_BYTES = 10 * 1024 * 1024;

// Base64 zonder Node's Buffer (Deno edge runtime). Chunked i.v.m. stack-overflow bij
// String.fromCharCode(...grote-array). Identiek aan analyze-cv.
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
// levert buildCandidateDossier alleen visionFile voor CV-documenten (type 'cv' / CV-naam),
// nooit voor ID-bewijs/paspoort/rijbewijs e.d.
async function loadVisionFileParts(
  admin: Admin,
  visionFile: { file_path: string; mimeType: string } | null,
): Promise<Array<{ mimeType: string; dataB64: string }>> {
  if (!visionFile) return [];
  try {
    const { data: blob, error } = await admin.storage.from("documents").download(visionFile.file_path);
    if (error || !blob) {
      console.warn(`[analyze-cv-batch] VISION-bestand downloaden mislukt (${visionFile.file_path}): ${error?.message ?? "onbekend"}`);
      return [];
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > VISION_MAX_BYTES) {
      console.warn(`[analyze-cv-batch] VISION-bestand te groot (${bytes.byteLength} bytes > ${VISION_MAX_BYTES}); overgeslagen`);
      return [];
    }
    return [{ mimeType: visionFile.mimeType, dataB64: bytesToBase64(bytes) }];
  } catch (e) {
    console.warn(`[analyze-cv-batch] VISION-bestand verwerken mislukt: ${(e as Error).message}`);
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
  if (clean.length > 28000) clean = clean.slice(0, 28000) + "\n[Kandidaatdossier ingekort]";
  return clean;
}

function hasAnalyzableContent(
  candidate: CandidateForDossier,
  dossier: Awaited<ReturnType<typeof buildCandidateDossier>>,
): boolean {
  return Boolean(
    dossier.visionFile || // gescande CV (afbeelding/PDF) → Gemini-vision leest 'm alsnog
      (dossier.cvText && dossier.cvText.trim().length >= 50) ||
      (candidate.notes && candidate.notes.trim().length >= 20) ||
      dossier.counts.notes > 0 ||
      dossier.counts.communications > 0 ||
      dossier.counts.placements > 0 ||
      dossier.counts.employments > 0,
  );
}

function candidateSelect() {
  return [
    "id", "organization_id", "ai_status", "first_name", "last_name", "status",
    "employee_status", "source", "cv_file_url", "cv_raw_text", "notes", "screening_data",
    "available_from", "available_until", "arrival_date", "availability_notes", "skills", "certifications", "languages",
    "address_city", "address_country", "has_drivers_license",
  ].join(", ");
}

// deno-lint-ignore no-explicit-any
type Admin = any;

// Org-prompt-addendum + dynamische skills-catalogus (zoals analyze-cv) + cv_ai_model, per org.
async function buildOrgPrompt(admin: Admin, orgId: string): Promise<{ addendum: string; vpsPrompt: string; cvAiModel: string | null }> {
  const { data: org } = await admin.from("organizations").select("settings").eq("id", orgId).single();
  const settings = (org?.settings as Record<string, unknown> | null) ?? {};
  const rawAddendum = typeof settings.candidate_analysis_prompt === "string"
    ? settings.candidate_analysis_prompt
    : typeof settings.cv_prompt_addendum === "string"
    ? settings.cv_prompt_addendum
    : "";
  const sanitized = sanitizeOrgPrompt(rawAddendum);

  let skillGuidance = "";
  const { data: orgSkills } = await admin
    .from("skills").select("name").eq("organization_id", orgId).eq("is_active", true).order("name");
  const skillNames = (orgSkills ?? []).map((s: { name: string }) => s.name).filter(Boolean);
  if (skillNames.length > 0) {
    skillGuidance =
      "STANDAARD VAARDIGHEIDSTERMEN VAN DEZE ORGANISATIE — gebruik EXACT deze schrijfwijze in " +
      "competenties.hard_skills wanneer de kandidaat de vaardigheid aantoonbaar heeft (verzin niets " +
      "en gebruik geen term zonder bewijs):\n" + skillNames.join(", ");
  }
  const addendum = [sanitized.text, skillGuidance].filter((s) => s && s.trim().length > 0).join("\n\n");
  const cvAiModel = typeof settings.cv_ai_model === "string" && settings.cv_ai_model ? settings.cv_ai_model : null;
  return { addendum, vpsPrompt: buildVpsPrompt(addendum || undefined), cvAiModel };
}

// Relabel het als CV gebruikte document (placeholder → "CV – Naam" + type cv). Zelfde als analyze-cv.
async function relabelSelectedCvDocument(
  admin: Admin,
  orgId: string,
  candidate: { first_name?: string | null; last_name?: string | null },
  selected: { id?: string; name?: string | null; type?: string | null; source?: string } | null | undefined,
): Promise<void> {
  if (!selected || selected.source !== "documents" || !selected.id) return;
  const updates: Record<string, unknown> = {};
  const isPlaceholder = !selected.name || /^[0-9]+_[0-9a-f]+$/i.test((selected.name ?? "").trim());
  if (isPlaceholder) {
    const naam = [candidate.first_name, candidate.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
    updates.name = naam ? `CV – ${naam}` : "CV";
  }
  if (selected.type !== "cv") updates.type = "cv";
  if (Object.keys(updates).length === 0) return;
  try {
    await admin.from("documents").update(updates).eq("id", selected.id).eq("organization_id", orgId);
  } catch (e) {
    console.warn(`[analyze-cv-batch] doc-relabel mislukt: ${(e as Error).message}`);
  }
}

interface SyncCtx {
  provider: "gemini" | "cloud";
  model: string;
  apiKey: string;
  addendum: string;
  pricingIn: number;
  pricingOut: number;
  reservationCents: number;
  userId: string | null;
}

// Eén synchrone kandidaat: status + (bij saldo-op) een stopsignaal.
async function processCandidateSync(admin: Admin, c: CandidateForDossier, ctx: SyncCtx): Promise<BatchResult & { stop?: boolean }> {
  try {
    const dossier = await buildCandidateDossier(admin, c);
    if (!hasAnalyzableContent(c, dossier)) {
      await admin.from("candidates").update({ ai_status: "failed", cv_has_photo: dossier.hasPhoto })
        .eq("id", c.id).eq("organization_id", c.organization_id);
      return { candidate_id: c.id, status: "skipped", reason: "geen analyseerbare CV/notitiecontext" };
    }

    // Preflight saldo.
    const { data: credits } = await admin.from("organization_credits")
      .select("balance_cents").eq("organization_id", c.organization_id).single();
    if ((credits?.balance_cents ?? 0) < ctx.reservationCents) {
      return { candidate_id: c.id, status: "failed", reason: "saldo onvoldoende", stop: true };
    }

    const sanitized = sanitizeDossierText(dossier.dossierText);
    const { text: pseudo, meta: pseudoMeta } = pseudonymizeCv(sanitized, {
      first_name: c.first_name, last_name: c.last_name,
    });

    await admin.from("candidates").update({
      ai_status: "analyzing",
      cv_raw_text: dossier.cvText || c.cv_raw_text || null,
      cv_has_photo: dossier.hasPhoto,
      cv_pseudonymized_at: new Date().toISOString(),
      cv_pseudonymization_meta: pseudoMeta,
    }).eq("id", c.id).eq("organization_id", c.organization_id);

    // VISION-fallback alleen op het Gemini-pad: gescand/foto-CV (of tekstloze PDF) als
    // inline bestand meesturen. Het Anthropic-pad blijft tekst-only (ongemoeid).
    const visionParts = ctx.provider === "gemini"
      ? await loadVisionFileParts(admin, dossier.visionFile)
      : [];

    const result = ctx.provider === "gemini"
      ? await analyzeWithGemini(pseudo, ctx.apiKey, ctx.addendum || undefined, {
        model: ctx.model,
        fileParts: visionParts.length > 0 ? visionParts : undefined,
      })
      : await analyzeWithAnthropic(pseudo, ctx.apiKey, ctx.addendum || undefined);

    const costCents = calculateCostCents(result.inputTokens, result.outputTokens, ctx.pricingIn, ctx.pricingOut);
    const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", {
      p_org_id: c.organization_id, p_amount_cents: costCents,
    });
    if (consumeErr) {
      await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id).eq("organization_id", c.organization_id);
      return { candidate_id: c.id, status: "failed", reason: `credits: ${consumeErr.message}` };
    }
    const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
    if (!consume?.ok) {
      // Saldo viel onder kosten — niets afschrijven, kandidaat terug naar idle, stop de run.
      await admin.from("candidates").update({ ai_status: null }).eq("id", c.id).eq("organization_id", c.organization_id);
      return { candidate_id: c.id, status: "failed", reason: "saldo onvoldoende tijdens afschrijving", stop: true };
    }

    await writeCvAnalysisToCandidate(admin, c.id, c.organization_id, result.analysis);
    await relabelSelectedCvDocument(admin, c.organization_id, c, dossier.selectedDocument);
    await logAiUsage(admin, {
      organization_id: c.organization_id, user_id: ctx.userId, provider: ctx.provider,
      model: result.model, input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      cost_cents: costCents, candidate_id: c.id, duration_ms: result.durationMs,
    });
    return { candidate_id: c.id, status: "completed", cost_cents: costCents };
  } catch (e) {
    await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id).eq("organization_id", c.organization_id);
    return { candidate_id: c.id, status: "failed", reason: (e as Error).message.slice(0, 200) };
  }
}

async function selfTrigger(orgId: string, provider: AiProvider, model: string): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-cv-batch`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      ...internalFunctionHeaders(),
    },
    body: JSON.stringify({ organization_id: orgId, provider, model }),
  });
  if (!res.ok) throw new Error(`batch self-trigger failed (${res.status})`);
}

function scheduleSelfTrigger(orgId: string, provider: AiProvider, model: string): Promise<void> | void {
  const trigger = selfTrigger(orgId, provider, model)
    .catch((e: unknown) => console.error("[analyze-cv-batch] self-trigger faalde:", e));
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) {
    er.waitUntil(trigger);
    return;
  }
  return trigger; // fallback: await door de caller (gaat naar outer try/catch)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const provider: AiProvider = body.provider === "gemini" || body.provider === "cloud" ? body.provider : "vps";

    // --- Auth: service-role (self-trigger) | superadmin (org via body) | org-admin (eigen org) ---
    let orgId: string | null = body.organization_id || null;
    let userId: string | null = null;

    if (isServiceRoleRequest(req)) {
      if (!orgId) return json({ error: "organization_id verplicht voor interne jobs" }, 400);
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Niet geautoriseerd" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return json({ error: "Ongeldige sessie" }, 401);
      userId = user.id;

      const { data: isSuper } = await userClient.rpc("is_superadmin");
      if (isSuper) {
        if (!orgId) return json({ error: "organization_id verplicht voor superadmin" }, 400);
      } else {
        const { data: profile } = await admin.from("profiles").select("organization_id, role").eq("id", user.id).single();
        if (!profile || profile.role !== "admin") {
          return json({ error: "Alleen admins of superadmins kunnen de batch starten" }, 403);
        }
        // Org-admin mag alleen de eigen org backfillen (geen body-override).
        orgId = profile.organization_id;
      }
    }
    if (!orgId) return json({ error: "organization_id kon niet worden bepaald" }, 400);

    const includeFailed = !!body.include_failed;
    const batchSize = Math.min(Math.max(1, Number(body.batch_size) || DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);
    // Veilige test-cap: verwerk hooguit max_candidates en stop dan (geen self-trigger). 0 = onbeperkt.
    const maxCandidates = Math.max(0, Number(body.max_candidates) || 0);

    // ===========================================================
    // VPS-PAD — async (ongewijzigd gedrag): één batch, geen self-trigger.
    // ===========================================================
    if (provider === "vps") {
      const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL");
      const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      if (!OLLAMA_BASE_URL || !OLLAMA_API_KEY) return json({ error: "VPS niet geconfigureerd" }, 500);

      let q = admin.from("candidates").select(candidateSelect()).eq("organization_id", orgId)
        .order("created_at", { ascending: true }).limit(batchSize);
      q = includeFailed
        ? q.or("ai_status.is.null,ai_status.eq.idle,ai_status.eq.failed")
        : q.or("ai_status.is.null,ai_status.eq.idle");
      const { data: candidates, error: selErr } = await q;
      if (selErr) return json({ error: selErr.message }, 500);
      if (!candidates || candidates.length === 0) return json({ success: true, processed: 0, results: [], message: "Niets te verwerken" });

      const callbackUrl = `${supabaseUrl}/functions/v1/analyze-cv-callback`;
      const workerUrl = `${OLLAMA_BASE_URL}/analyze`;
      const { addendum, vpsPrompt } = await buildOrgPrompt(admin, orgId);
      const results: BatchResult[] = [];

      for (const c of candidates as unknown as CandidateForDossier[]) {
        try {
          const dossier = await buildCandidateDossier(admin, c);
          if (!hasAnalyzableContent(c, dossier)) {
            await admin.from("candidates").update({ ai_status: "failed", cv_has_photo: dossier.hasPhoto })
              .eq("id", c.id).eq("organization_id", c.organization_id);
            results.push({ candidate_id: c.id, status: "skipped", reason: "geen analyseerbare data" });
            continue;
          }
          const sanitizedDossier = sanitizeDossierText(dossier.dossierText);
          const { text: pseudo, meta: pseudoMeta } = pseudonymizeCv(sanitizedDossier, { first_name: c.first_name, last_name: c.last_name });
          await admin.from("candidates").update({
            ai_status: "analyzing", cv_raw_text: dossier.cvText || c.cv_raw_text || null,
            cv_has_photo: dossier.hasPhoto, cv_pseudonymized_at: new Date().toISOString(), cv_pseudonymization_meta: pseudoMeta,
          }).eq("id", c.id).eq("organization_id", c.organization_id);

          const resp = await fetch(workerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OLLAMA_API_KEY}` },
            body: JSON.stringify({
              cv_text: pseudo, dossier_text: pseudo, system_prompt: vpsPrompt,
              prompt_addendum: addendum || null, prompt_version: "candidate_dossier_v2",
              tool_name: CV_ANALYSIS_TOOL_NAME, analysis_schema: CV_ANALYSIS_SCHEMA,
              input_meta: { selected_document: dossier.selectedDocument, warnings: dossier.warnings, counts: dossier.counts, has_photo: dossier.hasPhoto },
              candidate_id: c.id, organization_id: c.organization_id, user_id: userId, callback_url: callbackUrl,
            }),
          });
          if (!resp.ok) {
            const errBody = await resp.text();
            await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id).eq("organization_id", c.organization_id);
            results.push({ candidate_id: c.id, status: "failed", reason: `VPS ${resp.status}: ${errBody.slice(0, 150)}` });
            continue;
          }
          results.push({ candidate_id: c.id, status: "queued" });
          await sleep(VPS_THROTTLE_MS);
        } catch (e) {
          await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id).eq("organization_id", c.organization_id);
          results.push({ candidate_id: c.id, status: "failed", reason: (e as Error).message });
        }
      }
      return json({ success: true, provider: "vps", processed: candidates.length, results });
    }

    // ===========================================================
    // SYNCHROON PAD — Gemini / Cloud: credits + concurrency + self-trigger.
    // ===========================================================
    const started = Date.now();
    const isGemini = provider === "gemini";
    const apiKey = isGemini ? Deno.env.get("GEMINI_API_KEY") : Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: `${isGemini ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} ontbreekt` }, 500);

    // Stale 'analyzing' opruimen (kandidaten van een eerder mid-call gekilde run blijven
    // anders permanent onzichtbaar voor zowel batch als losse analyse).
    const staleCutoff = new Date(Date.now() - STALE_ANALYZING_MS).toISOString();
    await admin.from("candidates").update({ ai_status: null })
      .eq("organization_id", orgId).eq("ai_status", "analyzing")
      .or(`cv_pseudonymized_at.is.null,cv_pseudonymized_at.lt.${staleCutoff}`);

    const orgPrompt = await buildOrgPrompt(admin, orgId);
    // Model: net als analyze-cv ook org-setting cv_ai_model honoreren.
    const model = (typeof body.model === "string" && body.model) || orgPrompt.cvAiModel || Deno.env.get("GEMINI_MODEL") || GEMINI_DEFAULT_MODEL;
    const { data: credits0 } = await admin.from("organization_credits")
      .select("pricing_input_cents_per_mtok, pricing_output_cents_per_mtok").eq("organization_id", orgId).single();
    const gp = geminiPricingForModel(model);
    const ctx: SyncCtx = {
      provider: isGemini ? "gemini" : "cloud",
      model,
      apiKey,
      addendum: orgPrompt.addendum,
      pricingIn: isGemini ? gp.inputCentsPerMtok : (credits0?.pricing_input_cents_per_mtok ?? 270),
      pricingOut: isGemini ? gp.outputCentsPerMtok : (credits0?.pricing_output_cents_per_mtok ?? 1350),
      reservationCents: isGemini ? GEMINI_PREFLIGHT_RESERVATION_CENTS : CLOUD_PREFLIGHT_RESERVATION_CENTS,
      userId,
    };

    let completed = 0, failed = 0, skipped = 0, costTotal = 0;
    let stopped = false;
    // include_failed alleen in de EERSTE iteratie verwerken; daarna alleen verse idle,
    // anders busy-loopt de while op blijvend-falende kandidaten binnen dezelfde invocatie.
    let useFailed = includeFailed && !isServiceRoleRequest(req);
    const sampleResults: BatchResult[] = [];

    while (!stopped) {
      if (Date.now() - started > SOFT_DEADLINE_MS) {
        const maybe = scheduleSelfTrigger(orgId, provider, model);
        if (maybe) await maybe;
        return json({ success: true, provider, continued: true, completed, failed, skipped, cost_cents: costTotal, results: sampleResults.slice(0, 25) });
      }

      // Verwerkte kandidaten worden completed/failed → vallen vanzelf uit de null/idle-filter.
      let q = admin.from("candidates").select(candidateSelect()).eq("organization_id", orgId)
        .order("created_at", { ascending: true }).limit(batchSize);
      q = useFailed
        ? q.or("ai_status.is.null,ai_status.eq.idle,ai_status.eq.failed")
        : q.or("ai_status.is.null,ai_status.eq.idle");
      useFailed = false; // na de eerste iteratie geen retry-loop op blijvend-falende rijen
      const { data: candidates, error: selErr } = await q;
      if (selErr) return json({ error: selErr.message }, 500);
      if (!candidates || candidates.length === 0) {
        return json({ success: true, provider, done: true, completed, failed, skipped, cost_cents: costTotal, results: sampleResults.slice(0, 25) });
      }

      const rows = candidates as unknown as CandidateForDossier[];
      for (let i = 0; i < rows.length; i += SYNC_CONCURRENCY) {
        const chunk = rows.slice(i, i + SYNC_CONCURRENCY);
        const settled = await Promise.all(chunk.map((c) => processCandidateSync(admin, c, ctx)));
        for (const r of settled) {
          if (r.status === "completed") { completed++; costTotal += r.cost_cents ?? 0; }
          else if (r.status === "skipped") skipped++;
          else failed++;
          if (sampleResults.length < 25) sampleResults.push({ candidate_id: r.candidate_id, status: r.status, reason: r.reason, cost_cents: r.cost_cents });
          if (r.stop) stopped = true;
        }
        if (maxCandidates && (completed + failed + skipped) >= maxCandidates) stopped = true;
        if (stopped) break;
        if (Date.now() - started > SOFT_DEADLINE_MS) break;
      }
    }

    // Gestopt: door saldo-tekort of door de test-cap (max_candidates).
    const reachedMax = maxCandidates > 0 && (completed + failed + skipped) >= maxCandidates;
    return json({
      success: true, provider, stopped_reason: reachedMax ? "max_candidates bereikt" : "saldo onvoldoende",
      completed, failed, skipped, cost_cents: costTotal, results: sampleResults.slice(0, 25),
    });
  } catch (e) {
    console.error("[analyze-cv-batch] fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
