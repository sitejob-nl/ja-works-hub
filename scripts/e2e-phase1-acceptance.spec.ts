import { devices, expect, Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

test.describe.configure({ mode: "serial" });

function requireMutatingAcceptance(): void {
  if (process.env.E2E_ALLOW_MUTATING_WORKFLOWS !== "true") {
    test.skip(true, "Fase 1 acceptatie maakt echte testdata aan; zet E2E_ALLOW_MUTATING_WORKFLOWS=true.");
  }
}

function pdfPayload(name = "phase1-cv.pdf") {
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
  };
}

function jwtPayload(token: string): { sub?: string } {
  const payload = token.split(".")[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function authHeaders(page: Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen admin access token beschikbaar voor Fase 1 acceptatie");
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function restGet<T>(page: Page, table: string, query: string): Promise<T[]> {
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: await authHeaders(page),
  });
  expect(res.ok(), `${table} select faalde: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T[];
}

async function restInsert<T>(page: Page, table: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: {
      ...(await authHeaders(page)),
      Prefer: "return=representation",
    },
    data,
  });
  expect(res.ok(), `${table} insert faalde: ${await res.text()}`).toBeTruthy();
  const rows = (await res.json()) as T[];
  return rows[0];
}

async function restPatch(page: Page, table: string, filter: string, data: Record<string, unknown>): Promise<void> {
  const res = await page.request.patch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      ...(await authHeaders(page)),
      Prefer: "return=minimal",
    },
    data,
  });
  expect(res.ok(), `${table} update faalde: ${await res.text()}`).toBeTruthy();
}

async function getTestIdentity(page: Page): Promise<{ userId: string; organizationId: string }> {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen admin access token beschikbaar");
  const userId = jwtPayload(token).sub;
  if (!userId) throw new Error("Kon user id niet uit JWT lezen");

  const profiles = await restGet<{ organization_id: string }>(
    page,
    "profiles",
    `select=organization_id&id=eq.${userId}&limit=1`,
  );
  if (!profiles[0]?.organization_id) throw new Error("Geen organisatieprofiel gevonden voor testgebruiker");
  return { userId, organizationId: profiles[0].organization_id };
}

async function fillInputAfterLabel(page: Page, label: string, value: string): Promise<void> {
  await page.locator(`xpath=//label[contains(normalize-space(), '${label}')]/following::input[1]`).first().fill(value);
}

async function fillTextareaAfterLabel(page: Page, label: string, value: string): Promise<void> {
  await page.locator(`xpath=//label[contains(normalize-space(), '${label}')]/following::textarea[1]`).first().fill(value);
}

async function fillTagAfterLabel(page: Page, label: string, value: string): Promise<void> {
  const input = page.locator(`xpath=//label[contains(normalize-space(), '${label}')]/following::input[1]`).first();
  await input.fill(value);
  await input.press("Enter");
}

test("Fase 1: profiel- en onboardinglinks werken op mobiel met echte tokenlinks", async ({ page, browser }, testInfo) => {
  requireMutatingAcceptance();
  await ensureLoggedIn(page);
  const { organizationId } = await getTestIdentity(page);
  const suffix = `${Date.now()}`.slice(-8);

  const profileCandidate = await restInsert<{ id: string }>(page, "candidates", {
    organization_id: organizationId,
    first_name: "Mobiel",
    last_name: `Profiel ${suffix}`,
    email: `phase1-profiel-${suffix}@example.com`,
    phone: "0612345678",
    status: "nieuw",
  });
  const profileToken = await restInsert<{ token: string }>(page, "candidate_profile_tokens", {
    organization_id: organizationId,
    candidate_id: profileCandidate.id,
  });

  const mobileContext = await browser.newContext({
    ...(devices["Pixel 5"]),
    baseURL: testInfo.project.use.baseURL as string,
  });
  const mobilePage = await mobileContext.newPage();
  try {
    await mobilePage.goto(`/profiel/${profileToken.token}`, { waitUntil: "domcontentloaded" });
    await expect(mobilePage.getByRole("heading", { name: /Hoi Mobiel/i })).toBeVisible({ timeout: 20_000 });
    await fillInputAfterLabel(mobilePage, "Telefoonnummer", "0698765432");
    await fillInputAfterLabel(mobilePage, "Geboortedatum", "1992-02-03");
    await fillInputAfterLabel(mobilePage, "Straat", "Mobielstraat 1");
    await fillInputAfterLabel(mobilePage, "Postcode", "5611AA");
    await fillInputAfterLabel(mobilePage, "Stad", "Eindhoven");
    await fillTagAfterLabel(mobilePage, "Vaardigheden", "MIG-MAG lassen");
    await fillTagAfterLabel(mobilePage, "Certificaten", "VCA");
    await fillTextareaAfterLabel(mobilePage, "Beschikbaarheid", "Per direct mobiel ingevuld.");
    await mobilePage.locator('input[accept=".pdf,.doc,.docx,image/*"]').setInputFiles(pdfPayload(`phase1-profiel-${suffix}.pdf`));
    await mobilePage.getByRole("button", { name: /Profiel opslaan/i }).click();
    await expect(mobilePage.getByText(/Je profiel is aangevuld/i)).toBeVisible({ timeout: 30_000 });
  } finally {
    await mobileContext.close();
  }

  const updatedProfileRows = await restGet<{ phone: string | null; skills: string[] | null; certifications: string[] | null }>(
    page,
    "candidates",
    `select=phone,skills,certifications&id=eq.${profileCandidate.id}&limit=1`,
  );
  expect(updatedProfileRows[0]?.phone).toBe("0698765432");
  expect(updatedProfileRows[0]?.skills ?? []).toContain("MIG-MAG lassen");
  expect(updatedProfileRows[0]?.certifications ?? []).toContain("VCA");

  const onboardingCandidate = await restInsert<{ id: string }>(page, "candidates", {
    organization_id: organizationId,
    first_name: "Mobiel",
    last_name: `Onboarding ${suffix}`,
    email: `phase1-onboarding-${suffix}@example.com`,
    status: "nieuw",
  });
  const onboardingToken = await restInsert<{ token: string }>(page, "onboarding_tokens", {
    organization_id: organizationId,
    candidate_id: onboardingCandidate.id,
  });

  const onboardingContext = await browser.newContext({
    ...(devices["Pixel 5"]),
    baseURL: testInfo.project.use.baseURL as string,
  });
  const onboardingPage = await onboardingContext.newPage();
  try {
    await onboardingPage.goto(`/onboarding/${onboardingToken.token}`, { waitUntil: "domcontentloaded" });
    await expect(onboardingPage.getByRole("heading", { name: /Onboarding/i })).toBeVisible({ timeout: 20_000 });
    await fillInputAfterLabel(onboardingPage, "BSN", "123456789");
    await fillInputAfterLabel(onboardingPage, "IBAN", "NL91ABNA0417164300");
    await fillInputAfterLabel(onboardingPage, "Geboortedatum", "1992-02-03");
    await fillInputAfterLabel(onboardingPage, "Telefoonnummer", "0611111111");
    await fillInputAfterLabel(onboardingPage, "E-mail", `phase1-onboarding-${suffix}@example.com`);
    await onboardingPage.locator("#reglement").check();
    await onboardingPage.getByRole("button", { name: /Gegevens indienen/i }).click();
    await expect(onboardingPage.getByText(/Je gegevens zijn succesvol ingediend/i)).toBeVisible({ timeout: 30_000 });
  } finally {
    await onboardingContext.close();
  }

  const usedTokenRows = await restGet<{ used_at: string | null }>(
    page,
    "onboarding_tokens",
    `select=used_at&candidate_id=eq.${onboardingCandidate.id}&limit=1`,
  );
  expect(usedTokenRows[0]?.used_at).toBeTruthy();
});

test("Fase 1: vacaturematch toont passende kandidaat, verbergt niet-passende kandidaat en slaat matchscore op", async ({ page }) => {
  requireMutatingAcceptance();
  await ensureLoggedIn(page);
  const { organizationId, userId } = await getTestIdentity(page);
  const suffix = `${Date.now()}`.slice(-8);

  const company = await restInsert<{ id: string }>(page, "companies", {
    organization_id: organizationId,
    name: `Phase1 Matchbedrijf ${suffix}`,
    address_city: "Eindhoven",
    is_active: true,
  });
  const matchingCandidate = await restInsert<{ id: string }>(page, "candidates", {
    organization_id: organizationId,
    first_name: "Passend",
    last_name: `Lasser ${suffix}`,
    status: "beschikbaar",
    skills: ["MIG-MAG lassen", "Heftruck"],
    certifications: ["VCA"],
    has_drivers_license: true,
    availability_notes: "Per direct beschikbaar",
    ai_function_group: "lasser",
    ai_reliability_score: 9,
  });
  const nonMatchingCandidate = await restInsert<{ id: string }>(page, "candidates", {
    organization_id: organizationId,
    first_name: "Nietpassend",
    last_name: `Administratie ${suffix}`,
    status: "beschikbaar",
    skills: ["Administratie"],
    certifications: ["BHV"],
    has_drivers_license: false,
  });
  const vacancy = await restInsert<{ id: string }>(page, "vacancies", {
    organization_id: organizationId,
    created_by: userId,
    company_id: company.id,
    title: `Phase1 MIG-MAG vacature ${suffix}`,
    location: "Eindhoven",
    hourly_rate: 25,
    required_count: 1,
    urgency: 3,
    status: "open",
    start_date_text: "Direct",
    required_skills: ["MIG-MAG lassen", "Heftruck"],
    required_certifications: ["VCA"],
    requires_drivers_license: true,
  });

  await page.goto(`/vacatures/${vacancy.id}?tab=matches`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: new RegExp(`Phase1 MIG-MAG vacature ${suffix}`) })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Beste kandidaten uit eigen database/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`Passend Lasser ${suffix}`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/[89][0-9]% match/i).first()).toBeVisible();
  await expect(page.getByText(`Nietpassend Administratie ${suffix}`)).toHaveCount(0);

  await page.getByText(`Passend Lasser ${suffix}`).locator("xpath=ancestor::div[contains(@class, 'rounded')][1]").getByRole("button", { name: /Match maken/i }).click();
  await expect(page.getByText(/Match gemaakt/i).first()).toBeVisible({ timeout: 20_000 });

  const matchRows = await restGet<{ id: string; match_breakdown: Record<string, unknown> | null }>(
    page,
    "matches",
    `select=id,match_breakdown&candidate_id=eq.${matchingCandidate.id}&vacancy_id=eq.${vacancy.id}&limit=1`,
  );
  expect(matchRows[0]?.id).toBeTruthy();
  expect(matchRows[0]?.match_breakdown).toBeTruthy();
  await restPatch(page, "matches", `id=eq.${matchRows[0].id}`, {
    match_score: 100,
    match_reasoning: "E2E validatie: kandidaat voldoet aan skills, certificaat en rijbewijs.",
  });
  const rejectionReasons = await restGet<{ id: string }>(
    page,
    "match_feedback_reasons",
    `select=id&organization_id=eq.${organizationId}&applies_to=eq.afgewezen&is_active=eq.true&limit=1`,
  );
  if (rejectionReasons[0]?.id) {
    await restInsert<{ id: string }>(page, "match_feedback_events", {
      organization_id: organizationId,
      match_id: matchRows[0].id,
      from_status: "nieuwe_match",
      to_status: "afgewezen",
      reason_id: rejectionReasons[0].id,
      notes: "E2E validatie feedbackreden",
      created_by: userId,
    });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(`Passend Lasser ${suffix}`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/100%/).first()).toBeVisible();

  const nonMatchingRows = await restGet<{ id: string }>(
    page,
    "matches",
    `select=id&candidate_id=eq.${nonMatchingCandidate.id}&vacancy_id=eq.${vacancy.id}&limit=1`,
  );
  expect(nonMatchingRows).toHaveLength(0);
});
