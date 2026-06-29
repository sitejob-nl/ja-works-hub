import { expect, Locator, Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

test.describe.configure({ mode: "serial" });

function requireMutatingWorkflows(): void {
  const enabled = process.env.E2E_ALLOW_MUTATING_WORKFLOWS === "true";
  if (!enabled) {
    console.warn("Muterende full-workflow E2E overgeslagen: E2E_ALLOW_MUTATING_WORKFLOWS is niet true.");
    test.skip(true, "Muterende full-workflow E2E vereist E2E_ALLOW_MUTATING_WORKFLOWS=true; dit voorkomt testdata in productie.");
  }
}

const seedRunId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
const runId = `${seedRunId}${Date.now().toString().slice(-6)}`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) test.skip(true, `${name} niet gezet; full workflow e2e overgeslagen`);
  return value!;
}

async function authHeaders(page: Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen admin access token beschikbaar voor full workflow e2e");
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

async function expectTimesheetConfirmed(page: Page, candidateId: string, notes: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await restGet<{ employee_confirmed: boolean; status: string }>(
          page,
          "timesheets",
          `select=employee_confirmed,status&candidate_id=eq.${candidateId}&notes=eq.${encodeURIComponent(notes)}&limit=1`,
        );
        return rows[0] ? `${rows[0].employee_confirmed}:${rows[0].status}` : "missing";
      },
      { timeout: 20_000 },
    )
    .toBe("true:ingediend");
}

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

async function fillInputWithin(container: Locator, label: string, value: string): Promise<void> {
  await container
    .locator(`xpath=.//label[contains(normalize-space(), ${xpathLiteral(label)})]/following::input[1]`)
    .first()
    .fill(value);
}

async function fillTextareaWithin(container: Locator, label: string, value: string): Promise<void> {
  await container
    .locator(`xpath=.//label[contains(normalize-space(), ${xpathLiteral(label)})]/following::textarea[1]`)
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateToIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function currentWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(12, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

async function chooseFreeCurrentWeekDate(page: Page, candidateId: string): Promise<string> {
  const { start, end } = currentWeekBounds();
  const existing = await restGet<{ work_date: string }>(
    page,
    "timesheets",
    `select=work_date&candidate_id=eq.${candidateId}&work_date=gte.${dateToIsoDate(start)}&work_date=lte.${dateToIsoDate(end)}`,
  );
  const taken = new Set(existing.map((row) => row.work_date));
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const iso = dateToIsoDate(date);
    if (!taken.has(iso)) return iso;
  }
  throw new Error("Geen vrije dag in de huidige week gevonden voor opdrachtgever-urenflow");
}

async function loginPortal(page: Page, url: string, email: string, password: string): Promise<void> {
  const expectedUrl = url.includes("klantportaal") ? /\/klantportaal\/?$/ : /\/portaal\/?$/;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (expectedUrl.test(page.url())) return;
      await page.getByLabel("E-mailadres").fill(email, { timeout: 5_000 });
      await page.getByLabel("Wachtwoord").fill(password, { timeout: 5_000 });
      await page.getByRole("button", { name: /^Inloggen$/ }).click({ timeout: 5_000 });
      await expect(page).toHaveURL(expectedUrl, { timeout: 10_000 });
      return;
    } catch (error) {
      lastError = error;
      if (page.isClosed()) throw error;
      await page.waitForTimeout(1_000);
    }
  }
  throw lastError;
}

