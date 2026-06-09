// Matching-kern — DE ENIGE bron van waarheid voor de vacature↔kandidaat-scoring.
//
// Pure, runtime-agnostische TypeScript: GEEN Deno-, Node- of externe imports, zodat dit
// bestand zowel door de edge functions (calculate-match, rank-candidates, Deno) als door de
// vitest-tests (Node) geïmporteerd kan worden. Eén implementatie → geen drift meer.
//
// Ontwerpprincipes (matching-v3):
//  1. Genormaliseerde weging: niet-van-toepassing-zijnde criteria (geen vereiste skills/certs,
//     onbekende afstand) tellen NIET mee in de noemer i.p.v. gratis punten te geven. Zo blaast
//     een vacature zonder eisen de scores niet meer op.
//  2. Matchscore (fit) staat LOS van kandidaatkwaliteit (AI-betrouwbaarheid) — die geven we als
//     apart getal terug (besluit meeting 27-05).
//  3. Nederlands spreken en eigen accommodatie zijn PLUSPUNTEN (additieve bonus, géén straf bij
//     afwezigheid) — conform de JA Werkt-criteria.
//  4. Harde blokkers (geen skill-match terwijl vereist, ontbrekend certificaat, ontbrekend
//     rijbewijs) → rood + score gekapt.

export type DistanceInfo = {
  km?: number | null;
  distanceKm?: number | null; // back-compat alias van km in persisted breakdowns
  durationMin?: number | null;
  status?: "ok" | "estimated" | "missing_coords" | "provider_error" | "unknown" | string | null;
};

export type MatchCandidate = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  skills?: string[] | null;
  canonical_skills?: string[] | null;
  certifications?: string[] | null;
  languages?: string[] | null;
  has_drivers_license?: boolean | null;
  has_dutch_address?: boolean | null;
  availability_notes?: string | null;
  ai_function_group?: string | null;
  ai_target_functions?: string[] | null;
  ai_classification?: string | null; // 'specialist' | 'productie' (uit CV-analyse)
  ai_reliability_score?: number | null;
  address_lat?: number | null;
  address_lng?: number | null;
};

export type MatchVacancy = {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  required_skills?: string[] | null;
  canonical_required_skills?: string[] | null;
  required_certifications?: string[] | null;
  requires_drivers_license?: boolean | null;
  prefers_dutch_speaker?: boolean | null; // default true
};

export type MatchBreakdown = {
  matchPercent: number;            // 0-100, ALLEEN vacature-fit
  candidateQuality: number | null; // 0-100 algemene AI-kwaliteit, LOS van de match
  label: "groen" | "oranje" | "rood";
  hardBlocks: string[];
  positives: string[];
  missing: string[];
  bonuses: string[];
  skillMatches: string[];
  certificationMatches: string[];
  distance: DistanceInfo;
  componentScores: Record<string, number>;
  reasoning: string;
};

export type MatchCriteriaOptions = {
  minScore?: number | null;
  requireSkillSignal?: boolean | null;
  requireKnownDistance?: boolean | null;
  weights?: Partial<typeof FIT_WEIGHTS> | null;
  bonusPoints?: Partial<typeof BONUS_POINTS> | null;
};

// Genormaliseerde basis-weging (fit). Som van toepasselijke gewichten wordt naar 100 geschaald.
export const FIT_WEIGHTS = {
  skills: 50,        // alleen van toepassing als de vacature vereiste skills heeft
  certifications: 13, // alleen van toepassing als de vacature vereiste certificaten heeft
  functionGroup: 12,
  distance: 20,      // alleen van toepassing als afstand BEKEND is (coördinaten) — anders niet meegeteld
  availability: 5,   // alleen van toepassing als beschikbaarheid is INGEVULD — anders niet meegeteld
};
// Additieve pluspunten (geen straf bij afwezigheid), bovenop de fit, gekapt op 100.
export const BONUS_POINTS = {
  language: 6,       // spreekt Nederlands
  accommodation: 4,  // eigen (NL) accommodatie
  license: 5,        // rijbewijs aanwezig terwijl de vacature er om vraagt
};

const DUTCH_LANGUAGE_KEYS = new Set(["nederlands", "nederland", "dutch", "nl"]);

