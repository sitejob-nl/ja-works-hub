import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MatchDistance = {
  distanceKm?: number | null;
  durationMin?: number | null;
  status?: "ok" | "missing_coords" | "provider_error" | "unknown" | string | null;
};

const SKILL_ALIASES: Record<string, string> = {
  migmag: "mig mag lassen",
  "mig mag": "mig mag lassen",
  "mig-mag": "mig mag lassen",
  "mig/mag": "mig mag lassen",
  heftruckchauffeur: "heftruck",
  heftruckcertificaat: "heftruck",
  "vca vol": "vca",
  "vca basis": "vca",
};

const normalize = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return SKILL_ALIASES[normalized] ?? normalized;
};

const asStrings = (values: unknown): string[] =>
  Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];

const matchRequiredValues = (candidateValues: unknown, requiredValues: unknown) => {
  const normalizedCandidates = new Set(asStrings(candidateValues).map(normalize));
  return asStrings(requiredValues).filter((required) => normalizedCandidates.has(normalize(required)));
};

const missingRequiredValues = (candidateValues: unknown, requiredValues: unknown) => {
  const matches = new Set(matchRequiredValues(candidateValues, requiredValues).map(normalize));
  return asStrings(requiredValues).filter((required) => !matches.has(normalize(required)));
};

const ratioScore = (matches: number, total: number, weight: number) => {
  if (total === 0) return weight;
  return Math.round((matches / total) * weight);
};

const hasFunctionSignal = (candidate: any, vacancy: any) => {
  const title = normalize(vacancy.title ?? "");
  if (!title) return false;
  const signals = [
    candidate.ai_function_group,
    ...(candidate.ai_target_functions ?? []),
    ...(candidate.skills ?? []),
    ...(candidate.canonical_skills ?? []),
  ].filter(Boolean).map((value) => normalize(String(value)));
  return signals.some((signal) => signal.length >= 3 && (title.includes(signal) || signal.includes(title)));
};

const reliabilityScore = (candidate: any) => {
  if (typeof candidate.ai_reliability_score !== "number") return 5;
  const reliability = candidate.ai_reliability_score <= 10 ? candidate.ai_reliability_score * 10 : candidate.ai_reliability_score;
  if (reliability >= 80) return 10;
  if (reliability >= 60) return 7;
  if (reliability >= 40) return 4;
  return 1;
};

const distanceScore = (distance?: MatchDistance) => {
  if (!distance || distance.status !== "ok" || typeof distance.durationMin !== "number") return 6;
  if (distance.durationMin <= 30) return 12;
  if (distance.durationMin <= 45) return 10;
  if (distance.durationMin <= 60) return 7;
  if (distance.durationMin <= 90) return 4;
  return 1;
};

const distanceText = (distance?: MatchDistance) => {
  if (!distance || distance.status !== "ok" || typeof distance.durationMin !== "number") return "Reistijd onbekend";
  const km = typeof distance.distanceKm === "number" ? `, ${Math.round(distance.distanceKm)} km` : "";
  return `${Math.round(distance.durationMin)} min reistijd${km}`;
};