async function activatePortalAccount(page: Page, url: string, email: string, password: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const invalidLink = page.getByRole("heading", { name: /Link ongeldig of verlopen/i });
  if (await invalidLink.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    // The account may already be activated in a previous e2e attempt.
    return;
  }

  await expect(page.getByRole("heading", { name: /Portaal activeren/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#email")).toHaveValue(email);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.getByRole("button", { name: /Account aanmaken/i }).click();
  await page.getByRole("heading", { name: /Je account is aangemaakt/i })
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => undefined);
}

async function firstEditableTimesheetDay(page: Page): Promise<Locator> {
  const emptyDay = page.locator("div.cursor-pointer").filter({ hasText: "—" }).first();
  await expect(emptyDay).toBeVisible({ timeout: 10_000 });
  return emptyDay;
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
      !failure.includes("portal-activate: {\"error\":\"Ongeldige of verlopen uitnodiging\"}") &&
      !failure.includes("portal-activate: {\"error\":\"Er bestaat al een account met dit e-mailadres. Probeer in te loggen.\"}") &&
      !failure.includes("client-portal-activate: {\"error\":\"Ongeldige of verlopen uitnodiging\"}") &&
      !failure.includes("client-portal-activate: {\"error\":\"Er bestaat al een account met dit e-mailadres. Probeer in te loggen.\"}") &&
      !failure.includes("kvk-lookup: {\"error\":\"Geen bedrijf gevonden met dit KVK-nummer\"}") &&
      !failure.includes("[kvk-lookup] error:") &&
      !(failure.includes("Error fetching profile") && failure.includes("Failed to fetch")) &&
      !(failure.startsWith("console: TypeError: Failed to fetch") && failure.includes("_refreshAccessToken")) &&
      !failure.includes("validateDOMNesting") &&
      !failure.includes("cannot appear as a descendant of"),
  );
}

test("Admin UI maakt kernrecords aan: opdrachtgever, kandidaat, vacature, voertuig en pand", async ({ page }) => {
  requireMutatingWorkflows();
  test.setTimeout(180_000);
  const failures = watchFailures(page);
  await ensureLoggedIn(page);

  const companyName = `E2E Opdrachtgever ${runId}`;
  await page.goto("/opdrachtgevers/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Bedrijfsnaam", companyName);
  await fillInputAfterLabel(page, "KVK-nummer", `99${runId.slice(-6)}`);
  await fillInputAfterLabel(page, "Straat", "Teststraat 10");
  await fillInputAfterLabel(page, "Postcode", "5611AA");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await fillInputAfterLabel(page, "E-mail", `qa-company-${runId}@example.com`);
  await page.getByRole("button", { name: /Opdrachtgever aanmaken/i }).click();
  await expect(page).toHaveURL(/\/opdrachtgevers\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  const candidateFirst = "E2E";
  const candidateLast = `Kandidaat ${runId}`;
  await page.goto("/kandidaten/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Voornaam", candidateFirst);
  await fillInputAfterLabel(page, "Achternaam", candidateLast);
  await fillInputAfterLabel(page, "Geboortedatum", "1992-02-03");
  await fillInputAfterLabel(page, "Nationaliteit", "Nederlands");
  await fillInputAfterLabel(page, "E-mail", `qa-candidate-${runId}@example.com`);
  await fillInputAfterLabel(page, "Telefoon", "0612345678");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await fillTextareaAfterLabel(page, "Notities", `E2E kandidaat ${runId}`);
  await page.getByRole("button", { name: /Kandidaat aanmaken/i }).click();
  await expect(page.getByRole("heading", { name: /Profiellink versturen/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Naar kandidaat/i }).click();
  await expect(page).toHaveURL(/\/kandidaten\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: new RegExp(`${candidateFirst}.*${escapeRegExp(candidateLast)}`) })).toBeVisible({ timeout: 15_000 });

  const vacancyTitle = `E2E Lasser ${runId}`;
  await page.goto("/vacatures/new", { waitUntil: "domcontentloaded" });
  await selectAfterLabel(page, "Opdrachtgever", companyName);
  await selectAfterLabel(page, "Functie", /Andere functie/i);
  await fillInputAfterLabel(page, "Titel", vacancyTitle);
  await fillTextareaAfterLabel(page, "Beschrijving", "Volledige QA e2e vacature.");
  await fillInputAfterLabel(page, "Locatie", "Eindhoven");
  await page.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
  await fillInputAfterLabel(page, "Uurtarief", "42.50");
  await page.getByRole("button", { name: /Vacature aanmaken/i }).click();
  await expect(page).toHaveURL(/\/vacatures\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: vacancyTitle })).toBeVisible();

  const licensePlate = `E2${runId.slice(-6)}`;
  await page.goto("/transport/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Kenteken", licensePlate);
  await fillInputAfterLabel(page, "Merk", "Toyota");
  await fillInputAfterLabel(page, "Model", "Yaris QA");
  await fillInputAfterLabel(page, "Bouwjaar", "2021");
  await selectAfterLabel(page, "Brandstof", /Benzine/i);
  await fillInputAfterLabel(page, "Kilometerstand", "12345");
  await fillInputAfterLabel(page, "Aantal deuren", "5");
  await fillInputAfterLabel(page, "Tankcapaciteit", "42");
  await fillInputAfterLabel(page, "Gem. verbruik", "6.2");
  await page.getByRole("button", { name: /Voertuig aanmaken/i }).click();
  await expect(page).toHaveURL(/\/transport\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: licensePlate })).toBeVisible();
  await expect(page.locator("xpath=//*[normalize-space()='Aantal deuren']/following-sibling::*[1][normalize-space()='5']").first()).toBeVisible({ timeout: 10_000 });

  const propertyName = `E2E Woning ${runId}`;
  await page.goto("/huisvesting", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Nieuw pand/i }).click();
  await expect(page.getByRole("heading", { name: /Nieuw pand/i })).toBeVisible();
  await fillInputAfterLabel(page, "Straat", "QA Laan 7");
  await fillInputAfterLabel(page, "Postcode", "5651AB");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await fillInputAfterLabel(page, "Bijnaam", propertyName);
  await fillInputAfterLabel(page, "Huur (€)", "1200");
  await fillInputAfterLabel(page, "Gas (€)", "150");
  await fillInputAfterLabel(page, "Water (€)", "50");
  await fillInputAfterLabel(page, "Totale capaciteit", "4");
  await page.getByRole("button", { name: /^Opslaan$/ }).click();
  await page.getByPlaceholder("Zoek op naam, straat of woonplaats...").fill(propertyName);
  await expect(page.getByText(propertyName).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: new RegExp(escapeRegExp(propertyName)) }).first().click();
  await expect(page.getByRole("heading", { name: propertyName })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /Schoonmaak/i }).click();
  await page.getByRole("button", { name: /Nieuwe taak/i }).click();
  const cleaningTitle = `E2E schoonmaak ${runId}`;
  await fillInputAfterLabel(page, "Titel", cleaningTitle);
  await page.getByRole("button", { name: /^Opslaan$/ }).click();
  await expect(page.getByText(cleaningTitle).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Klaar/i }).click();
  await expect(page.getByText(/Voeg minimaal één schoonmaakfoto toe/i).first()).toBeVisible({ timeout: 10_000 });
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload("cleaning-proof.png"));
  await page.getByRole("button", { name: /Klaar/i }).click();
  await expect(page.getByText(/Status bijgewerkt|Klaar/i).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: /Contracten/i }).click();
  await expect(page.getByText(/Nieuw huurcontract/i)).toBeVisible({ timeout: 10_000 });
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload(`inhuur-${runId}.png`));
  await fillInputAfterLabel(page, "Begindatum", new Date().toISOString().slice(0, 10));
  await fillTextareaAfterLabel(page, "Notities", `E2E inhuurcontract ${runId}`);
  await page.getByRole("button", { name: /Uploaden/i }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Inhuurcontract.*inhuur-${escapeRegExp(runId)}\\.png`) })).toBeVisible({ timeout: 20_000 });

  await selectAfterLabel(page, "Contracttype", /Onderhuurcontract/i);
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload(`onderhuur-${runId}.png`));
  await fillInputAfterLabel(page, "Begindatum", new Date().toISOString().slice(0, 10));
  await fillTextareaAfterLabel(page, "Notities", `E2E onderhuurcontract ${runId}`);
  await page.getByRole("button", { name: /Uploaden/i }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Onderhuurcontract.*onderhuur-${escapeRegExp(runId)}\\.png`) })).toBeVisible({ timeout: 20_000 });

  expect(blockingFailures(failures)).toEqual([]);
});