// ── Skill-normalisatie + alias-map ────────────────────────────────────────────
// Deze hardcoded fallback-aliassen dekken de Fase-1-blue-collar-termen. Org-specifieke
// aliassen uit de skill_aliases-tabel worden er door de edge function bovenop gelegd.
const SKILL_ALIAS_ENTRIES: Array<[string, string]> = [
  ["mig", "mig mag lassen"], ["mag", "mig mag lassen"], ["migmag", "mig mag lassen"],
  ["mig mag", "mig mag lassen"], ["mig mag lasser", "mig mag lassen"], ["mig-mag", "mig mag lassen"],
  ["mig-mag lasser", "mig mag lassen"], ["mig/mag", "mig mag lassen"], ["mig/mag lasser", "mig mag lassen"],
  ["migmag lassen", "mig mag lassen"], ["lassen mig mag", "mig mag lassen"],
  ["co2 lasser", "mig mag lassen"], ["co2 lassen", "mig mag lassen"],
  ["tig lasser", "tig lassen"], ["tig welding", "tig lassen"],
  ["lasser samensteller", "constructie samenstellen"], ["samensteller", "constructie samenstellen"],
  ["constructiebankwerker", "constructie samenstellen"], ["constructie samensteller", "constructie samenstellen"],
  ["assembler", "assemblage"], ["assembly", "assemblage"], ["assemblage medewerker", "assemblage"],
  ["montage medewerker", "assemblage"], ["monteur assemblage", "assemblage"],
  ["cnc operator", "cnc"], ["machine operator", "operator"], ["machinebediener", "operator"],
  ["logistiek medewerker", "logistiek"], ["magazijn medewerker", "magazijnwerk"],
  ["magazijnmedewerker", "magazijnwerk"], ["warehouse worker", "magazijnwerk"],
  ["heftruck chauffeur", "heftruck"], ["heftruck rijden", "heftruck"], ["heftruck bestuurder", "heftruck"],
  ["heftruck certificaat", "heftruck"], ["heftruck certificatie", "heftruck"], ["heftruckchauffeur", "heftruck"],
  ["heftruckcertificaat", "heftruck"], ["heftruckcertificatie", "heftruck"],
  ["forklift", "heftruck"], ["forklift driver", "heftruck"], ["forklift operator", "heftruck"],
  ["reachtruck chauffeur", "reachtruck"], ["reachtruck rijden", "reachtruck"], ["reachtruck certificaat", "reachtruck"],
  ["reachtruckchauffeur", "reachtruck"], ["reachtruckcertificaat", "reachtruck"], ["reach truck", "reachtruck"],
  ["electro pallet truck", "ept"], ["elektrische pallet truck", "ept"], ["elektrische pallettruck", "ept"],
  ["pompwagen elektrisch", "ept"],
  ["order picking", "orderpicken"], ["order picken", "orderpicken"], ["orderpicker", "orderpicken"],
  ["orders picken", "orderpicken"],
  ["productie medewerker", "productiewerk"], ["productiemedewerker", "productiewerk"], ["productie werk", "productiewerk"],
  ["productiekracht", "productiewerk"], ["production worker", "productiewerk"], ["productie", "productiewerk"],
  ["inpakker", "inpakken"], ["inpakwerk", "inpakken"], ["packer", "inpakken"], ["packing", "inpakken"],
  ["verpakken", "inpakken"],
  ["qc", "kwaliteitscontrole"], ["quality control", "kwaliteitscontrole"], ["kwaliteits controle", "kwaliteitscontrole"],
  ["controle kwaliteit", "kwaliteitscontrole"],
  ["scannen", "scanner werken"], ["scanner", "scanner werken"], ["scannerwerk", "scanner werken"],
  ["handscanner", "scanner werken"], ["rf scanner", "scanner werken"], ["rf-scanner", "scanner werken"],
  ["tekening lezen", "technische tekening lezen"], ["technische tekeningen lezen", "technische tekening lezen"],
  ["technisch tekening lezen", "technische tekening lezen"], ["technical drawing", "technische tekening lezen"],
  ["blueprint reading", "technische tekening lezen"],
  ["vca basis", "vca"], ["vca vol", "vca"], ["vca certificaat", "vca"], ["vca diploma", "vca"],
  ["basisveiligheid vca", "vca"], ["veiligheid checklist aannemers", "vca"],
  ["haccp certificaat", "haccp"], ["haccp diploma", "haccp"], ["food safety", "haccp"], ["voedselveiligheid", "haccp"],
  ["schoonmaak", "schoonmaken"], ["schoonmaker", "schoonmaken"], ["cleaning", "schoonmaken"], ["cleaner", "schoonmaken"],
];

