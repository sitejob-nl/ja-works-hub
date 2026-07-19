// rank-vacancies — reverse matching: rangschikt alle OPEN vacatures voor één kandidaat.
//
// Spiegel van rank-candidates: zelfde gedeelde matching-core (scoreMatch), maar nu vast
// kandidaat × variabele vacatures. Geeft de best passende open vacatures terug, gesorteerd op score.
//
// Auth: ingelogde gebruiker (RLS op de eigen organisatie). verify_jwt=false in config.toml;
// we valideren de Bearer-token zelf via auth.getUser().

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { haversineKm, scoreMatch, passesShortlist, type MatchBreakdown, type MatchCriteriaOptions } from "../_shared/matching-core.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalizeCriteriaOptions = (value: unknown): MatchCriteriaOptions => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    minScore: typeof raw.minScore === "number" ? raw.minScore : null,
    requireSkillSignal: raw.requireSkillSignal === true,
    requireKnownDistance: raw.requireKnownDistance === true,
    weights: raw.weights && typeof raw.weights === "object" && !Array.isArray(raw.weights) ? raw.weights as any : null,
    bonusPoints: raw.bonusPoints && typeof raw.bonusPoints === "object" && !Array.isArray(raw.bonusPoints) ? raw.bonusPoints as any : null,
  };
};

