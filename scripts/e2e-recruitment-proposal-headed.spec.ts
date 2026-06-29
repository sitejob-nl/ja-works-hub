import { expect, Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

test.describe.configure({ mode: "serial" });

const ALLOWED_OUTBOUND_RECIPIENTS = new Set([
  "kas@sitejob.nl",
  "info@sitejob.nl",
  "kasvdmeulengraaf@gmail.com",
  "kas@worldofdeals.nl",
]);

const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function requireMutatingFullWorkflow(): { proposalRecipient: string; candidateEmail: string } {
  if (process.env.E2E_ALLOW_MUTATING_WORKFLOWS !== "true") {
    test.skip(true, "Full workflow maakt echte QA-data aan; zet E2E_ALLOW_MUTATING_WORKFLOWS=true.");
  }
  const recipient = process.env.E2E_PROPOSAL_EMAIL;
  if (!recipient || !ALLOWED_OUTBOUND_RECIPIENTS.has(recipient)) {
    test.skip(true, "E2E_PROPOSAL_EMAIL moet exact een toegestane QA-recipient zijn.");
  }
  const candidateEmail = process.env.E2E_CANDIDATE_EMAIL ?? "kasvdmeulengraaf@gmail.com";
  if (!ALLOWED_OUTBOUND_RECIPIENTS.has(candidateEmail)) {
    test.skip(true, "E2E_CANDIDATE_EMAIL moet exact een toegestane QA-recipient zijn.");
  }
  return { proposalRecipient: recipient, candidateEmail };
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idFromUrl(url: string, path: string): string {
  const match = new RegExp(`${path}/([0-9a-f-]{36})`).exec(url);
  if (!match?.[1]) throw new Error(`Geen id gevonden in URL: ${url}`);
  return match[1];
}

function pdfPayload(name: string, lines: string[]) {
  const escapePdf = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const text = lines.map((line, index) => `${index === 0 ? "" : "0 -18 Td "}${`(${escapePdf(line)})`} Tj`).join("\n");
  const stream = `BT /F1 12 Tf 72 760 Td ${text} ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 595 842] /Contents 5 0 R >>\nendobj",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { name, mimeType: "application/pdf", buffer: Buffer.from(pdf) };
}

async function authHeaders(page: Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen admin access token beschikbaar voor REST-validatie");
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function restRows<T>(page: Page, table: string, query: string): Promise<T[]> {
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: await authHeaders(page),
  });
  expect(res.ok(), `${table} REST select faalde: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T[];
}

async function restInsert<T>(page: Page, table: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: { ...(await authHeaders(page)), Prefer: "return=representation" },
    data,
  });
  expect(res.ok(), `${table} REST insert faalde: ${await res.text()}`).toBeTruthy();
  const rows = (await res.json()) as T[];
  return rows[0];
}

async function restPatch(page: Page, table: string, filter: string, data: Record<string, unknown>): Promise<void> {
  const res = await page.request.patch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { ...(await authHeaders(page)), Prefer: "return=minimal" },
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

async function setScreeningAnswer(page: Page, key: string, value: string): Promise<void> {
  const answer = page.getByTestId(`screening-answer-${key}`);
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await answer.fill(value);
}

async function gotoDomContentLoaded(page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 3 || !message.includes("interrupted by another navigation")) throw error;
      await page.waitForTimeout(500);
    }
  }
}

async function matchCardForCandidate(page: Page, candidateFullName: string) {
  const candidateLink = page.getByRole("link", { name: new RegExp(escapeRegExp(candidateFullName)) }).first();
  await expect(candidateLink).toBeVisible({ timeout: 30_000 });
  return candidateLink.locator("xpath=ancestor::*[contains(@class,'rounded') and contains(@class,'border')][1]");
}

function watchFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) {
      failures.push(`console: ${msg.text()}`);
    }
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
      !failure.includes("whatsapp-send") &&
      !failure.includes("kvk-lookup") &&
      !(failure.includes("Error fetching profile") && failure.includes("Failed to fetch")) &&
      !(failure.startsWith("console: TypeError: Failed to fetch") && failure.includes("_refreshAccessToken")),
  );
}