export const normalizeAliasKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const BASE_ALIASES: Record<string, string> = Object.fromEntries(
  SKILL_ALIAS_ENTRIES.map(([alias, canonical]) => [normalizeAliasKey(alias), normalizeAliasKey(canonical)]),
);

// Maak een normalizer met optionele org-aliassen (normalizedAlias → canonicalName).
export function makeNormalizer(orgAliases?: Record<string, string>) {
  const merged: Record<string, string> = { ...BASE_ALIASES };
  if (orgAliases) {
    for (const [k, v] of Object.entries(orgAliases)) merged[normalizeAliasKey(k)] = normalizeAliasKey(v);
  }
  return (value: string): string => {
    const normalized = normalizeAliasKey(value);
    return merged[normalized] ?? normalized;
  };
}

export const normalizeSkillName = makeNormalizer();

const asStrings = (values: unknown): string[] =>
  Array.isArray(values) ? values.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];

const matchValues = (candidateValues: unknown, requiredValues: unknown, norm: (s: string) => string) => {
  // Lege genormaliseerde waarden overslaan: anders matchen twee onmapbare termen via "" op elkaar.
  const candSet = new Set(asStrings(candidateValues).map(norm).filter(Boolean));
  return asStrings(requiredValues).filter((req) => { const n = norm(req); return n !== "" && candSet.has(n); });
};
const missingValues = (candidateValues: unknown, requiredValues: unknown, norm: (s: string) => string) => {
  const matched = new Set(matchValues(candidateValues, requiredValues, norm).map(norm));
  return asStrings(requiredValues).filter((req) => { const n = norm(req); return n !== "" && !matched.has(n); });
};

// Hemelsbrede afstand (km) tussen twee coördinaten — gratis proxy voor ranking over de hele pool.
export function haversineKm(lat1?: number | null, lng1?: number | null, lat2?: number | null, lng2?: number | null): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

// Fractie 0-1 voor het afstandssignaal. Prefereert reistijd (Mapbox) boven hemelsbrede km.
function distanceFraction(distance?: DistanceInfo): number | null {
  if (!distance) return null; // geen afstand-info meegegeven → niet van toepassing (geen straf)
  if (typeof distance.durationMin === "number" && (distance.status === "ok")) {
    const m = distance.durationMin;
    if (m <= 30) return 1; if (m <= 45) return 0.85; if (m <= 60) return 0.6; if (m <= 90) return 0.3; return 0.1;
  }
  if (typeof distance.km === "number" && (distance.status === "ok" || distance.status === "estimated")) {
    const km = distance.km;
    if (km <= 10) return 1; if (km <= 25) return 0.8; if (km <= 50) return 0.55; if (km <= 80) return 0.3; return 0.1;
  }
  // Locatie onbekend (geen coördinaten / provider-fout): NIET meetellen (geen straf). Afstand
  // weegt alleen mee als ze bekend is; kandidaten met een bekend dichtbij-adres krijgen daardoor
  // een positieve bijdrage en ranken vanzelf boven kandidaten zonder locatie — zonder dat de hele
  // pool omlaag wordt getrokken zolang adressen nog niet gegeocodeerd zijn (klant-keuze).
  return null;
}

function distanceText(distance?: DistanceInfo): string {
  if (distance?.status === "ok" && typeof distance.durationMin === "number") {
    const km = typeof distance.km === "number" ? `, ${Math.round(distance.km)} km` : "";
    return `${Math.round(distance.durationMin)} min reistijd${km}`;
  }
  if ((distance?.status === "estimated" || distance?.status === "ok") && typeof distance?.km === "number") {
    return `±${Math.round(distance.km)} km (hemelsbreed)`;
  }
  return "Afstand onbekend";
}