const calculateBreakdown = (candidate: any, vacancy: any, distance?: MatchDistance) => {
  const candidateSkills = asStrings(candidate.canonical_skills).length > 0 ? candidate.canonical_skills : candidate.skills;
  const requiredSkills = asStrings(vacancy.canonical_required_skills).length > 0 ? vacancy.canonical_required_skills : vacancy.required_skills;
  const requiredCertifications = asStrings(vacancy.required_certifications);
  const skillMatches = matchRequiredValues(candidateSkills, requiredSkills);
  const certificationMatches = matchRequiredValues(candidate.certifications, requiredCertifications);
  const missingSkills = missingRequiredValues(candidateSkills, requiredSkills);
  const missingCertifications = missingRequiredValues(candidate.certifications, requiredCertifications);
  const hardBlocks: string[] = [];
  const positives: string[] = [];
  const missing: string[] = [];

  if (requiredSkills.length > 0 && skillMatches.length === 0) hardBlocks.push("Geen match op verplichte vaardigheden");
  if (missingCertifications.length > 0) hardBlocks.push(`Mist certificaat: ${missingCertifications.join(", ")}`);
  if (vacancy.requires_drivers_license && !candidate.has_drivers_license) hardBlocks.push("Rijbewijs vereist, maar niet aanwezig");

  if (skillMatches.length > 0) positives.push(`Vaardigheden: ${skillMatches.join(", ")}`);
  if (certificationMatches.length > 0) positives.push(`Certificaten: ${certificationMatches.join(", ")}`);
  if (vacancy.requires_drivers_license && candidate.has_drivers_license) positives.push("Rijbewijs aanwezig");
  if (distance?.status === "ok" && typeof distance.durationMin === "number") positives.push(distanceText(distance));
  if (candidate.availability_notes) positives.push("Beschikbaarheid ingevuld");

  if (missingSkills.length > 0) missing.push(`Ontbrekende vaardigheden: ${missingSkills.join(", ")}`);
  if (missingCertifications.length > 0) missing.push(`Ontbrekende certificaten: ${missingCertifications.join(", ")}`);
  if (vacancy.location && distance?.status !== "ok") missing.push("Reistijd nog controleren");
  if (distance?.status === "ok" && typeof distance.durationMin === "number" && distance.durationMin > 60) {
    missing.push(`Lange reistijd: ${distanceText(distance)}`);
  }
  if (!candidate.availability_notes) missing.push("Beschikbaarheid nog controleren");

  const componentScores = {
    skills: ratioScore(skillMatches.length, requiredSkills.length, 35),
    certifications: ratioScore(certificationMatches.length, requiredCertifications.length, 20),
    functionGroup: hasFunctionSignal(candidate, vacancy) ? 15 : 0,
    distance: distanceScore(distance),
    availability: candidate.availability_notes ? 10 : 3,
    reliability: reliabilityScore(candidate),
  };
  const rawScore = Object.values(componentScores).reduce((sum, score) => sum + score, 0);
  const matchPercent = Math.max(0, Math.min(100, rawScore - (hardBlocks.length > 0 ? 20 : 0)));
  const label = hardBlocks.length > 0 || matchPercent < 45 ? "rood" : matchPercent >= 75 ? "groen" : "oranje";
  const reasoningParts = [
    `${matchPercent}% match`,
    positives.length ? positives.join("; ") : "Geen sterke matchsignalen gevonden",
    missing.length ? missing.join("; ") : "Geen ontbrekende Fase 1-eisen zichtbaar",
    hardBlocks.length ? `Blokkers: ${hardBlocks.join("; ")}` : "",
  ].filter(Boolean);

  return {
    matchPercent,
    label,
    hardBlocks,
    positives,
    missing,
    skillMatches,
    certificationMatches,
    distance: {
      distanceKm: distance?.distanceKm ?? null,
      durationMin: distance?.durationMin ?? null,
      status: distance?.status ?? "unknown",
    },
    componentScores,
    reasoning: reasoningParts.join(". "),
  };
};

async function getDistance(serviceClient: any, candidate: any, vacancy: any): Promise<MatchDistance> {
  const existing = await serviceClient
    .from("match_distance_cache")
    .select("distance_km, duration_min, status, expires_at")
    .eq("candidate_id", candidate.id)
    .eq("vacancy_id", vacancy.id)
    .eq("provider", "mapbox")
    .maybeSingle();

  if (existing.data && new Date(existing.data.expires_at).getTime() > Date.now()) {
    return {
      distanceKm: existing.data.distance_km,
      durationMin: existing.data.duration_min,
      status: existing.data.status,
    };
  }

  const destinationLat = vacancy.companies?.visit_address_lat ?? vacancy.companies?.address_lat ?? null;
  const destinationLng = vacancy.companies?.visit_address_lng ?? vacancy.companies?.address_lng ?? null;
  const originLat = candidate.address_lat ?? null;
  const originLng = candidate.address_lng ?? null;

  if (originLat == null || originLng == null || destinationLat == null || destinationLng == null) {
    const distance = { distanceKm: null, durationMin: null, status: "missing_coords" as const };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  }

  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? Deno.env.get("VITE_MAPBOX_TOKEN");
  if (!token) {
    const distance = { distanceKm: null, durationMin: null, status: "provider_error" as const };
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
    const distance = {
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
      status: "ok" as const,
    };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  } catch (error) {
    console.error("Mapbox distance failed", error);
    const distance = { distanceKm: null, durationMin: null, status: "provider_error" as const };
    await upsertDistance(serviceClient, candidate, vacancy, originLat, originLng, destinationLat, destinationLng, distance);
    return distance;
  }
}

