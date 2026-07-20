// rank-candidates — rangschikt de VOLLEDIGE kandidatenpool voor één vacature, server-side.
//
// Vervangt de oude client-side shortlist (die door .limit(150) op voornaam slechts een fractie
// van de database bekeek). Hier laden we alle in aanmerking komende kandidaten (gepagineerd),
// scoren ze met de gedeelde matching-core, en geven de top N terug — gesorteerd op matchscore.
//
// Auth: ingelogde gebruiker (RLS scoped op de eigen organisatie). verify_jwt staat op false in
// config.toml; we valideren de Bearer-token zelf via auth.getUser().

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { haversineKm, scoreMatch, passesShortlist, MATCHABLE_CANDIDATE_STATUSES, type MatchBreakdown, type MatchCriteriaOptions } from "../_shared/matching-core.ts";
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

// Toelatingspoort: alleen kandidaten die een recruiter heeft toegelaten. Zie
// MATCHABLE_CANDIDATE_STATUSES in _shared/matching-core.ts voor het waarom.
const ACTIVE_STATUSES = [...MATCHABLE_CANDIDATE_STATUSES];
const CANDIDATE_FIELDS =
  "id, first_name, last_name, status, skills, certifications, languages, has_drivers_license, drivers_license_categories, has_dutch_address, compliance_status, address_city, address_lat, address_lng, available_from, available_until, arrival_date, availability_notes, ai_function_group, ai_target_functions, ai_classification, ai_reliability_score, most_recent_role, most_recent_role_year";

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
    const vacancyId = body.vacancy_id as string | undefined;
    const includeWeak = body.include_weak === true;
    const criteriaOptions = normalizeCriteriaOptions(body.criteria_options);
    const scoreOptions = { ...criteriaOptions, nowYear: new Date().getFullYear() };
    // Strip PostgREST-significante tekens (, ( ) % * \) en cap lengte → geen filter-injectie in .or().
    const search = (typeof body.search === "string" ? body.search : "").replace(/[,()%*\\]/g, " ").trim().slice(0, 100);
    const limit = Math.min(Math.max(1, Number(body.limit) || 25), 100);
    const excludeIds: string[] = Array.isArray(body.exclude_candidate_ids) ? body.exclude_candidate_ids : [];
    if (!vacancyId) return json({ error: "vacancy_id required" }, 400);

    // ── Vacature + bedrijfscoördinaten ──
    const { data: vacancy, error: vacErr } = await userClient
      .from("vacancies")
      .select("id, organization_id, title, description, location, start_date, start_date_text, required_skills, required_certifications, requires_drivers_license, companies!vacancies_company_id_fkey(address_lat, address_lng, visit_address_lat, visit_address_lng)")
      .eq("id", vacancyId)
      .single();
    if (vacErr || !vacancy) return json({ error: vacErr?.message ?? "Vacancy not found" }, 404);
    const orgId = vacancy.organization_id;
    const company: any = vacancy.companies ?? {};
    const destLat = company.visit_address_lat ?? company.address_lat ?? null;
    const destLng = company.visit_address_lng ?? company.address_lng ?? null;

    // ── Org-aliassen + canonieke vacature-skills + canonieke kandidaat-skills ──
    const PAGE = 1000;
    const [aliasRes, vacSkillRes] = await Promise.all([
      userClient.from("skill_aliases").select("normalized_alias, skills!inner(name)").eq("organization_id", orgId).eq("is_active", true),
      userClient.from("vacancy_required_skills").select("skills!inner(name)").eq("vacancy_id", vacancyId),
    ]);

    const orgAliases: Record<string, string> = {};
    for (const row of (aliasRes.data ?? []) as any[]) {
      if (row.normalized_alias && row.skills?.name) orgAliases[row.normalized_alias] = row.skills.name;
    }
    const canonicalRequiredSkills = ((vacSkillRes.data ?? []) as any[]).map((r) => r.skills?.name).filter(Boolean);

    // We scoren op de candidates.skills-array (al op de rij) i.p.v. de candidate_skills-join.
    // Bij grote orgs (JA Werkt: ~2000 kandidaten × vele skills = tienduizenden join-rijen) liep de
    // org-brede candidate_skills-fetch tegen de edge-time-out (500 na ~95s). De gedeelde core
    // normaliseert candidate.skills + de org-aliassen toch al, dus matching blijft gelijk.

    // ── Hele eligible pool ophalen (gepagineerd; PostgREST kapt standaard op 1000) ──
    const candidates: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = userClient.from("candidates").select(CANDIDATE_FIELDS)
        .eq("organization_id", orgId)
        .in("status", ACTIVE_STATUSES as any)
        .range(from, from + PAGE - 1);
      if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) return json({ error: "Kon kandidaten niet laden" }, 500);
      const batch = data ?? [];
      candidates.push(...batch);
      if (batch.length < PAGE) break;
    }

    const vacancyForScore = {
      title: vacancy.title,
      description: vacancy.description,
      location: vacancy.location,
      start_date: vacancy.start_date,
      start_date_text: vacancy.start_date_text,
      required_skills: vacancy.required_skills,
      canonical_required_skills: canonicalRequiredSkills,
      required_certifications: vacancy.required_certifications,
      requires_drivers_license: vacancy.requires_drivers_license,
    };

    const excludeSet = new Set(excludeIds);
    const scored = candidates
      .filter((c) => !excludeSet.has(c.id))
      .map((c) => {
        const km = haversineKm(c.address_lat, c.address_lng, destLat, destLng);
        const distance = km != null ? { km, status: "estimated" as const } : { status: "missing_coords" as const };
        const breakdown: MatchBreakdown = scoreMatch(c, vacancyForScore, distance, orgAliases, scoreOptions);
        return { candidate: c, breakdown };
      })
      .filter((r) => passesShortlist(r.breakdown, includeWeak, criteriaOptions))
      .sort((a, b) => {
        const d = b.breakdown.matchPercent - a.breakdown.matchPercent;
        if (d !== 0) return d;
        const s = b.breakdown.skillMatches.length - a.breakdown.skillMatches.length;
        if (s !== 0) return s;
        return `${a.candidate.first_name ?? ""} ${a.candidate.last_name ?? ""}`.localeCompare(`${b.candidate.first_name ?? ""} ${b.candidate.last_name ?? ""}`);
      });

    return json({
      vacancy_id: vacancyId,
      pool_size: candidates.length,
      shortlisted: scored.length,
      results: scored.slice(0, limit).map((r) => ({
        candidate: {
          id: r.candidate.id,
          first_name: r.candidate.first_name,
          last_name: r.candidate.last_name,
          status: r.candidate.status,
          compliance_status: r.candidate.compliance_status,
          address_city: r.candidate.address_city,
          available_from: r.candidate.available_from ?? null,
          available_until: r.candidate.available_until ?? null,
          arrival_date: r.candidate.arrival_date ?? null,
          availability_notes: r.candidate.availability_notes ?? null,
          skills: r.candidate.skills ?? [],
          languages: r.candidate.languages ?? [],
          has_drivers_license: r.candidate.has_drivers_license ?? false,
          has_dutch_address: r.candidate.has_dutch_address ?? false,
        },
        score: r.breakdown.matchPercent,
        candidate_quality: r.breakdown.candidateQuality,
        label: r.breakdown.label,
        breakdown: r.breakdown,
      })),
    });
  } catch (err) {
    console.error("rank-candidates error:", err);
    return json({ error: "Interne fout bij het rangschikken" }, 500);
  }
});