function speaksDutch(candidate: MatchCandidate, norm: (s: string) => string): boolean {
  // Talen worden vaak als "Nederlands - B1" / "Nederlands - basis" opgeslagen, niet kaal
  // "Nederlands". Daarom token-gewijs checken i.p.v. exacte match.
  return asStrings(candidate.languages).some((l) =>
    normalizeAliasKey(l).split(" ").some((tok) => DUTCH_LANGUAGE_KEYS.has(tok)));
}

// Generieke rol-vullers die op zichzelf géén functie-match mogen vormen.
const FUNCTION_STOPWORDS = new Set([
  "medewerker", "werker", "werknemer", "kracht", "ervaring", "ervaren", "algemeen", "allround",
  "oproep", "parttime", "fulltime", "fulltimer", "junior", "senior", "assistent", "vacature",
]);

function meaningfulTokens(value: string): Set<string> {
  return new Set(value.split(" ").filter((t) => t.length >= 4 && !FUNCTION_STOPWORDS.has(t)));
}

function hasFunctionSignal(candidate: MatchCandidate, vacancy: MatchVacancy): boolean {
  // Fuzzy titel-signaal: RAUW normaliseren (zonder alias-mapping), anders ontstaat asymmetrie —
  // een losse skill 'productie' wordt door de alias 'productiewerk', terwijl het titel-token
  // 'productie' rauw blijft, waardoor ze niet matchen.
  const vacancyText = normalizeAliasKey([vacancy.title, vacancy.description].filter(Boolean).join(" "));
  if (!vacancyText) return false;
  const title = normalizeAliasKey(vacancy.title ?? "");
  const titleTokens = meaningfulTokens(vacancyText);
  const signals = [
    candidate.ai_function_group,
    ...(candidate.ai_target_functions ?? []),
    ...(candidate.skills ?? []),
    ...(candidate.canonical_skills ?? []),
  ].filter(Boolean).map((v) => normalizeAliasKey(String(v)));
  // Match op exacte (alias-)gelijkheid of op een gedéélde betekenisvolle token (>=4 tekens,
  // geen stopwoord). Géén losse substring-bevatting meer → geen false positives als 'medewerker'/'ict'.
  for (const signal of signals) {
    if (!signal) continue;
    if (signal === title) return true;
    const sigTokens = meaningfulTokens(signal);
    for (const t of sigTokens) if (titleTokens.has(t)) return true;
  }
  return false;
}

// AI-betrouwbaarheid → 0-100 (los van de match).
export function candidateQualityScore(candidate: MatchCandidate): number | null {
  if (typeof candidate.ai_reliability_score !== "number") return null;
  const r = candidate.ai_reliability_score <= 10 ? candidate.ai_reliability_score * 10 : candidate.ai_reliability_score;
  return Math.max(0, Math.min(100, Math.round(r)));
}

function sanitizeWeights(options?: MatchCriteriaOptions) {
  const weights = { ...FIT_WEIGHTS, ...(options?.weights ?? {}) };
  const bonusPoints = { ...BONUS_POINTS, ...(options?.bonusPoints ?? {}) };
  for (const key of Object.keys(weights) as Array<keyof typeof FIT_WEIGHTS>) {
    const value = Number(weights[key]);
    weights[key] = Number.isFinite(value) && value >= 0 ? value : FIT_WEIGHTS[key];
  }
  for (const key of Object.keys(bonusPoints) as Array<keyof typeof BONUS_POINTS>) {
    const value = Number(bonusPoints[key]);
    bonusPoints[key] = Number.isFinite(value) && value >= 0 ? value : BONUS_POINTS[key];
  }
  return { weights, bonusPoints };
}

