// Batch backfill voor AI kandidaatdossier-analyse.
//
// Synchroon via Gemini (standaard) of Anthropic (cloud), met reservering en
// verbruikregistratie per provider-aanroep. Self-triggerend met lichte concurrency.
// Het uitgefaseerde lokale Qwen-model kan niet meer worden geselecteerd.
//
// Auth: org-admin (eigen org), superadmin (org via body), of service-role (self-trigger, org via body).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pseudonymizeCv } from "../_shared/cv-pseudonymize.ts";
import { buildCandidateDossier, type CandidateForDossier } from "../_shared/candidate-dossier.ts";
import { sanitizeOrgPrompt } from "../_shared/sanitize-org-prompt.ts";
import { analyzeWithGemini, GEMINI_DEFAULT_MODEL } from "../_shared/gemini-cv.ts";
import { analyzeWithAnthropic } from "../_shared/anthropic-cv.ts";
import { writeCvAnalysisToCandidate } from "../_shared/cv-write.ts";
import { AiAccountingError } from "../_shared/ai-accounting.ts";
import { internalFunctionHeaders, isServiceRoleRequest } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AiProvider = "cloud" | "gemini";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
// Iedere parallelle call reserveert atomair vóór verzending; een uitgeput saldo stopt de batch.
const SYNC_CONCURRENCY = 4;
// Soft deadline waarna we self-triggeren (edge runtime wall-clock ~150s).
const SOFT_DEADLINE_MS = 70_000;
// Kandidaten die langer dan dit in 'analyzing' staan zijn van een gekilde run; resetten.
const STALE_ANALYZING_MS = 15 * 60 * 1000;
interface BatchResult {
  candidate_id: string;
  status: "queued" | "completed" | "skipped" | "failed";
  reason?: string;
  cost_cents?: number;
  request_id?: string;
  cost_pending?: boolean;
  stop_code?: string;
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
async function buildOrgPrompt(admin: Admin, orgId: string): Promise<{ addendum: string; cvAiModel: string | null }> {
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
      "competenties.hard_skills[].vaardigheid wanneer de kandidaat de vaardigheid aantoonbaar heeft. " +
      "Verzin niets en neem een term ALLEEN op met een letterlijk bewijsfragment uit het dossier in het bewijs-veld; " +
      "geen bewijs = niet opnemen:\n" + skillNames.join(", ");
  }
  const addendum = [sanitized.text, skillGuidance].filter((s) => s && s.trim().length > 0).join("\n\n");
  const cvAiModel = typeof settings.cv_ai_model === "string" && settings.cv_ai_model ? settings.cv_ai_model : null;
  return { addendum, cvAiModel };
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
  userId: string | null;
}