async function upsertDistance(
  serviceClient: any,
  candidate: any,
  vacancy: any,
  originLat: number | null,
  originLng: number | null,
  destinationLat: number | null,
  destinationLng: number | null,
  distance: MatchDistance,
) {
  await serviceClient.from("match_distance_cache").upsert({
    organization_id: candidate.organization_id,
    candidate_id: candidate.id,
    vacancy_id: vacancy.id,
    origin_lat: originLat,
    origin_lng: originLng,
    destination_lat: destinationLat,
    destination_lng: destinationLng,
    distance_km: distance.distanceKm ?? null,
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
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { match_id, candidate_id, vacancy_id } = await req.json();
    if (!candidate_id || !vacancy_id) {
      return new Response(JSON.stringify({ error: "candidate_id and vacancy_id required" }), { status: 400, headers: corsHeaders });
    }

    const { data: candidate, error: candidateError } = await userClient
      .from("candidates")
      .select("id, organization_id, first_name, last_name, skills, certifications, has_drivers_license, address_city, address_lat, address_lng, availability_notes, ai_function_group, ai_target_functions, ai_reliability_score")
      .eq("id", candidate_id)
      .single();
    if (candidateError) throw candidateError;

    const { data: vacancy, error: vacancyError } = await userClient
      .from("vacancies")
      .select("id, organization_id, title, required_skills, required_certifications, requires_drivers_license, location, companies!vacancies_company_id_fkey(id, name, address_lat, address_lng, visit_address_lat, visit_address_lng)")
      .eq("id", vacancy_id)
      .single();
    if (vacancyError) throw vacancyError;

    const [candidateSkillRows, vacancySkillRows] = await Promise.all([
      userClient
        .from("candidate_skills")
        .select("skills!inner(name)")
        .eq("candidate_id", candidate_id),
      userClient
        .from("vacancy_required_skills")
        .select("skills!inner(name)")
        .eq("vacancy_id", vacancy_id),
    ]);

    if (candidateSkillRows.error) throw candidateSkillRows.error;
    if (vacancySkillRows.error) throw vacancySkillRows.error;

    const enrichedCandidate = {
      ...candidate,
      canonical_skills: (candidateSkillRows.data ?? []).map((row: any) => row.skills?.name).filter(Boolean),
    };
    const enrichedVacancy = {
      ...vacancy,
      canonical_required_skills: (vacancySkillRows.data ?? []).map((row: any) => row.skills?.name).filter(Boolean),
    };

    const distance = await getDistance(serviceClient, candidate, vacancy);
    const breakdown = calculateBreakdown(enrichedCandidate, enrichedVacancy, distance);

    if (match_id) {
      await serviceClient
        .from("matches")
        .update({
          match_score: breakdown.matchPercent,
          match_reasoning: breakdown.reasoning,
          match_breakdown: breakdown,
          distance_km: breakdown.distance.distanceKm,
          duration_min: breakdown.distance.durationMin,
        })
        .eq("id", match_id);
    }

    return new Response(JSON.stringify({
      score: breakdown.matchPercent,
      reasoning: breakdown.reasoning,
      breakdown,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("calculate-match error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