export function scoreMatch(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  distance?: DistanceInfo,
  orgAliases?: Record<string, string>,
  options?: MatchCriteriaOptions,
): MatchBreakdown {
  const norm = makeNormalizer(orgAliases);
  const { weights, bonusPoints } = sanitizeWeights(options);
  const candidateSkills = asStrings(candidate.canonical_skills).length > 0 ? candidate.canonical_skills : candidate.skills;
  const requiredSkills = asStrings(vacancy.canonical_required_skills).length > 0 ? vacancy.canonical_required_skills : vacancy.required_skills;
  const requiredCerts = asStrings(vacancy.required_certifications);

  const skillMatches = matchValues(candidateSkills, requiredSkills, norm);
  const certMatches = matchValues(candidate.certifications, requiredCerts, norm);
  const missingSkills = missingValues(candidateSkills, requiredSkills, norm);
  const missingCerts = missingValues(candidate.certifications, requiredCerts, norm);

  const hardBlocks: string[] = [];
  const positives: string[] = [];
  const missing: string[] = [];
  const bonuses: string[] = [];

  const reqSkillCount = asStrings(requiredSkills).length;
  const reqCertCount = requiredCerts.length;

  if (reqSkillCount > 0 && skillMatches.length === 0) hardBlocks.push("Geen match op verplichte vaardigheden");
  if (missingCerts.length > 0) hardBlocks.push(`Mist certificaat: ${missingCerts.join(", ")}`);
  // Rijbewijs is GEEN harde blokker: de kandidaat-rijbewijsdata is onbetrouwbaar/leeg (zelden
  // uit CV's overgenomen), dus erop blokkeren verbergt goede kandidaten onterecht. Het telt
  // als pluspunt mee (zie hieronder); een gevraagd-maar-ontbrekend rijbewijs is een aandachtspunt.

  // ── Genormaliseerde fit ──────────────────────────────────────────────────
  const distFrac = distanceFraction(distance);
  const components: Array<{ key: string; weight: number; fraction: number }> = [];
  if (reqSkillCount > 0) components.push({ key: "skills", weight: weights.skills, fraction: skillMatches.length / reqSkillCount });
  if (reqCertCount > 0) components.push({ key: "certifications", weight: weights.certifications, fraction: certMatches.length / reqCertCount });
  const functionMatched = hasFunctionSignal(candidate, vacancy);
  components.push({ key: "functionGroup", weight: weights.functionGroup, fraction: functionMatched ? 1 : 0 });
  if (distFrac != null) components.push({ key: "distance", weight: weights.distance, fraction: distFrac });
  // Beschikbaarheid telt alleen mee als ze ingevuld is (anders niet-van-toepassing, geen straf).
  if (candidate.availability_notes) components.push({ key: "availability", weight: weights.availability, fraction: 1 });

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const fit = totalWeight > 0 ? components.reduce((s, c) => s + c.fraction * c.weight, 0) / totalWeight * 100 : 0;

  // ── Pluspunten (additief, geen straf) ────────────────────────────────────
  const wantsDutch = vacancy.prefers_dutch_speaker !== false;
  let bonus = 0;
  if (wantsDutch && speaksDutch(candidate, norm)) { bonus += bonusPoints.language; bonuses.push("Spreekt Nederlands"); }
  if (candidate.has_dutch_address) { bonus += bonusPoints.accommodation; bonuses.push("Eigen accommodatie in NL"); }
  if (vacancy.requires_drivers_license && candidate.has_drivers_license) { bonus += bonusPoints.license; bonuses.push("Rijbewijs aanwezig"); }

  // ── Eindscore ─────────────────────────────────────────────────────────────
  // matchPercent (incl. bonus) is voor ranking/weergave. Het LABEL leiden we af van de fit
  // (zonder bonus) zodat een pluspunt het label niet alléén optilt, én 'groen' vereist minstens
  // één positief gematchte HARDE eis — anders kan een eisloze vacature niet vals 'groen' worden.
  const hardMatched = skillMatches.length > 0 || certMatches.length > 0;
  let matchPercent = Math.round(Math.max(0, Math.min(100, fit + bonus)));
  if (hardBlocks.length > 0) matchPercent = Math.min(matchPercent, 30); // blokkers zakken altijd weg

  // ── Functie-groep-guard ────────────────────────────────────────────────────
  // Een als 'specialist' geclassificeerde kandidaat (bv. elektromechanisch monteur, lasser)
  // zonder ENIGE vak-affiniteit met de vacature — geen gematchte skill én geen functie-titel-
  // signaal — mag niet hoog scoren op een generieke/productierol (klacht Jeroen 03-06: specialist
  // 81% op 'productiemedewerker'). We cappen onder de shortlist-drempel i.p.v. hard te blokkeren:
  // de kandidaat blijft vindbaar via 'toon ook zwakke matches', maar komt niet vanzelf bovendrijven.
  // Bewust ALLEEN voor specialisten: productie-kandidaten worden nooit geraakt (geen vals-negatief
  // door fuzzy titel-tokenisatie), en een specialist mét skill-/functie-match blijft normaal scoren.
  const specialistMismatch = candidate.ai_classification === "specialist" && skillMatches.length === 0 && !functionMatched;
  if (specialistMismatch && hardBlocks.length === 0) {
    matchPercent = Math.min(matchPercent, 40);
    missing.push("Specialistprofiel zonder vak-match op deze (generieke) vacature");
  }

  let label: MatchBreakdown["label"];
  if (hardBlocks.length > 0 || matchPercent < 45) label = "rood";
  else if (Math.round(fit) >= 72 && hardMatched) label = "groen";
  else label = "oranje";

  // ── Toelichting ───────────────────────────────────────────────────────────
  if (skillMatches.length > 0) positives.push(`Vaardigheden: ${skillMatches.join(", ")}`);
  else if (reqSkillCount === 0) positives.push("Geen specifieke skill-eisen op de vacature");
  if (certMatches.length > 0) positives.push(`Certificaten: ${certMatches.join(", ")}`);
  if (distFrac != null) positives.push(distanceText(distance));
  if (candidate.availability_notes) positives.push("Beschikbaarheid ingevuld");

  if (missingSkills.length > 0) missing.push(`Ontbrekende vaardigheden: ${missingSkills.join(", ")}`);
  if (missingCerts.length > 0) missing.push(`Ontbrekende certificaten: ${missingCerts.join(", ")}`);
  if (vacancy.requires_drivers_license && !candidate.has_drivers_license) missing.push("Rijbewijs gevraagd (niet geregistreerd bij kandidaat)");
  if (distFrac == null && (vacancy.location || vacancy.title)) missing.push("Afstand nog controleren (geen coördinaten)");
  if (!candidate.availability_notes) missing.push("Beschikbaarheid nog controleren");

  const reasoning = [
    `${matchPercent}% match`,
    positives.length ? positives.join("; ") : "Geen sterke matchsignalen",
    bonuses.length ? `Plus: ${bonuses.join("; ")}` : "",
    missing.length ? missing.join("; ") : "",
    hardBlocks.length ? `Blokkers: ${hardBlocks.join("; ")}` : "",
  ].filter(Boolean).join(". ");

  const componentScores: Record<string, number> = {};
  for (const c of components) componentScores[c.key] = Math.round(c.fraction * c.weight);
  componentScores.languageBonus = wantsDutch && speaksDutch(candidate, norm) ? bonusPoints.language : 0;
  componentScores.accommodationBonus = candidate.has_dutch_address ? bonusPoints.accommodation : 0;
  componentScores.licenseBonus = vacancy.requires_drivers_license && candidate.has_drivers_license ? bonusPoints.license : 0;

  return {
    matchPercent,
    candidateQuality: candidateQualityScore(candidate),
    label,
    hardBlocks,
    positives,
    missing,
    bonuses,
    skillMatches,
    certificationMatches: certMatches,
    distance: {
      km: distance?.km ?? null,
      distanceKm: distance?.km ?? null, // back-compat: oudere persisted snapshots gebruikten distanceKm
      durationMin: distance?.durationMin ?? null,
      status: distance?.status ?? "unknown",
    },
    componentScores,
    reasoning,
  };
}

// Hoort deze kandidaat in de standaard-shortlist van de vacature?
export function passesShortlist(breakdown: MatchBreakdown, includeWeak = false, options?: MatchCriteriaOptions): boolean {
  if (includeWeak) return true;
  const minScore = typeof options?.minScore === "number" ? Math.max(0, Math.min(100, options.minScore)) : 45;
  if (breakdown.hardBlocks.length > 0 || breakdown.matchPercent < minScore) return false;
  if (options?.requireSkillSignal && breakdown.skillMatches.length === 0 && breakdown.certificationMatches.length === 0) return false;
  if (options?.requireKnownDistance && breakdown.distance.km == null && breakdown.distance.durationMin == null) return false;
  return true;
}
