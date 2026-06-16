import { expect, Locator, Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

test.describe.configure({ mode: "serial" });

function requireMutatingWorkflows(): void {
  const enabled = process.env.E2E_ALLOW_MUTATING_WORKFLOWS === "true";
  if (!enabled) {
    test.skip(true, "Recruitment funnel E2E maakt echte testdata aan; zet E2E_ALLOW_MUTATING_WORKFLOWS=true.");
  }
}

const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const portalPassword = "E2E PortalPass123!";

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(`, "'", `)})`;
}

async function fillInputAfterLabel(page: Page, label: string, value: string): Promise<void> {
  await page
    .locator(`xpath=//label[contains(normalize-space(), ${xpathLiteral(label)})]/following::input[1]`)
    .first()
    .fill(value);
}

async function fillTextareaAfterLabel(page: Page, label: string, value: string): Promise<void> {
  await page
    .locator(`xpath=//label[contains(normalize-space(), ${xpathLiteral(label)})]/following::textarea[1]`)
    .first()
    .fill(value);
}

async function selectAfterLabel(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page
    .locator(`xpath=//label[contains(normalize-space(), ${xpathLiteral(label)})]/following::*[@role="combobox"][1]`)
    .first()
    .click();
  await page.getByRole("option", { name: option }).first().click();
}

async function fillTagAfterLabel(page: Page, label: string, value: string): Promise<void> {
  const input = page
    .locator(`xpath=//label[contains(normalize-space(), ${xpathLiteral(label)})]/following::input[1]`)
    .first();
  await input.fill(value);
  await input.press("Enter");
}

function imagePayload(name = "qa-proof.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  };
}

function pdfPayload(name = "qa-cv.pdf") {
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idFromUrl(url: string, path: string): string {
  const match = new RegExp(`${path}/([0-9a-f-]{36})`).exec(url);
  if (!match?.[1]) throw new Error(`Geen id gevonden in URL: ${url}`);
  return match[1];
}

async function restRows<T>(page: Page, table: string, query: string): Promise<T[]> {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen admin access token beschikbaar voor REST-validatie");
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
    },
  });
  expect(res.ok(), `${table} REST select faalde: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T[];
}

async function restPatch(page: Page, table: string, filter: string, data: Record<string, unknown>): Promise<void> {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen admin access token beschikbaar voor REST-update");
  const res = await page.request.patch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    data,
  });
  expect(res.ok(), `${table} REST update faalde: ${await res.text()}`).toBeTruthy();
}

async function waitForRestRows<T>(
  page: Page,
  table: string,
  query: string,
  predicate: (rows: T[]) => boolean,
  timeoutMs = 30_000,
): Promise<T[]> {
  const deadline = Date.now() + timeoutMs;
  let lastRows: T[] = [];
  while (Date.now() < deadline) {
    lastRows = await restRows<T>(page, table, query);
    if (predicate(lastRows)) return lastRows;
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Timeout wachtend op ${table}: ${JSON.stringify(lastRows).slice(0, 500)}`);
}

async function loginPortal(page: Page, email: string): Promise<void> {
  await page.goto("/portaal/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(portalPassword);
  await page.getByRole("button", { name: /^Inloggen$/ }).click();
  await expect(page).toHaveURL(/\/portaal\/?$/, { timeout: 20_000 });
}

function watchFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) failures.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("response", async (res) => {
    const url = res.url();
    if ((url.includes("/rest/v1/") || url.includes("/functions/v1/")) && res.status() >= 400) {
      try {
        failures.push(`${res.status()} ${url}: ${(await res.text()).slice(0, 300)}`);
      } catch {
        failures.push(`${res.status()} ${url}`);
      }
    }
  });
  return failures;
}

function blockingFailures(failures: string[]): string[] {
  return failures.filter(
    (failure) =>
      !failure.includes("exact-sync-account") &&
      !failure.includes("send-portal-invite") &&
      !failure.includes("kvk-lookup: {\"error\":\"Geen bedrijf gevonden met dit KVK-nummer\"}") &&
      !failure.includes("[kvk-lookup] error:") &&
      !failure.includes("whatsapp-send: {\"error\":\"WhatsApp niet geconfigureerd\"}") &&
      !(failure.includes("Error fetching profile") && failure.includes("Failed to fetch")) &&
      !(failure.startsWith("console: TypeError: Failed to fetch") && failure.includes("_refreshAccessToken")),
  );
}