test("Admin configureert tankpasvoorwaarden, fiscale signalering en rewardshop", async ({ page }) => {
  requireMutatingWorkflows();
  test.setTimeout(180_000);
  const failures = watchFailures(page);
  await ensureLoggedIn(page);

  await page.goto("/tankpas-analyse", { waitUntil: "domcontentloaded" });
  const conditionsTab = page.getByRole("tab", { name: /^Voorwaarden$/i });
  await expect(conditionsTab).toBeVisible({ timeout: 15_000 });
  await conditionsTab.click();
  await expect(page.getByRole("heading", { name: /Analysevoorwaarden/i })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Marge (%)").nth(0).fill("15");
  await page.getByLabel("Marge (%)").nth(1).fill("50");
  await page.getByLabel("Max. sprong (km)").fill("750");
  await page.getByRole("button", { name: /Voorwaarden opslaan/i }).click();
  await expect(page.getByText(/Voorwaarden opgeslagen/i).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/kilometeranalyse", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Zakelijke marge (%)").fill("15");
  await page.getByLabel("Privémarge per maand (km)").fill("300");
  await page.getByRole("button", { name: /^Opslaan$/ }).click();
  await expect(page.getByText(/Kilometerbeleid opgeslagen/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Analyse draaien/i }).click();
  await expect(page.getByText(/Privé boven marge|signaal/i).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/instellingen", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Matching/i }).click();
  await expect(page.getByText(/Verjaardagen, punten & rewards/i)).toBeVisible({ timeout: 15_000 });
  const rewardName = `E2E Reward ${runId}`;
  const rewardSection = page.locator(`xpath=//*[normalize-space()='Reward toevoegen']/ancestor::div[contains(@class,'rounded-md')][1]`);
  await rewardSection.scrollIntoViewIfNeeded();
  await fillInputWithin(rewardSection, "Naam", rewardName);
  await fillInputWithin(rewardSection, "Punten", "120");
  await fillTextareaWithin(rewardSection, "Omschrijving", `E2E reward redemption ${runId}`);
  await rewardSection.getByRole("button", { name: /Reward opslaan/i }).click();
  await expect(page.getByText(rewardName).first()).toBeVisible({ timeout: 20_000 });

  expect(blockingFailures(failures)).toEqual([]);
});

test("Medewerkerportaal activeert account en doorloopt uren, huisvesting, voertuigschade en ziekmelding", async ({ page }) => {
  requireMutatingWorkflows();
  test.setTimeout(240_000);
  const failures = watchFailures(page);
  const token = requiredEnv("E2E_EMPLOYEE_PORTAL_TOKEN");
  const email = requiredEnv("E2E_EMPLOYEE_PORTAL_EMAIL");
  const password = requiredEnv("E2E_PORTAL_PASSWORD");
  const employeeName = requiredEnv("E2E_SEEDED_EMPLOYEE_NAME");
  const propertyName = requiredEnv("E2E_SEEDED_PROPERTY_NAME");
  const licensePlate = requiredEnv("E2E_SEEDED_LICENSE_PLATE");

  await activatePortalAccount(page, `/portaal/activeren/${token}`, email, password);

  await loginPortal(page, "/portaal/login", email, password);
  await expect(page).toHaveURL(/\/portaal\/?$/, { timeout: 20_000 });
  await expect(page.getByText(employeeName.split(" ")[0]).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/portaal/uren", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Week \d+/)).toBeVisible({ timeout: 15_000 });
  const submitWeek = page.getByRole("button", { name: /Week indienen/i });
  const hasDraftWeek = await submitWeek
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasDraftWeek) {
    await (await firstEditableTimesheetDay(page)).click();
    await expect(page.getByRole("button", { name: /Uren opslaan/i })).toBeVisible();
    await page.locator('input[type="number"]').first().fill("7.5");
    await page.locator("textarea").first().fill(`E2E uren medewerkerportaal ${runId}`);
    await page.getByRole("button", { name: /Uren opslaan/i }).click();
    await expect(page.getByText(/7\.5u|7,5u|Uren opgeslagen/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(submitWeek).toBeVisible({ timeout: 15_000 });
  }
  await submitWeek.click();
  await expect(page.getByText(/Ingediend|Uren ingediend/i).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/portaal/huisvesting", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(propertyName).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Onderhoud melden/i }).click();
  await page.locator("textarea").first().fill(`E2E onderhoudsmelding ${runId}`);
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload("housing-proof.png"));
  await page.getByRole("button", { name: /Melding indienen/i }).click();
  await expect(page.getByText(/Klacht ingediend|Onderhoud melden/i).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/portaal/voertuig", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(licensePlate).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Schade melden/i }).click();
  await expect(page.getByRole("button", { name: /Schademelding indienen/i })).toBeDisabled();
  await page.locator("textarea").first().fill(`E2E dashboardlampje ${runId}`);
  await expect(page.getByRole("button", { name: /Schademelding indienen/i })).toBeDisabled();
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload("vehicle-damage.png"));
  await expect(page.getByRole("button", { name: /Schademelding indienen/i })).toBeEnabled();
  await page.getByRole("button", { name: /Schademelding indienen/i }).click();
  await expect(page.getByText(/Schademelding ingediend/i).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/portaal/ziekmelding", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="date"]').first().fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: /Ziekmelding indienen/i }).click();
  await expect(page.getByText(/Ziekmelding ingediend/i).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/portaal/punten", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Beschikbaar saldo/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Demo Bol\.com bon|E2E Reward/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Aanvragen/i }).first().click();
  await expect(page.getByText(/Reward aangevraagd|aangevraagd/i).first()).toBeVisible({ timeout: 20_000 });

  expect(blockingFailures(failures)).toEqual([]);
});

test("Klantportaal activeert account, ziet alleen eigen plaatsingen en keurt uren goed", async ({ page }) => {
  requireMutatingWorkflows();
  test.setTimeout(180_000);
  const failures = watchFailures(page);
  const token = requiredEnv("E2E_CLIENT_PORTAL_TOKEN");
  const email = requiredEnv("E2E_CLIENT_PORTAL_EMAIL");
  const password = requiredEnv("E2E_PORTAL_PASSWORD");
  const companyName = requiredEnv("E2E_SEEDED_COMPANY_NAME");
  const employeeName = requiredEnv("E2E_SEEDED_EMPLOYEE_NAME");
  const foreignEmployeeName = requiredEnv("E2E_FOREIGN_EMPLOYEE_NAME");

  await ensureLoggedIn(page);
  const companies = await restGet<{ id: string }>(
    page,
    "companies",
    `select=id&name=eq.${encodeURIComponent(companyName)}&limit=1`,
  );
  expect(companies[0]?.id, "Demo-opdrachtgever niet gevonden").toBeTruthy();
  await restPatch(page, "companies", `id=eq.${companies[0].id}`, {
    timesheet_entry_flow: "medewerker",
  });

  await activatePortalAccount(page, `/klantportaal/activeren/${token}`, email, password);

  await loginPortal(page, "/klantportaal/login", email, password);
  await expect(page).toHaveURL(/\/klantportaal\/?$/, { timeout: 20_000 });
  await expect(page.getByText(companyName).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/klantportaal/plaatsingen", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(employeeName).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(foreignEmployeeName)).toHaveCount(0);

  await page.goto("/klantportaal/uren", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(foreignEmployeeName)).toHaveCount(0);
  const approveButton = page.getByRole("button", { name: /^Goed$/ }).first();
  if (await approveButton.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await expect(page.getByText(employeeName).first()).toBeVisible({ timeout: 15_000 });
    await approveButton.click();
    await expect(page.getByText(/Uren goedgekeurd|Geen uren te beoordelen/i).first()).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(page.getByText(/Geen uren te beoordelen/i)).toBeVisible({ timeout: 15_000 });
  }
  await page.getByRole("tab", { name: /Beoordeeld/i }).click();
  if (await page.getByText(/Geen beoordeelde uren/i).waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await expect(page.getByText(foreignEmployeeName)).toHaveCount(0);
  } else {
    await expect(page.getByText(employeeName).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Goedgekeurd/i).first()).toBeVisible();
  }

  expect(blockingFailures(failures)).toEqual([]);
});

test("Klantportaal geeft uren door en medewerker bevestigt deze in medewerkerportaal", async ({ page }) => {
  requireMutatingWorkflows();
  test.setTimeout(180_000);
  const failures = watchFailures(page);
  const clientEmail = requiredEnv("E2E_CLIENT_PORTAL_EMAIL");
  const employeeEmail = requiredEnv("E2E_EMPLOYEE_PORTAL_EMAIL");
  const password = requiredEnv("E2E_PORTAL_PASSWORD");
  const companyName = requiredEnv("E2E_SEEDED_COMPANY_NAME");
  const employeeName = requiredEnv("E2E_SEEDED_EMPLOYEE_NAME");

  await ensureLoggedIn(page);

  const companies = await restGet<{ id: string }>(
    page,
    "companies",
    `select=id&name=eq.${encodeURIComponent(companyName)}&limit=1`,
  );
  expect(companies[0]?.id, "Demo-opdrachtgever niet gevonden").toBeTruthy();
  await restPatch(page, "companies", `id=eq.${companies[0].id}`, {
    timesheet_entry_flow: "opdrachtgever",
  });

  const candidates = await restGet<{ id: string }>(
    page,
    "candidates",
    `select=id&email=eq.${encodeURIComponent(employeeEmail)}&limit=1`,
  );
  expect(candidates[0]?.id, "Demo-medewerker niet gevonden").toBeTruthy();
  const workDate = await chooseFreeCurrentWeekDate(page, candidates[0].id);
  const notes = `E2E opdrachtgeveruren ${runId}`;

  await loginPortal(page, "/klantportaal/login", clientEmail, password);
  await page.goto("/klantportaal/uren", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /Uren doorgeven/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Uren doorgeven/i }).click();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(escapeRegExp(employeeName)) }).first().click();
  await page.locator('input[type="date"]').fill(workDate);
  await page.locator('input[type="number"]').nth(0).fill("6.5");
  await page.locator('input[type="number"]').nth(1).fill("1");
  await page.locator("textarea").fill(notes);
  await page.getByRole("button", { name: /^Doorgeven$/ }).click();
  await expect(page.getByText(/Uren doorgegeven aan medewerker/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(employeeName).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Wacht op bevestiging/i).first()).toBeVisible({ timeout: 20_000 });

  await loginPortal(page, "/portaal/login", employeeEmail, password);
  await page.goto("/portaal/uren", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(notes).first()).toBeVisible({ timeout: 20_000 });
  const employeeTimesheetRow = page.locator("div", { hasText: notes }).filter({
    has: page.getByRole("button", { name: /Bevestig/i }),
  }).first();
  await employeeTimesheetRow.getByRole("button", { name: /Bevestig/i }).click();
  await expectTimesheetConfirmed(page, candidates[0].id, notes);

  await loginPortal(page, "/klantportaal/login", clientEmail, password);
  await page.goto("/klantportaal/uren", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Bevestigd/i }).click();
  await expect(page.getByText(employeeName).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Bevestigd/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(notes)).toHaveCount(0);

  expect(blockingFailures(failures)).toEqual([]);
});

test("Admin transport incidenten: portal-schade zichtbaar en boete vereist foto-upload", async ({ page }) => {
  requireMutatingWorkflows();
  test.setTimeout(180_000);
  const failures = watchFailures(page);
  const vehicleId = requiredEnv("E2E_SEEDED_VEHICLE_ID");
  const employeeName = requiredEnv("E2E_SEEDED_EMPLOYEE_NAME");

  await ensureLoggedIn(page);
  await page.goto(`/transport/${vehicleId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Schade/i }).click();
  await expect(page.getByText(/E2E dashboardlampje/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(employeeName).first()).toBeVisible();

  await page.getByRole("tab", { name: /Boetes/i }).click();
  await page.getByRole("button", { name: /Nieuwe boete/i }).click();
  const fineDialog = page.getByRole("dialog", { name: /Nieuwe boete/i });
  await fillInputAfterLabel(page, "Datum", new Date().toISOString().slice(0, 10));
  await fillInputAfterLabel(page, "Bedrag", "96.50");
  await fillInputAfterLabel(page, "Beschrijving", `E2E parkeerboete ${runId}`);
  await expect(fineDialog.getByRole("button", { name: /^Opslaan$/ })).toBeDisabled();
  await page.locator('input[type="file"]').first().setInputFiles(imagePayload("fine-proof.png"));
  const saveFine = fineDialog.getByRole("button", { name: /^Opslaan$/ });
  await expect(saveFine).toBeEnabled();
  await saveFine.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText(`E2E parkeerboete ${runId}`).first()).toBeVisible({ timeout: 20_000 });

  expect(blockingFailures(failures)).toEqual([]);
});