test("Headed QA: kandidaat + CV + screening-callflow + match + voorstelreactie + plaatsing", async ({ page, browser }, testInfo) => {
  const { proposalRecipient, candidateEmail } = requireMutatingFullWorkflow();
  test.setTimeout(720_000);

  const failures = watchFailures(page);
  const suffix = `${runId}-${Date.now().toString().slice(-5)}`;
  const candidateFirst = "E2E";
  const candidateLast = `Voorstel ${suffix}`;
  const candidateFullName = `${candidateFirst} ${candidateLast}`;
  const companyName = `E2E Voorstel Opdrachtgever ${suffix}`;
  const vacancyTitle = `E2E MIG-MAG Lasser Voorstel ${suffix}`;

  await ensureLoggedIn(page);

  await page.goto("/opdrachtgevers/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Bedrijfsnaam", companyName);
  await fillInputAfterLabel(page, "KVK-nummer", `89${suffix.replace(/\D/g, "").slice(-6).padStart(6, "0")}`);
  await fillInputAfterLabel(page, "Straat", "Voorstelstraat 10");
  await fillInputAfterLabel(page, "Postcode", "5611AA");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await fillInputAfterLabel(page, "E-mail", proposalRecipient);
  await page.getByRole("button", { name: /Opdrachtgever aanmaken/i }).click();
  await expect(page).toHaveURL(/\/opdrachtgevers\/[0-9a-f-]{36}/, { timeout: 20_000 });

  await page.goto("/kandidaten/new", { waitUntil: "domcontentloaded" });
  await fillInputAfterLabel(page, "Voornaam", candidateFirst);
  await fillInputAfterLabel(page, "Achternaam", candidateLast);
  await fillInputAfterLabel(page, "Geboortedatum", "1991-03-04");
  await fillInputAfterLabel(page, "Nationaliteit", "Pools");
  await fillInputAfterLabel(page, "E-mail", candidateEmail);
  await fillInputAfterLabel(page, "Telefoon", "0612345678");
  await fillInputAfterLabel(page, "Straat", "Kandidaatstraat 1");
  await fillInputAfterLabel(page, "Postcode", "5611BB");
  await fillInputAfterLabel(page, "Stad", "Eindhoven");
  await page.locator("#dl").check();
  await fillInputAfterLabel(page, "Verloopdatum rijbewijs", "2028-12-31");
  await fillTextareaAfterLabel(page, "Notities", `E2E headed voorstelworkflow ${suffix}`);
  await page.getByRole("button", { name: /Kandidaat aanmaken/i }).click();
  await expect(page.getByRole("heading", { name: /Links versturen/i })).toBeVisible({ timeout: 20_000 });

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

  const publicContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    viewport: { width: 1400, height: 900 },
  });
  const publicProfile = await publicContext.newPage();
  try {
    await gotoDomContentLoaded(publicProfile, profileUrl);
    await expect(publicProfile.getByRole("heading", { name: new RegExp(`Hoi ${candidateFirst}`) })).toBeVisible({ timeout: 20_000 });
    await fillTextareaAfterLabel(publicProfile, "Extra beschikbaarheidsnotities", "Per direct fulltime beschikbaar voor twee- en drieploegendienst.");
    await publicProfile.locator('input[accept=".pdf,.doc,.docx,image/*"]').setInputFiles(pdfPayload(`cv-${suffix}.pdf`, [
      candidateFullName,
      "MIG-MAG lasser met heftruckervaring en VCA.",
      "Werkhistorie: E2E Lasbedrijf Brabant, 2021-2025.",
      "Beschikbaar per direct in regio Eindhoven.",
    ]));
    await publicProfile.getByRole("button", { name: /Profiel opslaan/i }).click();
    await expect(publicProfile.getByText(/Je profiel is aangevuld/i)).toBeVisible({ timeout: 30_000 });
  } finally {
    await publicContext.close();
  }

  await waitForRestRows<{ cv_file_url: string | null }>(
    page,
    "candidates",
    `select=cv_file_url&id=eq.${candidateId}&limit=1`,
    (rows) => Boolean(rows[0]?.cv_file_url),
    30_000,
  );

  await restInsert(page, "candidate_employment", {
    organization_id: process.env.DEMO_ORG_ID,
    candidate_id: candidateId,
    start_date: "2021-01-01",
    end_date: "2025-05-31",
    contract_type: "Fulltime",
    is_current: false,
    notes: "Werkgever: E2E Lasbedrijf Brabant\nFunctie: MIG-MAG lasser\nReferentie uit fictief QA-CV.",
  });

  await restPatch(page, "candidates", `id=eq.${candidateId}`, {
    ai_status: "completed",
    ai_summary: `${candidateFullName} is een ervaren MIG-MAG lasser met heftruckervaring, VCA en aantoonbare productie-ervaring in Brabant.`,
    ai_function_group: "metaal",
    ai_classification: "specialist",
    ai_positive_signals: ["MIG-MAG ervaring", "VCA aanwezig", "Heftruckervaring", "Direct beschikbaar"],
    ai_risk_factors: ["Referentie nog controleren"],
    ai_target_functions: ["MIG-MAG lasser", "Productiemedewerker metaal"],
    ai_interview_questions: ["Welke lasposities beheers je?", "Wanneer kun je starten?"],
    ai_reliability_score: 8,
    most_recent_role: "MIG-MAG lasser",
    most_recent_role_year: 2025,
    skills: ["MIG-MAG lassen", "Heftruck"],
    certifications: ["VCA"],
    languages: ["Nederlands", "Engels"],
    available_from: today,
    availability_notes: "Per direct fulltime beschikbaar voor ploegendienst.",
  });

  await page.goto("/vacatures/new", { waitUntil: "domcontentloaded" });
  await selectAfterLabel(page, "Opdrachtgever", companyName);
  await selectAfterLabel(page, "Functie", /Andere functie/i);
  await fillInputAfterLabel(page, "Titel", vacancyTitle);
  await fillTextareaAfterLabel(page, "Beschrijving", "MIG-MAG lasser met heftruckervaring, VCA en rijbewijs voor productieomgeving.");
  await fillInputAfterLabel(page, "Locatie", "Eindhoven");
  await page.locator('input[type="date"]').first().fill(today);
  await fillInputAfterLabel(page, "Uurtarief", "24.50");
  await page.locator("#dl").check();
  await page.getByRole("button", { name: /Vacature aanmaken/i }).click();
  await expect(page).toHaveURL(/\/vacatures\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const vacancyId = idFromUrl(page.url(), "/vacatures");
  await restPatch(page, "vacancies", `id=eq.${vacancyId}`, {
    required_skills: ["MIG-MAG lassen", "Heftruck"],
    required_certifications: ["VCA"],
    requires_drivers_license: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("tab", { name: /Matches/i }).click();
  await page.getByPlaceholder("Zoek kandidaat...").fill(candidateLast);
  await expect(page.getByText(candidateFullName).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Match maken/i }).first().click();
  await expect(page.getByText(/Match gemaakt/i).first()).toBeVisible({ timeout: 20_000 });

  const matchRows = await waitForRestRows<{ id: string }>(
    page,
    "matches",
    `select=id&candidate_id=eq.${candidateId}&vacancy_id=eq.${vacancyId}&limit=1`,
    (rows) => rows.length === 1,
    20_000,
  );
  const matchId = matchRows[0].id;

  await page.goto(`/kandidaten/${candidateId}?tab=screening&vacancy=${vacancyId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Screening/i }).click();
  const startCall = page.getByTestId("screening-start-call");
  if (await startCall.isVisible().catch(() => false)) await startCall.click();
  await setScreeningAnswer(page, "prep_cv_check", "CV doorgenomen: laservaring, VCA en heftruck bevestigd.");
  await page.getByRole("button", { name: /2\s+Contact & identiteit/i }).click();
  await setScreeningAnswer(page, "identity_work_right", "Poolse nationaliteit bevestigd, documenten worden nageleverd.");
  await page.getByRole("button", { name: /3\s+Mobiliteit/i }).click();
  await setScreeningAnswer(page, "drivers_license_type", "Rijbewijs B geldig tot 2028 bevestigd.");
  await page.getByRole("button", { name: /4\s+Werkprofiel/i }).click();
  await setScreeningAnswer(page, "experience_summary", "Vier jaar MIG-MAG ervaring, productie en kwaliteitscontrole.");
  await page.getByRole("button", { name: /5\s+Beschikbaarheid/i }).click();
  await setScreeningAnswer(page, "availability_date", "Per direct beschikbaar, akkoord met ploegendienst.");
  await page.getByRole("button", { name: /6\s+Persoonlijk/i }).click();
  await setScreeningAnswer(page, "motivation_future", "Wil langdurig in Nederland werken en doorgroeien in metaal.");
  await page.getByRole("button", { name: /7\s+Besluit/i }).click();
  await setScreeningAnswer(page, "critical_unknowns", "Referentie wordt later gecontroleerd; geen blokkade voor voorstellen.");
  await setScreeningAnswer(page, "next_action", "Voorstellen aan opdrachtgever en bij akkoord plaatsen.");
  await selectAfterLabel(page, "Eindresultaat", /Goedgekeurd/i);
  await page.getByTestId("screening-summary").fill("Goedgekeurde kandidaat voor MIG-MAG lasser. Direct beschikbaar en passend op eisen.");
  await page.getByTestId("screening-complete").click();
  await expect(page.getByText(/Screening afgerond/i).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`/vacatures/${vacancyId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Matches/i }).click();
  const matchRow = await matchCardForCandidate(page, candidateFullName);
  await matchRow.getByRole("button", { name: /Gescreend/i }).click();
  await expect(page.getByText(/Status bijgewerkt/i).first()).toBeVisible({ timeout: 20_000 });
  const screenedRow = await matchCardForCandidate(page, candidateFullName);
  await screenedRow.getByRole("button", { name: /Voorgesteld/i }).click();
  await expect(page.getByText(/Status bijgewerkt/i).first()).toBeVisible({ timeout: 20_000 });

  const proposedRow = await matchCardForCandidate(page, candidateFullName);
  await expect(proposedRow).toBeVisible({ timeout: 30_000 });
  await proposedRow.getByRole("button", { name: /^Mail$/i }).click();
  await expect(page.getByRole("dialog", { name: /Voorstel versturen/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Versturen naar opdrachtgever/i })).toBeEnabled({ timeout: 30_000 });

  const proposalResponsePromise = page.waitForResponse((res) => {
    const postData = res.request().postData() ?? "";
    return res.url().includes("/functions/v1/send-match-proposal") &&
      res.request().method() === "POST" &&
      !postData.includes('"preview":true');
  });
  await page.getByRole("button", { name: /Versturen naar opdrachtgever/i }).click();
  const proposalResponse = await proposalResponsePromise;
  const proposalJson = await proposalResponse.json();
  expect(proposalResponse.ok(), `send-match-proposal faalde: ${JSON.stringify(proposalJson)}`).toBeTruthy();
  expect(proposalJson.success).toBe(true);
  const responseUrl = String(proposalJson.response_url ?? "");
  const token = responseUrl.split("/match-response/")[1];
  expect(token, `Geen response token in ${responseUrl}`).toBeTruthy();

  const publicResponse = await browser.newPage({ baseURL: testInfo.project.use.baseURL as string, viewport: { width: 1400, height: 1000 } });
  try {
    await gotoDomContentLoaded(publicResponse, `/match-response/${token}`);
    await expect(publicResponse.getByRole("heading", { name: candidateFullName })).toBeVisible({ timeout: 30_000 });
    await expect(publicResponse.getByText("E2E Lasbedrijf Brabant").first()).toBeVisible({ timeout: 20_000 });
    await expect(publicResponse.locator('embed[type="application/pdf"]')).toBeVisible({ timeout: 20_000 });
    await publicResponse.screenshot({ path: testInfo.outputPath("proposal-response-page.png"), fullPage: true });
    await publicResponse.getByRole("button", { name: /Direct starten/i }).click();
    await publicResponse.locator("#startDate").fill(tomorrow);
    await publicResponse.getByPlaceholder(/Opmerking/i).fill("QA akkoord: direct starten.");
    await publicResponse.getByRole("button", { name: /^Bevestig$/i }).click();
    await expect(publicResponse.getByText(/Bedankt voor uw reactie/i)).toBeVisible({ timeout: 30_000 });
  } finally {
    await publicResponse.close();
  }

  await waitForRestRows<{ status: string }>(
    page,
    "matches",
    `select=status&id=eq.${matchId}&limit=1`,
    (rows) => rows[0]?.status === "geaccepteerd",
    30_000,
  );

  await page.goto(`/vacatures/${vacancyId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Matches/i }).click();
  const acceptedRow = await matchCardForCandidate(page, candidateFullName);
  await expect(acceptedRow).toBeVisible({ timeout: 30_000 });
  await acceptedRow.getByRole("button", { name: /^Plaatsen$/i }).click();
  await expect(page.getByRole("heading", { name: /Plaatsing aanmaken/i })).toBeVisible({ timeout: 20_000 });
  await fillInputAfterLabel(page, "Factuurtarief klant", "42.50");
  await page.getByRole("button", { name: /^Plaatsing aanmaken$/i }).click();

  const complianceDialog = page.getByRole("heading", { name: /Dossier niet compleet/i });
  if (await complianceDialog.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false)) {
    await page.getByRole("button", { name: /Toch plaatsen/i }).click();
  }

  await expect(page.getByText(/Plaatsing aangemaakt/i).first()).toBeVisible({ timeout: 40_000 });
  await waitForRestRows(
    page,
    "placements",
    `select=id&candidate_id=eq.${candidateId}&match_id=eq.${matchId}&limit=1`,
    (rows) => rows.length === 1,
    30_000,
  );

  expect(blockingFailures(failures)).toEqual([]);
});
