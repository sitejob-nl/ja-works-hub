import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Publieke voorstel-respons voor opdrachtgevers (/match/reageer/:token).
// Token-based, geen login: de 32-byte token IS het geheim. Draait met service-role
// zodat RLS niet hoeft te worden opengezet voor anon (SEC-4 dropte die policy).
// Geeft alleen de minimale data terug die de responspagina toont — GEEN score,
// GEEN BSN/IBAN, GEEN interne contactdata buiten de accountmanager voor "vraag stellen".

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import { storagePathFromCvValue } from "../_shared/candidate-dossier.ts";
import { advanceMatchStatus, createMatchFollowUpTask, recordMatchProposalTokenResponse } from "../_shared/match-lifecycle.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// --- Rate-limiting (publiek, ongeauthenticeerd): per gehashte IP + globaal. ---
const MAX_PER_IP_PER_HOUR = 80;
const MAX_GLOBAL_PER_HOUR = 1500;
const CV_SIGNED_TTL = 300; // 5 min — korte TTL, per request opnieuw, nooit permanent embedden.

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

// Opdrachtgever-beslissingen. Legacy ja/nee blijft werken (oude links / WhatsApp).
const DECISIONS = ["op_gesprek", "direct_starten", "afwijzen"] as const;
type Decision = typeof DECISIONS[number];
const LEGACY_MAP: Record<string, Decision> = { interesse: "direct_starten", geen_interesse: "afwijzen" };
const STATUS_MAP: Record<Decision, string> = {
  op_gesprek: "afspraak_voorgesteld",
  direct_starten: "geaccepteerd",
  afwijzen: "afgewezen",
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isPdfPath(value: string | null): boolean {
  return Boolean(value && /\.pdf(?:$|[?#])/i.test(value));
}

function noteValue(notes: string | null | undefined, label: string): string | null {
  if (!notes) return null;
  const prefix = `${label}:`;
  const line = notes
    .split(/\r?\n/)
    .find((entry) => entry.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  const value = line?.slice(prefix.length).trim();
  return value || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const action = body.action === "respond" ? "respond" : "get";

    if (!token) return json({ error: "Token ontbreekt" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate-limit + toegangslog (service-only tabel). Blokkeert token-brute-force.
    const ipHash = await hashIp(clientIp(req));
    const since = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: ipCount }, { count: globalCount }] = await Promise.all([
      service.from("match_response_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", since),
      service.from("match_response_attempts").select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);
    if ((ipCount ?? 0) >= MAX_PER_IP_PER_HOUR || (globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR) {
      return json({ error: "Te veel verzoeken. Probeer het later opnieuw." }, 429);
    }
    await service.from("match_response_attempts").insert({ ip_hash: ipHash, token: token.slice(0, 12), action });

    const { data: tok } = await service
      .from("match_proposal_tokens")
      .select(
        "id, match_id, response, used_at, expires_at, content_snapshot, matches!match_proposal_tokens_match_id_fkey(status, match_score, match_breakdown, organization_id, candidate_id, vacancy_id, candidates!matches_candidate_id_fkey(id, first_name, last_name, address_city, ai_summary, ai_function_group, ai_classification, ai_positive_signals, ai_risk_factors, ai_target_functions, ai_interview_questions, skills, certifications, languages, available_from, available_until, arrival_date, availability_notes, most_recent_role, most_recent_role_year, has_drivers_license, cv_file_url), vacancies!matches_vacancy_id_fkey(title, created_by, companies:company_id(name)))",
      )
      .eq("token", token)
      .maybeSingle();

    if (!tok) return json({ status: "invalid" });

    const expired = new Date(tok.expires_at) < new Date();
    const matchRow = (tok.matches as any) ?? null;
    const orgId = matchRow?.organization_id ?? null;
    const candidate = matchRow?.candidates ?? null;
    const vacancy = matchRow?.vacancies ?? null;
    const company = vacancy?.companies ?? null;
    const snapshot = asRecord((tok as any).content_snapshot);
    const snapCandidate = asRecord(snapshot.candidate);
    const snapVacancy = asRecord(snapshot.vacancy);
    const snapCompany = asRecord(snapshot.company);
    const snapReport = asRecord(snapshot.report);
    const view = {
      candidate: (candidate || snapCandidate.name) ? {
        first_name: snapCandidate.first_name ?? candidate?.first_name ?? "",
        last_name: snapCandidate.last_name ?? candidate?.last_name ?? "",
      } : null,
      vacancy: (vacancy || snapVacancy.title) ? { title: snapVacancy.title ?? vacancy?.title } : null,
    };

    if (action === "get") {
      if (tok.used_at) return json({ status: "used", response: tok.response, ...view });
      if (expired) return json({ status: "expired" });

      // Volledige (maar geminimaliseerde) payload: logo, rapport zonder score/AI-label,
      // korte-TTL CV-link, afwijsredenen, accountmanager-contact voor "vraag stellen".
      const [orgRes, mgrRes, reasonsRes, placementsRes, employmentRes, cvDocRes] = await Promise.all([
        service.from("organizations").select("logo_url, name, email, phone").eq("id", orgId).maybeSingle(),
        vacancy?.created_by
          ? service.from("profiles").select("full_name, email, phone").eq("id", vacancy.created_by).maybeSingle()
          : Promise.resolve({ data: null }),
        service.from("match_feedback_reasons").select("id, reason")
          .eq("organization_id", orgId).eq("applies_to", "afgewezen").eq("is_active", true)
          .order("sort_order", { ascending: true }),
        candidate?.id
          ? service.from("placements")
            .select("id, function_name, start_date, end_date, status, work_location, companies:company_id(name)")
            .eq("organization_id", orgId).eq("candidate_id", candidate.id)
            .order("start_date", { ascending: false })
            .limit(4)
          : Promise.resolve({ data: [] }),
        candidate?.id
          ? service.from("candidate_employment")
            .select("id, contract_type, start_date, end_date, is_current, notes")
            .eq("organization_id", orgId).eq("candidate_id", candidate.id)
            .order("start_date", { ascending: false })
            .limit(4)
          : Promise.resolve({ data: [] }),
        candidate?.id
          ? service.from("documents")
            .select("name, file_path, type, created_at")
            .eq("organization_id", orgId).eq("candidate_id", candidate.id)
            .eq("type", "cv").not("file_path", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      const org = (orgRes as any).data;
      const mgr = (mgrRes as any).data;

      let cvUrl: string | null = null;
      let cvFileName: string | null = null;
      let cvPath = storagePathFromCvValue(snapCandidate.cv_file_url ?? candidate?.cv_file_url);
      const cvDoc = Array.isArray((cvDocRes as any).data) ? (cvDocRes as any).data[0] : null;
      if (!cvPath && cvDoc?.file_path) {
        cvPath = storagePathFromCvValue(cvDoc.file_path);
        cvFileName = cvDoc.name ?? null;
      }
      if (cvPath) {
        const { data: signed } = await service.storage.from("documents").createSignedUrl(cvPath, CV_SIGNED_TTL);
        cvUrl = signed?.signedUrl ?? null;
      }
      const placements = Array.isArray((placementsRes as any).data) ? (placementsRes as any).data : [];
      const employments = Array.isArray((employmentRes as any).data) ? (employmentRes as any).data : [];
      const history = [
        ...placements.map((placement: any) => ({
          id: placement.id,
          role: placement.function_name ?? null,
          company_name: placement.companies?.name ?? null,
          start_date: placement.start_date ?? null,
          end_date: placement.end_date ?? null,
          status: placement.status ?? null,
          location: placement.work_location ?? null,
        })),
        ...employments.map((employment: any) => ({
          id: `employment-${employment.id}`,
          role: noteValue(employment.notes, "Functie") ?? employment.contract_type ?? null,
          company_name: noteValue(employment.notes, "Werkgever"),
          start_date: employment.start_date ?? null,
          end_date: employment.end_date ?? null,
          status: employment.is_current ? "actief" : "beeindigd",
          location: null,
        })),
      ]
        .sort((a, b) => new Date(b.start_date ?? 0).getTime() - new Date(a.start_date ?? 0).getTime())
        .slice(0, 6);

      return json({
        status: "ok",
        org_logo_url: org?.logo_url ?? null,
        org_name: org?.name ?? null,
        candidate: view.candidate,
        vacancy: view.vacancy,
        company: (company || snapCompany.name) ? { name: snapCompany.name ?? company?.name } : null,
        sections: asRecord(snapshot.sections),
        profile: candidate
          ? {
            summary: snapReport.summary ?? candidate.ai_summary ?? null,
            function_group: snapReport.function_group ?? candidate.ai_function_group ?? null,
            classification: snapReport.classification ?? candidate.ai_classification ?? null,
            target_functions: stringArray(snapReport.target_functions).length ? stringArray(snapReport.target_functions) : stringArray(candidate.ai_target_functions),
            interview_questions: stringArray(snapReport.interview_questions).length ? stringArray(snapReport.interview_questions) : stringArray(candidate.ai_interview_questions),
            skills: stringArray(snapReport.skills).length ? stringArray(snapReport.skills) : stringArray(candidate.skills),
            certifications: stringArray(snapReport.certifications).length ? stringArray(snapReport.certifications) : stringArray(candidate.certifications),
            languages: stringArray(snapReport.languages).length ? stringArray(snapReport.languages) : stringArray(candidate.languages),
            city: snapCandidate.address_city ?? candidate.address_city ?? null,
            available_from: snapCandidate.available_from ?? candidate.available_from ?? null,
            available_until: candidate.available_until ?? null,
            arrival_date: snapCandidate.arrival_date ?? candidate.arrival_date ?? null,
            availability_notes: snapCandidate.availability_notes ?? candidate.availability_notes ?? null,
            most_recent_role: candidate.most_recent_role ?? null,
            most_recent_role_year: candidate.most_recent_role_year ?? null,
            has_drivers_license: snapCandidate.has_drivers_license ?? candidate.has_drivers_license === true,
          }
          : null,
        history,
        report: candidate
          ? {
            summary: snapReport.summary ?? candidate.ai_summary ?? null,
            strong_signals: stringArray(snapReport.positive_signals).length ? stringArray(snapReport.positive_signals) : stringArray(candidate.ai_positive_signals),
            attention_points: stringArray(snapReport.risk_factors).length ? stringArray(snapReport.risk_factors) : stringArray(candidate.ai_risk_factors),
          }
          : null,
        cv_url: cvUrl,
        cv: cvUrl ? {
          url: cvUrl,
          file_name: cvFileName ?? "CV",
          is_pdf: isPdfPath(cvPath),
        } : null,
        rejection_reasons: (reasonsRes as any).data ?? [],
        contact: {
          manager_email: mgr?.email ?? org?.email ?? null,
          manager_phone: mgr?.phone ?? org?.phone ?? null,
        },
      });
    }

    // action === "respond"
    const decision: Decision | null = DECISIONS.includes(body.decision) ? body.decision : (LEGACY_MAP[body.response] ?? null);
    if (!decision) return json({ error: "Ongeldige reactie" }, 400);
    if (expired) return json({ status: "expired" });

    const rejectionReasonId = typeof body.rejection_reason_id === "string" ? body.rejection_reason_id : null;
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

    if (decision === "afwijzen") {
      if (!rejectionReasonId) return json({ error: "Reden is verplicht" }, 400);
      // Reden moet bij deze org horen en op 'afgewezen' van toepassing zijn.
      const { data: reason } = await service.from("match_feedback_reasons")
        .select("id").eq("id", rejectionReasonId).eq("organization_id", orgId).eq("applies_to", "afgewezen").maybeSingle();
      if (!reason) return json({ error: "Ongeldige reden" }, 400);
    }

    if (tok.used_at) {
      return json({ status: "used", response: tok.response, ...view });
    }

    try {
      const tokenResponse = await recordMatchProposalTokenResponse(service, {
        tokenId: tok.id,
        response: decision,
        consume: decision !== "op_gesprek",
      });
      if (!tokenResponse.accepted) return json({ status: "used", response: tok.response, ...view });
    } catch (_err) {
      return json({ error: "Kon reactie niet verwerken" }, 500);
    }

    const newStatus = STATUS_MAP[decision];
    const matchPatch: Record<string, unknown> = {};
    const proposedAt = typeof body.interview_proposed_at === "string" ? body.interview_proposed_at : body.interview_date;
    if (decision === "op_gesprek" && typeof proposedAt === "string") {
      matchPatch.interview_proposed_at = proposedAt;
      matchPatch.interview_proposed_note = note;
    }
    if (decision === "direct_starten" && typeof body.desired_start_date === "string") matchPatch.desired_start_date = body.desired_start_date;
    await advanceMatchStatus(service, {
      orgId,
      matchId: tok.match_id,
      toStatus: newStatus as any,
      currentMatch: {
        id: tok.match_id,
        organization_id: orgId,
        status: matchRow?.status ?? null,
        match_score: matchRow?.match_score ?? null,
        match_breakdown: matchRow?.match_breakdown ?? null,
      },
      reasonId: rejectionReasonId,
      notes: note,
      actorId: null,
      patch: matchPatch,
      eventMode: "always",
    });

    // Bij acceptatie/gesprek: interne opvolg-taak. Een gesprek is nog géén plaatsing;
    // pas na klantakkoord/direct starten opent intern de plaatsingspopup.
    if (decision !== "afwijzen") {
      const candName = candidate ? `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() : "kandidaat";
      const isDirectStart = decision === "direct_starten";
      const label = isDirectStart ? "wil direct starten" : "stelde een gesprek voor";
      await createMatchFollowUpTask(service, {
        orgId,
        matchId: tok.match_id,
        assignedTo: vacancy?.created_by ?? null,
        title: isDirectStart
          ? `Klant keurde kandidaat goed — plaatsing voorbereiden (${candName})`
          : `Klant stelt gesprek voor met kandidaat (${candName})`,
        description: `De opdrachtgever ${label} voor "${vacancy?.title ?? ""}".${note ? ` Opmerking: ${note}` : ""}`,
        priority: "high",
        category: isDirectStart ? "plaatsing" : "matching",
      });
    }

    // Best-effort audit (schemamismatch mag de publieke flow niet breken).
    try {
      await service.from("audit_log").insert({
        organization_id: orgId,
        user_id: null,
        action: "status_change",
        table_name: "matches",
        record_id: tok.match_id,
        new_values: { decision, to_status: newStatus, via: "public_match_response" },
      } as any);
    } catch (_e) { /* ignore */ }

    return json({ status: "done", response: decision, ...view });
  } catch (err) {
    console.error("match-response error:", err);
    return json({ error: "Interne fout" }, 500);
  }
});