// Eén synchrone kandidaat: status + (bij saldo-op) een stopsignaal.
async function processCandidateSync(admin: Admin, c: CandidateForDossier, ctx: SyncCtx): Promise<BatchResult & { stop?: boolean }> {
  let chargedCost: number | undefined;
  let requestId: string | undefined;
  try {
    const dossier = await buildCandidateDossier(admin, c);
    if (!hasAnalyzableContent(c, dossier)) {
      await admin.from("candidates").update({ ai_status: "failed", cv_has_photo: dossier.hasPhoto })
        .eq("id", c.id).eq("organization_id", c.organization_id);
      return { candidate_id: c.id, status: "skipped", reason: "geen analyseerbare CV/notitiecontext" };
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

    const accounting = { admin, organizationId: c.organization_id, userId: ctx.userId, feature: "cv_analysis", candidateId: c.id };
    const result = ctx.provider === "gemini"
      ? await analyzeWithGemini(pseudo, ctx.apiKey, ctx.addendum || undefined, {
        model: ctx.model,
        fileParts: visionParts.length > 0 ? visionParts : undefined,
      }, accounting)
      : await analyzeWithAnthropic(pseudo, ctx.apiKey, ctx.addendum || undefined, accounting);

    chargedCost = result.costCents;
    requestId = result.requestId;

    await writeCvAnalysisToCandidate(admin, c.id, c.organization_id, result.analysis, {
      dossierText: pseudo,
    });
    await relabelSelectedCvDocument(admin, c.organization_id, c, dossier.selectedDocument);
    return { candidate_id: c.id, status: "completed", cost_cents: chargedCost, request_id: requestId };
  } catch (e) {
    const usage = e as Error & { costCents?: number; requestId?: string; providerAttempted?: boolean };
    const accountingError = e instanceof AiAccountingError;
    await admin.from("candidates").update({ ai_status: accountingError && e.status === 402 ? null : "failed" })
      .eq("id", c.id).eq("organization_id", c.organization_id);
    const cost = chargedCost ?? usage.costCents;
    const id = requestId ?? usage.requestId;
    return {
      candidate_id: c.id, status: "failed", reason: usage.message.slice(0, 200),
      cost_cents: cost, request_id: id, cost_pending: usage.providerAttempted === true && cost === undefined,
      stop: accountingError, stop_code: accountingError ? e.code : undefined,
    };
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
    // Gemini is standaard; Anthropic blijft expliciet selecteerbaar voor backfills.
    const provider: AiProvider = body.provider === "cloud" ? "cloud" : "gemini";

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

      const { data: profile } = await admin.from("profiles")
        .select("organization_id, role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.is_active === false) {
        return json({ error: "Account is uitgeschakeld" }, 403);
      }

      const { data: isSuper } = await userClient.rpc("is_superadmin");
      if (isSuper) {
        if (!orgId) return json({ error: "organization_id verplicht voor superadmin" }, 400);
      } else {
        if (!profile || profile.is_active !== true || profile.role !== "admin") {
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
    if (body.max_candidates !== undefined && (!Number.isInteger(body.max_candidates) || body.max_candidates < 0)) {
      return json({ error: "max_candidates moet een geheel getal van 0 of hoger zijn" }, 400);
    }
    const maxCandidates = body.max_candidates ?? 0;

    if (body.provider === "vps") {
      return json({ error: "Het lokale Qwen-model is uitgefaseerd. Kies Gemini voor kandidaatdossier-analyse.", code: "vps_provider_retired" }, 410);
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
    const ctx: SyncCtx = {
      provider: isGemini ? "gemini" : "cloud",
      model,
      apiKey,
      addendum: orgPrompt.addendum,
      userId,
    };

    let completed = 0, failed = 0, skipped = 0, costTotal = 0, pendingCosts = 0;
    let stopCode: string | undefined;
    let stopped = false;
    // include_failed alleen in de EERSTE iteratie verwerken; daarna alleen verse idle,
    // anders busy-loopt de while op blijvend-falende kandidaten binnen dezelfde invocatie.
    let useFailed = includeFailed && !isServiceRoleRequest(req);
    const sampleResults: BatchResult[] = [];

    while (!stopped) {
      if (Date.now() - started > SOFT_DEADLINE_MS) {
        if (maxCandidates > 0) { stopped = true; stopCode = "deadline"; break; }
        const maybe = scheduleSelfTrigger(orgId, provider, model);
        if (maybe) await maybe;
        return json({ success: true, provider, continued: true, completed, failed, skipped, cost_cents: costTotal, costs_pending: pendingCosts, results: sampleResults.slice(0, 25) });
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
        return json({ success: true, provider, done: true, completed, failed, skipped, cost_cents: costTotal, costs_pending: pendingCosts, results: sampleResults.slice(0, 25) });
      }

      const rows = candidates as unknown as CandidateForDossier[];
      for (let i = 0; i < rows.length; i += SYNC_CONCURRENCY) {
        const remaining = maxCandidates > 0 ? maxCandidates - completed - failed - skipped : SYNC_CONCURRENCY;
        const chunk = rows.slice(i, i + Math.min(SYNC_CONCURRENCY, remaining));
        const settled = await Promise.all(chunk.map((c) => processCandidateSync(admin, c, ctx)));
        for (const r of settled) {
          costTotal += r.cost_cents ?? 0;
          if (r.cost_pending) pendingCosts++;
          if (r.status === "completed") completed++;
          else if (r.status === "skipped") skipped++;
          else failed++;
          if (sampleResults.length < 25) sampleResults.push(r);
          if (r.stop) { stopped = true; stopCode ??= r.stop_code; }
        }
        if (maxCandidates && (completed + failed + skipped) >= maxCandidates) stopped = true;
        if (stopped) break;
        if (Date.now() - started > SOFT_DEADLINE_MS) break;
      }
    }

    // Gestopt: door saldo-tekort of door de test-cap (max_candidates).
    const reachedMax = maxCandidates > 0 && (completed + failed + skipped) >= maxCandidates;
    return json({
      success: true, provider, stopped_reason: stopCode ?? (reachedMax ? "max_candidates bereikt" : "saldo onvoldoende"),
      completed, failed, skipped, cost_cents: costTotal, costs_pending: pendingCosts, results: sampleResults.slice(0, 25),
    });
  } catch (e) {
    console.error("[analyze-cv-batch] fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