test("Recruiterfunnel: kandidaat komt binnen, CV analyse, match, plaatsing, portaal, woning, auto, ziekmelding en uren", async ({ page, browser }, testInfo) => {
  requireMutatingWorkflows();
  test.setTimeout(720_000);

  const failures = watchFailures(page);
  const findings: string[] = [];
  const suffix = `${runId}-${Date.now().toString().slice(-5)}`;
  const candidateFirst = "E2E";
  const candidateLast = `Recruit ${suffix}`;
  const candidateFullName = `${candidateFirst} ${candidateLast}`;
  const candidateEmail = `e2e-recruit-${suffix}@example.com`;
  const companyName = `E2E Funnel Opdrachtgever ${suffix}`;
  const vacancyTitle = `E2E MIG-MAG Lasser ${suffix}`;
  const propertyName = `E2E Funnel Woning ${suffix}`;
  const unitName = `Kamer ${suffix.slice(-4)}`;
  const licensePlate = `FL-${suffix.slice(-4)}`;

  const cvText = `
    ${candidateFullName}
    Ervaren MIG-MAG lasser en productiemedewerker met heftruckervaring.
    Heeft VCA, rijbewijs B, Nederlands en Engels, ervaring met metaalbewerking,
    assemblage, kwaliteitscontrole en werken in ploegendienst.
    Beschikbaar per direct in regio Eindhoven voor fulltime werk.
  `.replace(/\s+/g, " ").trim();

  await ensureLoggedIn(page);

  await page.goto("/opdrachtgevers/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Bedrijfsnaam", companyName);
  await fillInputAfterLabel(page, "KVK-nummer", `88${suffix.replace(/\D/g, "").slice(-6).padStart(6, "0")}`);
  await fillInputAfterLabel(page, "Straat", "Funnelstraat 10");
  await fillInputAfterLabel(page, "Postcode", "5611AA");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await fillInputAfterLabel(page, "E-mail", `company-${suffix}@example.com`);
  await page.getByRole("button", { name: /Opdrachtgever aanmaken/i }).click();
  await expect(page).toHaveURL(/\/opdrachtgevers\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  await page.goto("/huisvesting", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Nieuw pand/i }).click();
  await fillInputAfterLabel(page, "Straat", "Funnelhof 7");
  await fillInputAfterLabel(page, "Postcode", "5651AB");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await fillInputAfterLabel(page, "Bijnaam", propertyName);
  await fillInputAfterLabel(page, "Totale capaciteit", "2");
  await page.getByRole("button", { name: /^Opslaan$/ }).click();
  await expect(page.getByText(propertyName).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: new RegExp(escapeRegExp(propertyName)) }).first().click();
  const propertyId = idFromUrl(page.url(), "/huisvesting");
  await page.getByRole("tab", { name: /Kamers/i }).click();
  await page.getByRole("button", { name: /Nieuwe kamer/i }).click();
  await fillInputAfterLabel(page, "Kamernaam", unitName);
  await fillInputAfterLabel(page, "Capaciteit", "1");
  await fillInputAfterLabel(page, "Weekprijs", "95");
  await page.getByRole("button", { name: /^Opslaan$/ }).click();
  await expect(page.getByText(unitName).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/transport/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Kenteken", licensePlate);
  await fillInputAfterLabel(page, "Merk", "Toyota");
  await fillInputAfterLabel(page, "Model", "Yaris Funnel");
  await fillInputAfterLabel(page, "Bouwjaar", "2022");
  await selectAfterLabel(page, "Brandstof", /Benzine/i);
  await fillInputAfterLabel(page, "Kilometerstand", "15400");
  await fillInputAfterLabel(page, "Aantal deuren", "5");
  await fillInputAfterLabel(page, "Tankcapaciteit", "42");
  await fillInputAfterLabel(page, "Gem. verbruik", "6.2");
  await page.getByRole("button", { name: /Voertuig aanmaken/i }).click();
  await expect(page).toHaveURL(/\/transport\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const vehicleId = idFromUrl(page.url(), "/transport");
  await expect(page.getByRole("heading", { name: licensePlate })).toBeVisible();

  await page.goto("/kandidaten/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Voornaam", candidateFirst);
  await fillInputAfterLabel(page, "Achternaam", candidateLast);
  await fillInputAfterLabel(page, "Geboortedatum", "1991-03-04");
  await fillInputAfterLabel(page, "Nationaliteit", "Nederlands");
  await fillInputAfterLabel(page, "E-mail", candidateEmail);
  await fillInputAfterLabel(page, "Telefoon", "0612345678");
  await fillInputAfterLabel(page, "Straat", "Kandidaatstraat 1");
  await fillInputAfterLabel(page, "Postcode", "5611BB");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await page.locator("#dl").check();
  await fillInputAfterLabel(page, "Verloopdatum rijbewijs", "2028-12-31");
  await fillTagAfterLabel(page, "Vaardigheden", "MIG-MAG lassen");
  await fillTagAfterLabel(page, "Vaardigheden", "Heftruck");
  await fillTagAfterLabel(page, "Talen", "Nederlands");
  await fillTextareaAfterLabel(page, "Notities", `E2E volledige recruiterfunnel ${suffix}`);
  await page.getByRole("button", { name: /Kandidaat aanmaken/i }).click();
  await expect(page.getByRole("heading", { name: /Profiellink versturen/i })).toBeVisible({ timeout: 20_000 });

  const profileUrl = await page.locator("input[readonly]").evaluateAll((inputs) => {
    const match = inputs
      .map((input) => (input as HTMLInputElement).value)
      .find((value) => value.includes("/profiel/"));
    if (!match) throw new Error("Geen profiellink gevonden");
    return match;
  });
  await page.getByRole("button", { name: /Naar kandidaat/i }).click();
  await expect(page).toHaveURL(/\/kandidaten\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const candidateId = idFromUrl(page.url(), "/kandidaten");
  await expect(page.getByRole("heading", { name: new RegExp(`${candidateFirst}.*${escapeRegExp(candidateLast)}`) })).toBeVisible();

  const publicContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    viewport: { width: 1400, height: 900 },
  });
  const publicPage = await publicContext.newPage();
  try {
    await publicPage.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await expect(publicPage.getByRole("heading", { name: new RegExp(`Hoi ${candidateFirst}`) })).toBeVisible({ timeout: 20_000 });
    await fillTextareaAfterLabel(publicPage, "Beschikbaarheid", "Per direct fulltime beschikbaar voor ploegendienst.");
    await fillTagAfterLabel(publicPage, "Certificaten", "VCA");
    await publicPage.locator('input[accept=".pdf,.doc,.docx,image/*"]').setInputFiles(pdfPayload(`cv-${suffix}.pdf`));
    await publicPage.getByRole("button", { name: /Profiel opslaan/i }).click();
    await expect(publicPage.getByText(/Je profiel is aangevuld/i)).toBeVisible({ timeout: 30_000 });
  } finally {
    await publicContext.close();
  }

  await ensureLoggedIn(page);
  await page.goto(`/kandidaten/${candidateId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /AI Analyse/i }).click();
  await page.getByPlaceholder(/Plak hier de CV-tekst/i).fill(cvText);
  await page.getByRole("button", { name: /AI Analyse starten/i }).click();
  await page.getByRole("menuitem", { name: /Cloud/i }).click();
  const cvCompleted = await page
    .getByText(/Analyse voltooid/i)
    .waitFor({ state: "visible", timeout: 180_000 })
    .then(() => true)
    .catch(() => false);
  if (!cvCompleted) {
    const cvRows = await waitForRestRows<{ ai_status: string | null; ai_analysis: unknown | null }>(
      page,
      "candidates",
      `select=ai_status,ai_analysis&id=eq.${candidateId}&limit=1`,
      (rows) => rows[0]?.ai_status === "completed" && Boolean(rows[0]?.ai_analysis),
      30_000,
    ).catch(() => []);
    if (cvRows.length === 0) {
      const stillAnalyzing = await page
        .getByText(/CV wordt geanalyseerd|Analyse gestart/i)
        .first()
        .isVisible()
        .catch(() => false);
      findings.push(stillAnalyzing ? "CV analyse gestart maar niet voltooid binnen 210s" : "CV analyse niet succesvol gestart/afgerond");
    }
  }

  await page.goto("/vacatures/new", { waitUntil: "domcontentloaded" });
  await selectAfterLabel(page, "Opdrachtgever", companyName);
  await selectAfterLabel(page, "Functie", /Andere functie/i);
  await fillInputAfterLabel(page, "Titel", vacancyTitle);
  await fillTextareaAfterLabel(page, "Beschrijving", "MIG-MAG lasser met heftruckervaring, VCA en rijbewijs voor productieomgeving.");
  await fillInputAfterLabel(page, "Locatie", "Eindhoven");
  await page.locator('input[type="date"]').first().fill(today);
  await fillInputAfterLabel(page, "Uurtarief", "24.50");
  await fillTagAfterLabel(page, "Vereiste vaardigheden", "MIG-MAG lassen");
  await fillTagAfterLabel(page, "Vereiste vaardigheden", "Heftruck");
  await fillTagAfterLabel(page, "Vereiste certificaten", "VCA");
  await page.locator("#dl").check();
  await page.getByRole("button", { name: /Vacature aanmaken/i }).click();
  await expect(page).toHaveURL(/\/vacatures\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const vacancyId = idFromUrl(page.url(), "/vacatures");
  await expect(page.getByRole("heading", { name: vacancyTitle })).toBeVisible();

  await page.getByRole("tab", { name: /Matches/i }).click();
  await page.getByPlaceholder("Zoek kandidaat...").fill(candidateLast);
  await expect(page.getByText(candidateFullName).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Nieuwe match/i }).first().click();
  await expect(page.getByText(/Nieuwe match aangemaakt/i).first()).toBeVisible({ timeout: 20_000 });

  const matchRows = await waitForRestRows<{ id: string; match_score: number | null; match_reasoning: string | null }>(
    page,
    "matches",
    `select=id,match_score,match_reasoning&candidate_id=eq.${candidateId}&vacancy_id=eq.${vacancyId}&limit=1`,
    (rows) => rows.length === 1,
    20_000,
  );
  const matchId = matchRows[0].id;
  const scoredRows = await waitForRestRows<{ match_score: number | null; match_reasoning: string | null }>(
    page,
    "matches",
    `select=match_score,match_reasoning&id=eq.${matchId}&limit=1`,
    (rows) => rows[0]?.match_score != null || rows[0]?.match_reasoning != null,
    45_000,
  ).catch(() => []);
  if (!scoredRows[0]?.match_score && !scoredRows[0]?.match_reasoning) {
    findings.push("Match is aangemaakt, maar AI-matchscore/onderbouwing kwam niet terug binnen 45s");
  }

  await restPatch(page, "matches", `id=eq.${matchId}`, { status: "geaccepteerd", status_changed_at: new Date().toISOString() });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Matches/i }).click();
  await expect(page.getByText(candidateFullName).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Plaatsen$/i }).first().click();
  await expect(page.getByRole("heading", { name: /Plaatsing aanmaken/i })).toBeVisible({ timeout: 20_000 });
  await fillInputAfterLabel(page, "Factuurtarief klant", "42.50");
  await page.getByRole("button", { name: /^Plaatsing aanmaken$/i }).click();

  const complianceDialog = page.getByRole("heading", { name: /Dossier niet compleet/i });
  if (await complianceDialog.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false)) {
    await page.getByRole("button", { name: /Toch plaatsen/i }).click();
  }
  await expect(page.getByText(/Plaatsing aangemaakt/i).first()).toBeVisible({ timeout: 30_000 });

  const housingSuggestion = page.locator(
    `xpath=//*[contains(normalize-space(), ${xpathLiteral(propertyName)})]/ancestor::div[contains(@class,'rounded')][1]//button[contains(normalize-space(),'Toewijzen')]`,
  ).first();
  if (await housingSuggestion.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false)) {
    await housingSuggestion.click();
    await expect(page.getByText(/Huisvesting toegewezen/i).first()).toBeVisible({ timeout: 20_000 });
  } else {
    findings.push(`Geen huisvesting-suggestie/toewijsactie zichtbaar voor ${propertyName}`);
  }

  const inviteRows = await waitForRestRows<{ token: string; email: string }>(
    page,
    "portal_invites",
    `select=token,email&candidate_id=eq.${candidateId}&used_at=is.null&order=created_at.desc&limit=1`,
    (rows) => Boolean(rows[0]?.token),
    30_000,
  );
  const portalToken = inviteRows[0].token;

  await page.goto(`/transport/${vehicleId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Toewijzingen/i }).click();
  await page.getByRole("button", { name: /Voertuig toewijzen/i }).click();
  await selectAfterLabel(page, "Medewerker", new RegExp(escapeRegExp(candidateFullName)));
  await fillInputAfterLabel(page, "Startdatum", today);
  await fillInputAfterLabel(page, "Begin kilometerstand", "15400");
  await page.getByRole("button", { name: /^Toewijzen$/i }).click();
  await expect(page.getByText(/Voertuig toegewezen/i).first()).toBeVisible({ timeout: 20_000 });

  await page.goto(`/portaal/activeren/${portalToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Portaal activeren/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#email")).toHaveValue(candidateEmail);
  await page.locator("#password").fill(portalPassword);
  await page.locator("#confirm").fill(portalPassword);
  await page.getByRole("button", { name: /Account aanmaken/i }).click();
  await expect(page.getByRole("heading", { name: /Je account is aangemaakt/i })).toBeVisible({ timeout: 30_000 });

  await loginPortal(page, candidateEmail);
  await expect(page.getByText(candidateFirst).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/portaal/huisvesting", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(propertyName).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Onderhoud melden/i }).click();
  await page.locator("textarea").first().fill(`E2E onderhoud vanuit volledige funnel ${suffix}`);
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload("housing-maintenance.png"));
  await page.getByRole("button", { name: /Melding indienen/i }).click();
  await expect(page.getByText(/Klacht ingediend/i).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/portaal/voertuig", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(licensePlate).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Schade melden/i }).click();
  await expect(page.getByRole("button", { name: /Schademelding indienen/i })).toBeDisabled();
  await page.locator("textarea").first().fill(`E2E lekke band volledige funnel ${suffix}`);
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload("vehicle-damage.png"));
  await expect(page.getByRole("button", { name: /Schademelding indienen/i })).toBeEnabled();
  await page.getByRole("button", { name: /Schademelding indienen/i }).click();
  await expect(page.getByText(/Schademelding ingediend/i).first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/portaal/ziekmelding", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="date"]').first().fill(tomorrow);
  await page.getByRole("button", { name: /Ziekmelding indienen/i }).click();
  await expect(page.getByText(/Ziekmelding ingediend/i).first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/portaal/uren", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Week \d+/)).toBeVisible({ timeout: 20_000 });
  const emptyDay = page.getByRole("button", { name: /—/ }).first();
  if (await emptyDay.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await emptyDay.click();
    const hoursInput = page.locator('input[type="number"]').first();
    if (await hoursInput.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
      await hoursInput.fill("7.5");
      await page.locator("textarea").first().fill(`E2E uren volledige funnel ${suffix}`);
      await page.getByRole("button", { name: /Uren opslaan/i }).click();
      await expect(page.getByText(/Uren opgeslagen|7\.5u|7,5u/i).first()).toBeVisible({ timeout: 20_000 });
    }
  }
  const submitWeek = page.getByRole("button", { name: /Week indienen/i });
  await expect(submitWeek).toBeVisible({ timeout: 20_000 });
  await submitWeek.click();
  await expect(page.getByText(/Uren ingediend|Ingediend/i).first()).toBeVisible({ timeout: 20_000 });

  await waitForRestRows(
    page,
    "housing_assignments",
    `select=id&candidate_id=eq.${candidateId}&status=eq.ingecheckt&limit=1`,
    (rows) => rows.length === 1,
  );
  await waitForRestRows(
    page,
    "vehicle_assignments",
    `select=id&candidate_id=eq.${candidateId}&vehicle_id=eq.${vehicleId}&returned_date=is.null&limit=1`,
    (rows) => rows.length === 1,
  );
  await waitForRestRows(
    page,
    "sick_reports",
    `select=id&candidate_id=eq.${candidateId}&notes=ilike.*${encodeURIComponent(suffix)}*&limit=1`,
    (rows) => rows.length === 1,
  );

  expect.soft(blockingFailures(failures)).toEqual([]);
  expect(findings).toEqual([]);
});