const CANDIDATE_FIELDS =
  "id, organization_id, first_name, last_name, skills, certifications, languages, has_drivers_license, drivers_license_categories, has_dutch_address, address_lat, address_lng, available_from, available_until, arrival_date, availability_notes, ai_function_group, ai_target_functions, ai_classification, ai_reliability_score, most_recent_role, most_recent_role_year";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const candidateId = body.candidate_id as string | undefined;
    const includeWeak = body.include_weak === true;
    const criteriaOptions = normalizeCriteriaOptions(body.criteria_options);
    const scoreOptions = { ...criteriaOptions, nowYear: new Date().getFullYear() };
    const limit = Math.min(Math.max(1, Number(body.limit) || 25), 100);
    const excludeIds: string[] = Array.isArray(body.exclude_vacancy_ids) ? body.exclude_vacancy_ids : [];
    // Vrije-tekst zoek op vacaturetitel/locatie (PostgREST-tekens gestript, zoals rank-candidates).
    const search = typeof body.search === "string" ? body.search.replace(/[,()%*\\]/g, " ").trim().slice(0, 100) : "";
    if (!candidateId) return json({ error: "candidate_id required" }, 400);

    // ── Kandidaat ──
    const { data: candidate, error: candErr } = await userClient
      .from("candidates")
      .select(CANDIDATE_FIELDS)
      .eq("id", candidateId)
      .single();
    if (candErr || !candidate) return json({ error: candErr?.message ?? "Candidate not found" }, 404);
    const orgId = candidate.organization_id;

    // ── Org-aliassen ──
    const { data: aliasData } = await userClient
      .from("skill_aliases")
      .select("normalized_alias, skills!inner(name)")
      .eq("organization_id", orgId)
      .eq("is_active", true);
    const orgAliases: Record<string, string> = {};
    for (const row of (aliasData ?? []) as any[]) {
      if (row.normalized_alias && row.skills?.name) orgAliases[row.normalized_alias] = row.skills.name;
    }

    // ── Open vacatures (gepagineerd) + bedrijfscoördinaten ──
    const PAGE = 1000;
    const vacancies: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = userClient
        .from("vacancies")
        .select("id, title, description, location, required_skills, required_certifications, requires_drivers_license, status, company_id, created_by, hourly_rate, salary_display, salary_min, salary_max, start_date, start_date_text, end_date, required_count, filled_count, urgency, companies!vacancies_company_id_fkey(name, address_lat, address_lng, visit_address_lat, visit_address_lng)")
        .eq("organization_id", orgId)
        .eq("status", "open");
      if (search) q = q.or(`title.ilike.%${search}%,location.ilike.%${search}%`);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) return json({ error: "Kon vacatures niet laden" }, 500);
      const batch = data ?? [];
      vacancies.push(...batch);
      if (batch.length < PAGE) break;
    }

    // ── Canonieke required-skills per vacature (batch) ──
    const vacancyIds = vacancies.map((v) => v.id);
    const canonicalByVacancy: Record<string, string[]> = {};
    if (vacancyIds.length > 0) {
      const { data: vrs } = await userClient
        .from("vacancy_required_skills")
        .select("vacancy_id, skills!inner(name)")
        .in("vacancy_id", vacancyIds);
      for (const row of (vrs ?? []) as any[]) {
        if (!row.vacancy_id || !row.skills?.name) continue;
        (canonicalByVacancy[row.vacancy_id] ??= []).push(row.skills.name);
      }
    }

    const excludeSet = new Set(excludeIds);
    const scored = vacancies
      .filter((v) => !excludeSet.has(v.id))
      .map((v) => {
        const company: any = v.companies ?? {};
        const destLat = company.visit_address_lat ?? company.address_lat ?? null;
        const destLng = company.visit_address_lng ?? company.address_lng ?? null;
        const km = haversineKm(candidate.address_lat, candidate.address_lng, destLat, destLng);
        const distance = km != null ? { km, status: "estimated" as const } : { status: "missing_coords" as const };
        const vacancyForScore = {
          title: v.title,
          description: v.description,
          location: v.location,
          start_date: v.start_date,
          start_date_text: v.start_date_text,
          required_skills: v.required_skills,
          canonical_required_skills: canonicalByVacancy[v.id] ?? [],
          required_certifications: v.required_certifications,
          requires_drivers_license: v.requires_drivers_license,
        };
        const breakdown: MatchBreakdown = scoreMatch(candidate, vacancyForScore, distance, orgAliases, scoreOptions);
        return { vacancy: v, company, breakdown };
      })
      .filter((r) => passesShortlist(r.breakdown, includeWeak, criteriaOptions))
      .sort((a, b) => {
        const d = b.breakdown.matchPercent - a.breakdown.matchPercent;
        if (d !== 0) return d;
        return b.breakdown.skillMatches.length - a.breakdown.skillMatches.length;
      });

    return json({
      candidate_id: candidateId,
      pool_size: vacancies.length,
      shortlisted: scored.length,
      results: scored.slice(0, limit).map((r) => ({
        vacancy: {
          id: r.vacancy.id,
          title: r.vacancy.title,
          location: r.vacancy.location,
          company_id: r.vacancy.company_id,
          company_name: r.company?.name ?? null,
          // Vangnet-accountmanager wanneer de match niet door een interne gebruiker
          // wordt aangemaakt (resolveDefaultMatchAssignee in de frontend).
          created_by: r.vacancy.created_by ?? null,
          description: r.vacancy.description ?? null,
          hourly_rate: r.vacancy.hourly_rate ?? null,
          salary_display: r.vacancy.salary_display ?? null,
          salary_min: r.vacancy.salary_min ?? null,
          salary_max: r.vacancy.salary_max ?? null,
          start_date: r.vacancy.start_date ?? null,
          start_date_text: r.vacancy.start_date_text ?? null,
          end_date: r.vacancy.end_date ?? null,
          required_count: r.vacancy.required_count ?? null,
          filled_count: r.vacancy.filled_count ?? null,
          urgency: r.vacancy.urgency ?? null,
          required_skills: r.vacancy.required_skills ?? [],
          canonical_required_skills: canonicalByVacancy[r.vacancy.id] ?? [],
          required_certifications: r.vacancy.required_certifications ?? [],
          requires_drivers_license: r.vacancy.requires_drivers_license ?? false,
        },
        score: r.breakdown.matchPercent,
        label: r.breakdown.label,
        breakdown: r.breakdown,
      })),
    });
  } catch (err) {
    console.error("rank-vacancies error:", err);
    return json({ error: "Interne fout bij het rangschikken" }, 500);
  }
});
