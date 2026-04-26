// Batch backfill voor AI CV-analyse.
// Pakt N candidates met cv_file_url maar zonder ai_status = 'completed',
// downloadt PDF uit storage, extraheert tekst, pseudonimiseert en
// stuurt naar VPS-LLM. Throttled (max 1 call per 30s default).
//
// Auth: superadmin JWT (self-verified). Bedoeld voor handmatige trigger
// vanuit /superadmin UI of toekomstige cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { pseudonymizeCv } from "../_shared/cv-pseudonymize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 25;
const THROTTLE_MS = 1500; // pauze tussen calls om VPS niet plat te leggen

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Detecteert of PDF afbeeldingen bevat (eenvoudige heuristiek op binary)
function detectPdfHasImages(buffer: Uint8Array): boolean {
  // Lees eerste 256kB als string en zoek naar PDF image markers
  const slice = buffer.subarray(0, Math.min(buffer.length, 262144));
  const text = new TextDecoder("latin1").decode(slice);
  return /\/Subtype\s*\/Image/i.test(text) || /\/XObject\s*<</.test(text);
}

interface BatchResult {
  candidate_id: string;
  status: "queued" | "skipped" | "failed";
  reason?: string;
  pseudonymized_meta?: unknown;
  has_photo?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Ongeldige sessie" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Alleen superadmins mogen batch-trigger doen
    const { data: superCheck } = await userClient.rpc("is_superadmin");
    if (!superCheck) {
      return new Response(JSON.stringify({ error: "Alleen superadmins kunnen batch starten" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(1, Number(body.batch_size) || DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);
    const orgFilter: string | null = body.organization_id || null;
    const includeFailed: boolean = !!body.include_failed;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Selecteer kandidaten met CV maar zonder voltooide analyse
    let q = admin
      .from("candidates")
      .select("id, organization_id, first_name, last_name, cv_file_url, ai_status")
      .not("cv_file_url", "is", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (orgFilter) q = q.eq("organization_id", orgFilter);
    if (includeFailed) {
      q = q.or("ai_status.is.null,ai_status.eq.failed");
    } else {
      q = q.is("ai_status", null);
    }

    const { data: candidates, error: selErr } = await q;
    if (selErr) {
      return new Response(JSON.stringify({ error: selErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, results: [], message: "Niets te verwerken" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL");
    const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    if (!OLLAMA_BASE_URL || !OLLAMA_API_KEY) {
      return new Response(JSON.stringify({ error: "VPS niet geconfigureerd" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callbackUrl = `${supabaseUrl}/functions/v1/analyze-cv-callback`;
    const workerUrl = `${OLLAMA_BASE_URL}/analyze`;

    const results: BatchResult[] = [];

    for (const c of candidates) {
      try {
        // 1. Download PDF uit storage
        // cv_file_url is een public URL → extract pad
        const url = c.cv_file_url as string;
        const match = url.match(/\/documents\/(.+)$/);
        if (!match) {
          results.push({ candidate_id: c.id, status: "skipped", reason: "Onbekend cv_file_url-formaat" });
          continue;
        }
        const path = decodeURIComponent(match[1]);

        const { data: fileBlob, error: dlErr } = await admin.storage.from("documents").download(path);
        if (dlErr || !fileBlob) {
          results.push({ candidate_id: c.id, status: "failed", reason: `Download mislukt: ${dlErr?.message}` });
          await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id);
          continue;
        }

        const buffer = new Uint8Array(await fileBlob.arrayBuffer());
        const hasPhoto = detectPdfHasImages(buffer);

        // 2. Extract tekst via unpdf
        let cvText = "";
        try {
          const doc = await getDocumentProxy(buffer);
          const { text } = await extractText(doc, { mergePages: true });
          cvText = Array.isArray(text) ? text.join("\n") : (text ?? "");
        } catch (parseErr) {
          results.push({
            candidate_id: c.id,
            status: "failed",
            reason: `PDF-parse mislukt: ${(parseErr as Error).message}`,
            has_photo: hasPhoto,
          });
          await admin.from("candidates").update({ ai_status: "failed", cv_has_photo: hasPhoto }).eq("id", c.id);
          continue;
        }

        if (!cvText.trim() || cvText.trim().length < 50) {
          results.push({
            candidate_id: c.id,
            status: "skipped",
            reason: "PDF bevat te weinig tekst (waarschijnlijk gescand)",
            has_photo: hasPhoto,
          });
          await admin.from("candidates").update({
            ai_status: "failed",
            cv_has_photo: hasPhoto,
            cv_raw_text: cvText.slice(0, 500),
          }).eq("id", c.id);
          continue;
        }

        // 3. Pseudonimiseer
        const trimmed = cvText.length > 15000 ? cvText.slice(0, 15000) + "\n[CV ingekort]" : cvText;
        const { text: pseudo, meta: pseudoMeta } = pseudonymizeCv(trimmed, {
          first_name: c.first_name,
          last_name: c.last_name,
        });

        // 4. Mark analyzing + opslaan raw text + foto-flag + meta
        await admin.from("candidates").update({
          ai_status: "analyzing",
          cv_raw_text: trimmed,
          cv_has_photo: hasPhoto,
          cv_pseudonymized_at: new Date().toISOString(),
          cv_pseudonymization_meta: pseudoMeta,
        }).eq("id", c.id);

        // 5. Verstuur naar VPS
        const resp = await fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OLLAMA_API_KEY}`,
          },
          body: JSON.stringify({
            cv_text: pseudo,
            candidate_id: c.id,
            organization_id: c.organization_id,
            user_id: user.id,
            callback_url: callbackUrl,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id);
          results.push({
            candidate_id: c.id,
            status: "failed",
            reason: `VPS rejected: ${resp.status} ${errBody.slice(0, 200)}`,
            has_photo: hasPhoto,
          });
          continue;
        }

        results.push({
          candidate_id: c.id,
          status: "queued",
          pseudonymized_meta: pseudoMeta,
          has_photo: hasPhoto,
        });

        // 6. Throttle om VPS niet plat te leggen
        await sleep(THROTTLE_MS);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[analyze-cv-batch] error voor ${c.id}: ${msg}`);
        await admin.from("candidates").update({ ai_status: "failed" }).eq("id", c.id);
        results.push({ candidate_id: c.id, status: "failed", reason: msg });
      }
    }

    // Audit log van batch
    await admin.from("audit_log").insert({
      user_id: user.id,
      action: "create",
      table_name: "candidates",
      record_id: null,
      new_values: { batch_size: candidates.length, results_summary: summarize(results) },
      reason: "AI CV batch-backfill gestart",
    });

    return new Response(
      JSON.stringify({ success: true, processed: candidates.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[analyze-cv-batch] fatal:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function summarize(results: BatchResult[]) {
  const counts = { queued: 0, skipped: 0, failed: 0, photos: 0 };
  for (const r of results) {
    counts[r.status] += 1;
    if (r.has_photo) counts.photos += 1;
  }
  return counts;
}
