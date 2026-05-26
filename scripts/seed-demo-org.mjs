import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const envPath = resolve(root, ".env");
const envLocalPath = resolve(root, ".env.local");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").replace(/^['"]|['"]$/g, "");
    values[key] = value;
    process.env[key] ??= value;
  }
  return values;
}

function saveEnvLocal(updates) {
  const encode = (value) => {
    const raw = String(value ?? "");
    if (/^[A-Za-z0-9_@./:+-]*$/.test(raw)) return raw;
    return JSON.stringify(raw);
  };
  const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter((line) => line.length > 0);
  const keys = new Set(Object.keys(updates));
  const next = lines.map((line) => {
    const key = line.split("=")[0];
    if (!keys.has(key)) return line;
    keys.delete(key);
    return `${key}=${encode(updates[key])}`;
  });
  for (const key of keys) next.push(`${key}=${encode(updates[key])}`);
  writeFileSync(envLocalPath, `${next.join("\n")}\n`);
}

loadEnv(envPath);
loadEnv(envLocalPath);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.DEMO_ORG_EMAIL ?? "fase1-demo-vast@ja-werkt.local";
const password = process.env.DEMO_ORG_PASSWORD ?? `DemoFase1-${randomBytes(9).toString("base64url")}!`;

if (!supabaseUrl || !anonKey) {
  throw new Error("VITE_SUPABASE_URL en VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY zijn nodig.");
}

const supabase = createClient(supabaseUrl, anonKey);

async function signInOrRegister() {
  let { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data.user) return data.user;

  if (process.env.DEMO_ORG_PASSWORD) {
    throw new Error(`Demo-login bestaat niet of wachtwoord klopt niet: ${error?.message}`);
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/register-organization`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      company_name: "JA Werkt Demo Fase 1",
      full_name: "Demo Recruiter",
      email,
      password,
      phone: "+31 40 123 45 67",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Kon demo-organisatie niet registreren: ${payload.error ?? response.statusText}`);
  }

  ({ data, error } = await supabase.auth.signInWithPassword({ email, password }));
  if (error || !data.user) throw new Error(`Demo-login na registratie mislukt: ${error?.message}`);
  saveEnvLocal({
    DEMO_ORG_EMAIL: email,
    DEMO_ORG_PASSWORD: password,
  });
  return data.user;
}

