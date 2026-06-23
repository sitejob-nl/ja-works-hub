// calculate-match — scoort één kandidaat↔vacature-paar en persisteert (optioneel) op de match.
//
// Gebruikt de gedeelde matching-core (DRY: zelfde logica als rank-candidates en de vitest-tests)
// en verrijkt met de PRECIEZE Mapbox-reistijd (rank-candidates gebruikt hemelsbrede afstand voor
// de hele pool; hier, op één paar, halen we de echte reistijd op).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scoreMatch, type DistanceInfo, type MatchCriteriaOptions } from "../_shared/matching-core.ts";
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

async function getDistance(serviceClient: any, candidate: any, vacancy: any): Promise<DistanceInfo> {
  const existing = await serviceClient
    .from("match_distance_cache")
    .select("distance_km, duration_min, status, expires_at")
    .eq("organization_id", candidate.organization_id)
    .eq("candidate_id", candidate.id)
    .eq("vacancy_id", vacancy.id)
    .eq("provider", "mapbox")
    .maybeSingle();

  if (existing.data && new Date(existing.data.expires_at).getTime() > Date.now()) {
    return { km: existing.data.distance_km, durationMin: existing.data.duration_min, status: existing.data.status };
  }

  const destinationLat = vacancy.companies?.visit_address_lat ?? vacancy.companies?.address_lat ?? null;
  const destinationLng = vacancy.companies?.visit_address_lng ?? vacancy.companies?.address_lng ?? null;
  const originLat = candidate.address_lat ?? null;
  const originLng = candidate.address_lng ?? null;

  if (originLat == null || originLng == null || destinationLat == null || destinationLng == null) {
    const distance: DistanceInfo = { km: null, durationMin: null, status: "missing_coords" };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  }

  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? Deno.env.get("VITE_MAPBOX_TOKEN");
  if (!token) {
    const distance: DistanceInfo = { km: null, durationMin: null, status: "provider_error" };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  }

  try {
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destinationLng},${destinationLat}`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("overview", "false");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Mapbox returned ${response.status}`);
    const payload = await response.json();
    const route = payload.routes?.[0];
    if (!route) throw new Error("Mapbox returned no route");
    const distance: DistanceInfo = {
      km: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
      status: "ok",
    };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  } catch (error) {
    console.error("Mapbox distance failed", error);
    const distance: DistanceInfo = { km: null, durationMin: null, status: "provider_error" };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  }
}

async function upsertDistance(
  serviceClient: any, candidate: any, vacancy: any,
  originLat: number | null, originLng: number | null, destinationLat: number | null, destinationLng: number | null,
  distance: DistanceInfo,
) {
  await serviceClient.from("match_distance_cache").upsert({
    organization_id: candidate.organization_id,
    candidate_id: candidate.id,
    vacancy_id: vacancy.id,
    origin_lat: originLat, origin_lng: originLng,
    destination_lat: destinationLat, destination_lng: destinationLng,
    distance_km: distance.km ?? null,
    duration_min: distance.durationMin ?? null,
    provider: "mapbox",
    status: distance.status ?? "provider_error",
    calculated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "candidate_id,vacancy_id,provider" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { match_id, candidate_id, vacancy_id, criteria_options } = await req.json();
    const criteriaOptions = normalizeCriteriaOptions(criteria_options);
    if (!candidate_id || !vacancy_id) return json({ error: "candidate_id and vacancy_id required" }, 400);

    const { data: candidate, error: candidateError } = await userClient
      .from("candidates")
      .select("id, organization_id, first_name, last_name, skills, certifications, languages, has_drivers_license, drivers_license_categories, has_dutch_address, address_city, address_lat, address_lng, available_from, available_until, arrival_date, availability_notes, ai_function_group, ai_target_functions, ai_classification, ai_reliability_score")
      .eq("id", candidate_id)
      .single();
    if (candidateError) throw candidateError;

    const { data: vacancy, error: vacancyError } = await userClient
      .from("vacancies")
      .select("id, organization_id, title, description, required_skills, required_certifications, requires_drivers_license, location, start_date, start_date_text, companies!vacancies_company_id_fkey(id, name, address_lat, address_lng, visit_address_lat, visit_address_lng)")
      .eq("id", vacancy_id)
      .single();
    if (vacancyError) throw vacancyError;

    const [candidateSkillRows, vacancySkillRows, aliasRows] = await Promise.all([
      userClient.from("candidate_skills").select("skills!inner(name)").eq("candidate_id", candidate_id),
      userClient.from("vacancy_required_skills").select("skills!inner(name)").eq("vacancy_id", vacancy_id),
      userClient.from("skill_aliases").select("normalized_alias, skills!inner(name)").eq("organization_id", candidate.organization_id).eq("is_active", true),
    ]);
    if (candidateSkillRows.error) throw candidateSkillRows.error;
    if (vacancySkillRows.error) throw vacancySkillRows.error;

    const orgAliases: Record<string, string> = {};
    for (const row of (aliasRows.data ?? []) as any[]) {
      if (row.normalized_alias && row.skills?.name) orgAliases[row.normalized_alias] = row.skills.name;
    }

    const enrichedCandidate = {
      ...candidate,
      canonical_skills: (candidateSkillRows.data ?? []).map((row: any) => row.skills?.name).filter(Boolean),
    };
    const enrichedVacancy = {
      ...vacancy,
      canonical_required_skills: (vacancySkillRows.data ?? []).map((row: any) => row.skills?.name).filter(Boolean),
    };

    const distance = await getDistance(serviceClient, candidate, vacancy);
    const breakdown = scoreMatch(enrichedCandidate, enrichedVacancy, distance, orgAliases, criteriaOptions);

    if (match_id) {
      // Tenant-scope op organization_id: een vreemd/cross-tenant match_id wordt zo een no-op
      // i.p.v. een ongeautoriseerde write (de service-role omzeilt anders RLS).
      const { error: updErr } = await serviceClient
        .from("matches")
        .update({
          match_score: breakdown.matchPercent,
          match_reasoning: breakdown.reasoning,
          match_breakdown: breakdown,
          distance_km: breakdown.distance.km,
          duration_min: breakdown.distance.durationMin,
        })
        .eq("id", match_id)
        .eq("organization_id", candidate.organization_id);
      if (updErr) throw updErr;
    }

    return json({ score: breakdown.matchPercent, reasoning: breakdown.reasoning, breakdown });
  } catch (err) {
    console.error("calculate-match error:", err);
    return json({ error: "Interne fout bij het berekenen van de match" }, 500);
  }
});