async function singleOrInsert(table, match, values) {
  const query = supabase.from(table).select("*");
  for (const [key, value] of Object.entries(match)) query.eq(key, value);
  const { data: existing, error: selectError } = await query.maybeSingle();
  if (selectError) throw selectError;
  if (existing) {
    const { data, error } = await supabase.from(table).update(values).eq("id", existing.id).select("*").single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from(table).insert(values).select("*").single();
  if (error) throw error;
  return data;
}

async function insertIfMissing(table, match, values) {
  const query = supabase.from(table).select("*");
  for (const [key, value] of Object.entries(match)) query.eq(key, value);
  const { data: existing, error: selectError } = await query.maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;
  const { data, error } = await supabase.from(table).insert(values).select("*").single();
  if (error) throw error;
  return data;
}

async function seed() {
  const user = await signInOrRegister();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError) throw profileError;

  const orgId = profile.organization_id;
  await supabase.from("organizations").update({
    name: "JA Werkt Demo Fase 1",
    slug: "ja-werkt-demo-fase-1",
    email,
    phone: "+31 40 123 45 67",
    website: "https://demo.ja-werkt.local",
    address_street: "Vestdijk 1",
    address_postal: "5611 CA",
    address_city: "Eindhoven",
    address_country: "Nederland",
    address_lat: 51.4416,
    address_lng: 5.4697,
    settings: {
      demo: true,
      phase: "fase-1",
      purpose: "Vaste testtenant voor matching, onboarding en vacatureflows",
    },
  }).eq("id", orgId);

  const companies = {};
  for (const company of [
    {
      name: "Demo Metaalbedrijf Eindhoven",
      email: "planning@metaal-demo.local",
      phone: "+31 40 111 22 33",
      address_street: "Dillenburgstraat 25",
      address_postal: "5652 AM",
      address_city: "Eindhoven",
      visit_address_lat: 51.4478,
      visit_address_lng: 5.4447,
      notes: "Demo opdrachtgever voor MIG/MAG en assemblage matching.",
    },
    {
      name: "Demo Logistiek Tilburg",
      email: "hr@logistiek-demo.local",
      phone: "+31 13 222 33 44",
      address_street: "Asteriastraat 4",
      address_postal: "5047 RM",
      address_city: "Tilburg",
      visit_address_lat: 51.5922,
      visit_address_lng: 5.0381,
      notes: "Demo opdrachtgever voor magazijn en heftruck profielen.",
    },
    {
      name: "Demo Food Production Venlo",
      email: "werk@food-demo.local",
      phone: "+31 77 333 44 55",
      address_street: "Noorderpoort 10",
      address_postal: "5916 PJ",
      address_city: "Venlo",
      visit_address_lat: 51.3704,
      visit_address_lng: 6.1724,
      notes: "Demo opdrachtgever voor productie en ploegendienst.",
    },
  ]) {
    companies[company.name] = await singleOrInsert("companies", { organization_id: orgId, name: company.name }, {
      organization_id: orgId,
      is_active: true,
      address_country: "Nederland",
      address_lat: company.visit_address_lat,
      address_lng: company.visit_address_lng,
      visit_address_country: "Nederland",
      visit_address_city: company.address_city,
      ...company,
    });
  }

  const companyContacts = {};
  for (const contact of [
    ["Demo Metaalbedrijf Eindhoven", "Sanne Verhoeven", "sanne@metaal-demo.local", "Productieleider"],
    ["Demo Logistiek Tilburg", "Karim El Amrani", "karim@logistiek-demo.local", "Warehouse manager"],
    ["Demo Food Production Venlo", "Linda Peeters", "linda@food-demo.local", "HR coordinator"],
  ]) {
    companyContacts[contact[2]] = await singleOrInsert("company_contacts", { organization_id: orgId, email: contact[2] }, {
      organization_id: orgId,
      company_id: companies[contact[0]].id,
      full_name: contact[1],
      email: contact[2],
      function_title: contact[3],
      is_primary: true,
      role: "plaatsing",
    });
  }

  const candidateRows = {};
  for (const candidate of [
    {
      first_name: "Milan",
      last_name: "Kowalski",
      email: "milan.kowalski@demo.local",
      phone: "+31 6 11111111",
      status: "beschikbaar",
      skills: ["MIG/MAG", "Heftruckchauffeur", "Technisch tekening lezen"],
      certifications: ["VCA Basis", "Heftruckcertificaat"],
      has_drivers_license: true,
      address_city: "Eindhoven",
      address_lat: 51.4381,
      address_lng: 5.4752,
      availability_notes: "Per direct beschikbaar, dagdienst of 2 ploegen.",
      ai_function_group: "lasser",
      ai_target_functions: ["MIG-MAG lasser", "constructiebankwerker"],
      ai_reliability_score: 9,
      notes: "Sterke demo-match op metaalvacature.",
    },
    {
      first_name: "Agnieszka",
      last_name: "Nowak",
      email: "agnieszka.nowak@demo.local",
      phone: "+31 6 22222222",
      status: "beschikbaar",
      skills: ["Orderpicken", "Heftruck", "Scanner werken"],
      certifications: ["Heftruck"],
      has_drivers_license: true,
      address_city: "Tilburg",
      address_lat: 51.5555,
      address_lng: 5.0913,
      availability_notes: "Beschikbaar voor avondshift en weekend.",
      ai_function_group: "logistiek",
      ai_target_functions: ["magazijnmedewerker", "heftruckchauffeur"],
      ai_reliability_score: 8,
      notes: "Sterke demo-match op logistiek.",
    },
    {
      first_name: "Pieter",
      last_name: "Jansen",
      email: "pieter.jansen@demo.local",
      phone: "+31 6 33333333",
      status: "in_behandeling",
      skills: ["Administratie", "Excel", "Klantcontact"],
      certifications: ["BHV"],
      has_drivers_license: false,
      address_city: "Den Bosch",
      address_lat: 51.6978,
      address_lng: 5.3037,
      availability_notes: "Alleen kantooruren.",
      ai_function_group: "administratie",
      ai_target_functions: ["administratief medewerker"],
      ai_reliability_score: 7,
      notes: "Bewust zwakke match voor technische vacatures.",
    },
    {
      first_name: "Elena",
      last_name: "Popescu",
      email: "elena.popescu@demo.local",
      phone: "+31 6 44444444",
      status: "beschikbaar",
      skills: ["Productiewerk", "Inpakken", "Kwaliteitscontrole"],
      certifications: ["HACCP"],
      has_drivers_license: true,
      address_city: "Venlo",
      address_lat: 51.3709,
      address_lng: 6.1726,
      availability_notes: "3 ploegen mogelijk, start vanaf volgende week.",
      ai_function_group: "productie",
      ai_target_functions: ["productiemedewerker", "operator in opleiding"],
      ai_reliability_score: 8,
      notes: "Sterke demo-match op food productie.",
    },
  ]) {
    candidateRows[candidate.email] = await singleOrInsert("candidates", { organization_id: orgId, email: candidate.email }, {
      organization_id: orgId,
      source: "demo",
      compliance_status: "compleet",
      ...candidate,
    });
  }

  const vacancyRows = {};
  for (const vacancy of [
    {
      title: "Demo MIG-MAG lasser Eindhoven",
      company_id: companies["Demo Metaalbedrijf Eindhoven"].id,
      location: "Eindhoven",
      hourly_rate: 26,
      required_count: 2,
      urgency: 3,
      status: "open",
      start_date_text: "Per direct",
      required_skills: ["MIG-MAG lassen", "Heftruck"],
      required_certifications: ["VCA"],
      requires_drivers_license: true,
      description: "Demo vacature voor Fase 1 matching met skill aliases, certificaten, rijbewijs en reistijd.",
    },
    {
      title: "Demo Heftruckchauffeur Tilburg",
      company_id: companies["Demo Logistiek Tilburg"].id,
      location: "Tilburg",
      hourly_rate: 22,
      required_count: 3,
      urgency: 3,
      status: "open",
      start_date_text: "Volgende maandag",
      required_skills: ["Heftruck", "Orderpicken"],
      required_certifications: ["Heftruck"],
      requires_drivers_license: false,
      description: "Demo vacature voor logistieke matching.",
    },
    {
      title: "Demo Productiemedewerker Food Venlo",
      company_id: companies["Demo Food Production Venlo"].id,
      location: "Venlo",
      hourly_rate: 20,
      required_count: 4,
      urgency: 2,
      status: "open",
      start_date_text: "Binnen 2 weken",
      required_skills: ["Productiewerk", "Kwaliteitscontrole"],
      required_certifications: ["HACCP"],
      requires_drivers_license: false,
      description: "Demo vacature voor food productie en ploegendienst.",
    },
  ]) {
    vacancyRows[vacancy.title] = await singleOrInsert("vacancies", { organization_id: orgId, title: vacancy.title }, {
      organization_id: orgId,
      created_by: user.id,
      filled_count: 0,
      salary_display: `${vacancy.hourly_rate} euro per uur`,
      ...vacancy,
    });
  }

  for (const alias of [
    ["MIG-MAG lassen", "MIG/MAG"],
    ["MIG-MAG lassen", "migmag"],
    ["MIG-MAG lassen", "CO2 lassen"],
    ["MIG-MAG lassen", "CO2 lasser"],
    ["Heftruck", "Heftruckchauffeur"],
    ["Heftruck", "Heftruck certificaat"],
    ["Heftruck", "Forklift driver"],
    ["Reachtruck", "Reachtruck chauffeur"],
    ["Productiewerk", "Productiemedewerker"],
    ["Kwaliteitscontrole", "Quality Control"],
    ["Kwaliteitscontrole", "QC"],
    ["VCA", "VCA Basis"],
    ["VCA", "VCA diploma"],
    ["HACCP", "Food safety"],
  ]) {
    const { data: skill } = await supabase.from("skills")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", alias[0])
      .maybeSingle();
    if (skill?.id) {
      await insertIfMissing("skill_aliases", { organization_id: orgId, normalized_alias: alias[1].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }, {
        organization_id: orgId,
        skill_id: skill.id,
        alias: alias[1],
        normalized_alias: alias[1].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        source: "demo",
        is_active: true,
      });
    }
  }

  for (const reason of [
    ["afgewezen", "Mist verplichte vaardigheden", 10],
    ["afgewezen", "Mist certificaat of rijbewijs", 20],
    ["afgewezen", "Reistijd te hoog", 30],
    ["afgewezen", "Niet beschikbaar", 40],
    ["afgewezen", "Kandidaat niet geïnteresseerd", 50],
    ["geaccepteerd", "Sterke inhoudelijke match", 10],
    ["geaccepteerd", "Goede beschikbaarheid", 20],
    ["geplaatst", "Geplaatst na klantakkoord", 10],
  ]) {
    await insertIfMissing("match_feedback_reasons", { organization_id: orgId, applies_to: reason[0], reason: reason[1] }, {
      organization_id: orgId,
      applies_to: reason[0],
      reason: reason[1],
      sort_order: reason[2],
      is_active: true,
    });
  }

  const demoMatches = [
    [candidateRows["milan.kowalski@demo.local"], vacancyRows["Demo MIG-MAG lasser Eindhoven"], "nieuwe_match"],
    [candidateRows["agnieszka.nowak@demo.local"], vacancyRows["Demo Heftruckchauffeur Tilburg"], "gescreend"],
    [candidateRows["elena.popescu@demo.local"], vacancyRows["Demo Productiemedewerker Food Venlo"], "voorgesteld"],
    [candidateRows["pieter.jansen@demo.local"], vacancyRows["Demo MIG-MAG lasser Eindhoven"], "afgewezen"],
  ];

  for (const [candidate, vacancy, status] of demoMatches) {
    const match = await insertIfMissing("matches", { organization_id: orgId, candidate_id: candidate.id, vacancy_id: vacancy.id }, {
      organization_id: orgId,
      candidate_id: candidate.id,
      vacancy_id: vacancy.id,
      proposed_by: user.id,
      source: "eigen_match",
      status,
      notes: "Demo match voor Fase 1 testtenant.",
    });
    await supabase.functions.invoke("calculate-match", {
      body: { match_id: match.id, candidate_id: candidate.id, vacancy_id: vacancy.id },
    });
  }

  const employeeCandidate = candidateRows["milan.kowalski@demo.local"];
  await supabase.from("candidates").update({
    status: "geplaatst",
    employee_status: "actief",
  }).eq("id", employeeCandidate.id);

  const employee = await insertIfMissing("employees", { organization_id: orgId, candidate_id: employeeCandidate.id }, {
    organization_id: orgId,
    candidate_id: employeeCandidate.id,
    start_date: "2026-05-01",
    status: "actief",
    contract_type: "fase-a",
    contract_hours: 40,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    portal_enabled: true,
    notes: "Demo medewerker voor ziekte-, uren-, transport- en huisvestingtests.",
  });

  const demoPlacementMatch = await insertIfMissing("matches", {
    organization_id: orgId,
    candidate_id: employeeCandidate.id,
    vacancy_id: vacancyRows["Demo MIG-MAG lasser Eindhoven"].id,
  }, {
    organization_id: orgId,
    candidate_id: employeeCandidate.id,
    vacancy_id: vacancyRows["Demo MIG-MAG lasser Eindhoven"].id,
    proposed_by: user.id,
    source: "eigen_match",
    status: "geplaatst",
    notes: "Demo geplaatste match.",
  });

  await insertIfMissing("placements", { organization_id: orgId, match_id: demoPlacementMatch.id }, {
    organization_id: orgId,
    candidate_id: employeeCandidate.id,
    employee_id: employee.id,
    company_id: companies["Demo Metaalbedrijf Eindhoven"].id,
    vacancy_id: vacancyRows["Demo MIG-MAG lasser Eindhoven"].id,
    match_id: demoPlacementMatch.id,
    function_name: "Demo MIG-MAG lasser Eindhoven",
    start_date: "2026-05-01",
    hourly_rate: 26,
    client_hourly_rate: 42.5,
    status: "actief",
    created_by: user.id,
    compliance_check_passed: true,
    compliance_check_at: new Date().toISOString(),
    work_location: "Eindhoven",
    notes: "Demo plaatsing voor volledige QA.",
  });

  const vehicle = await singleOrInsert("vehicles", { organization_id: orgId, license_plate: "DEMO-01" }, {
    organization_id: orgId,
    license_plate: "DEMO-01",
    brand: "Volkswagen",
    model: "Caddy",
    color: "Wit",
    year: 2022,
    fuel_type: "Diesel",
    doors: 4,
    seats: 2,
    status: "toegewezen",
    current_mileage: 48250,
    apk_expiry: "2027-05-01",
    tank_capacity_liters: 55,
    avg_consumption_per_100km: 6.4,
    fuel_card_reference: "DEMO-TANKPAS-01",
    notes: "Demo voertuig met deuren, tankpas en incidenttabs.",
  });

  await insertIfMissing("vehicle_assignments", { organization_id: orgId, vehicle_id: vehicle.id, employee_id: employee.id }, {
    organization_id: orgId,
    vehicle_id: vehicle.id,
    employee_id: employee.id,
    candidate_id: employeeCandidate.id,
    assigned_date: "2026-05-01",
    start_mileage: 48000,
    notes: "Demo voertuigtoewijzing.",
  });

  const property = await singleOrInsert("properties", { organization_id: orgId, address_street: "Demostraat 12" }, {
    organization_id: orgId,
    name: "Demo Huisvesting Eindhoven",
    address_street: "Demostraat 12",
    address_postal: "5611AA",
    address_city: "Eindhoven",
    address_lat: 51.4416,
    address_lng: 5.4697,
    total_capacity: 4,
    monthly_rent: 1800,
    cost_price: 2100,
    cost_gas: 120,
    cost_electra: 160,
    cost_water: 45,
    cost_municipal_tax: 55,
    cost_other: 80,
    ownership_type: "huur",
    has_snf_certificate: true,
    snf_certificate_number: "SNF-DEMO-2026",
    snf_certificate_expiry: "2027-05-01",
    rental_contract_start_date: "2026-01-01",
    rental_contract_end_date: "2027-01-01",
    rental_contract_notes: "Demo contract voor QA.",
    notes: "Demo pand met kosten, contracten, eigenaar en schoonmaak.",
    is_active: true,
  });

  const unit = await insertIfMissing("units", { organization_id: orgId, property_id: property.id, name: "Kamer 1" }, {
    organization_id: orgId,
    property_id: property.id,
    name: "Kamer 1",
    floor: 1,
    capacity: 1,
    weekly_cost: 125,
    status: "bezet",
    notes: "Demo kamer.",
  });

  await insertIfMissing("housing_assignments", { organization_id: orgId, employee_id: employee.id, unit_id: unit.id }, {
    organization_id: orgId,
    employee_id: employee.id,
    candidate_id: employeeCandidate.id,
    unit_id: unit.id,
    check_in_date: "2026-05-01",
    status: "ingecheckt",
    deposit_paid: true,
    monthly_deduction: 500,
    deduction_amount: 500,
    payment_frequency: "maandelijks",
    notes: "Demo huisvestingstoewijzing.",
  });

  await insertIfMissing("housing_cleaning_tasks", { organization_id: orgId, property_id: property.id, title: "Demo schoonmaak controle" }, {
    organization_id: orgId,
    property_id: property.id,
    unit_id: unit.id,
    title: "Demo schoonmaak controle",
    description: "Demo taak voor huisvesting QA.",
    priority: "medium",
    status: "open",
    due_date: "2026-06-01",
    created_by: user.id,
  });

  await supabase
    .from("loyalty_accounts")
    .upsert({
      organization_id: orgId,
      candidate_id: employeeCandidate.id,
      balance_points: 1000,
      lifetime_earned_points: 1000,
      lifetime_spent_points: 0,
    }, { onConflict: "organization_id,candidate_id" });

  await insertIfMissing("reward_catalog", { organization_id: orgId, name: "Demo Bol.com bon" }, {
    organization_id: orgId,
    name: "Demo Bol.com bon",
    description: "Vaste demo reward voor medewerkerportaal QA.",
    points_cost: 120,
    is_active: true,
    sort_order: 1,
    created_by: user.id,
  });

  const { data: employeeInvite, error: employeeInviteError } = await supabase
    .from("portal_invites")
    .insert({
      organization_id: orgId,
      candidate_id: employeeCandidate.id,
      employee_id: employee.id,
      email: employeeCandidate.email,
    })
    .select("token")
    .single();
  if (employeeInviteError) throw employeeInviteError;

  const clientContact = companyContacts["sanne@metaal-demo.local"];
  const { data: clientInvite, error: clientInviteError } = await supabase
    .from("client_portal_invites")
    .insert({
      organization_id: orgId,
      company_id: companies["Demo Metaalbedrijf Eindhoven"].id,
      company_contact_id: clientContact.id,
      email: clientContact.email,
    })
    .select("token")
    .single();
  if (clientInviteError) throw clientInviteError;

  saveEnvLocal({
    DEMO_ORG_EMAIL: email,
    DEMO_ORG_PASSWORD: password,
    DEMO_ORG_ID: orgId,
    DEMO_USER_ID: user.id,
    E2E_EMPLOYEE_PORTAL_TOKEN: employeeInvite.token,
    E2E_EMPLOYEE_PORTAL_EMAIL: employeeCandidate.email,
    E2E_CLIENT_PORTAL_TOKEN: clientInvite.token,
    E2E_CLIENT_PORTAL_EMAIL: clientContact.email,
    E2E_PORTAL_PASSWORD: password,
    E2E_SEEDED_EMPLOYEE_NAME: `${employeeCandidate.first_name} ${employeeCandidate.last_name}`,
    E2E_SEEDED_PROPERTY_NAME: "Demo Huisvesting Eindhoven",
    E2E_SEEDED_LICENSE_PLATE: "DEMO-01",
    E2E_SEEDED_COMPANY_NAME: "Demo Metaalbedrijf Eindhoven",
    E2E_FOREIGN_EMPLOYEE_NAME: "Niet Zichtbare Buitenlandse Medewerker",
    E2E_SEEDED_VEHICLE_ID: vehicle.id,
  });

  console.log(`Demo organisatie klaar: ${orgId}`);
  console.log(`Login staat in ${envLocalPath}`);
  console.log(`Email: ${email}`);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
