import { expect, test, type Page } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";

process.env.TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.DEMO_ORG_EMAIL;
process.env.TEST_PASSWORD = process.env.TEST_PASSWORD ?? process.env.DEMO_ORG_PASSWORD;

/**
 * Workbench (cockpit) en Taken (volledig overzicht) lezen dezelfde `recruiter_tasks`
 * en delen kaart, editor en cache-invalidatie. Deze QA bewaakt de naad: de doorlinks
 * moeten de juiste selectie openen en een actie op de ene pagina moet op de andere
 * zichtbaar zijn.
 */

const gotoWorkbench = async (page: Page) => {
  await page.goto("/workbench", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Workbench" })).toBeVisible({ timeout: 20_000 });
};

/** Maakt via de gedeelde editor een kritieke taak aan, zodat hij in elke lijst opduikt. */
const createTask = async (page: Page, title: string) => {
  await gotoWorkbench(page);
  await page.getByRole("button", { name: /Taak toevoegen|^Taak$/ }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder("Wat moet er gebeuren?").fill(title);
  await sheet.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Kritiek" }).click();
  await sheet.getByRole("button", { name: /Opslaan|Aanmaken/ }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });
};

/** Laat de QA-dataset schoon achter: negeren haalt de taak uit alle open lijsten. */
const cleanup = async (page: Page, title: string) => {
  await page.goto("/taken", { waitUntil: "domcontentloaded" });
  const row = page.locator("div.bg-card", { hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Taak negeren" }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });
};

test.describe("Taken × Workbench", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("workbench toont de cockpit en niet de volledige takenlijst", async ({ page }) => {
    await gotoWorkbench(page);

    // KPI-tegels vervangen de oude losse tellers.
    await expect(page.getByText("Kritiek", { exact: true })).toBeVisible();
    await expect(page.getByText("Achterstallig", { exact: true })).toBeVisible();
    await expect(page.getByText("In uitvoering", { exact: true })).toBeVisible();
    await expect(page.getByText("Vandaag afgerond", { exact: true })).toBeVisible();

    // De focuslijst verwijst door naar het volledige overzicht.
    await expect(page.getByRole("heading", { name: "Vandaag oppakken" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Alle taken \(\d+\)/ })).toBeVisible();

    // De eigen aanmaak-sheet is vervangen door de gedeelde editor (mét entiteitkoppeling).
    await page.getByRole("button", { name: /Taak toevoegen|^Taak$/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Nieuwe taak")).toBeVisible();
    await expect(sheet.getByText("Toewijzen aan")).toBeVisible();
    await expect(sheet.getByText(/Koppelen aan|Gekoppeld aan/)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("KPI-tegel opent /taken met de bijbehorende selectie", async ({ page }) => {
    await gotoWorkbench(page);

    await page.getByText("Achterstallig", { exact: true }).click();
    await page.waitForURL(/\/taken\?/);

    expect(new URL(page.url()).searchParams.get("status")).toBe("overdue");
    await expect(page.getByRole("heading", { name: "Taken" })).toBeVisible();
    // Het statusfilter staat voorgevuld op wat de tegel beloofde.
    await expect(page.getByLabel("Filter op status")).toContainText("Achterstallig");
  });

  test("scope Team komt mee naar het volledige overzicht", async ({ page }) => {
    await gotoWorkbench(page);

    await page.getByRole("button", { name: "Team", exact: true }).click();
    await page.getByRole("link", { name: /Alle taken \(\d+\)/ }).click();
    await page.waitForURL(/\/taken\?/);

    expect(new URL(page.url()).searchParams.get("weergave")).toBe("all");
    await expect(page.getByRole("button", { name: "Alle taken" })).toBeVisible();
  });

  test("onzinnige URL-parameters vallen terug op de standaardselectie", async ({ page }) => {
    await page.goto("/taken?status=kaas&prioriteit=banaan&weergave=nope", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Taken" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Filter op status")).toContainText("Openstaand");
    await expect(page.getByRole("button", { name: "Aan mij toegewezen" })).toBeVisible();
  });

  test("afvinken geeft bevestiging en is terug te draaien", async ({ page }) => {
    const title = `QA undo ${Date.now()}`;
    await createTask(page, title);

    await page.goto("/taken", { waitUntil: "domcontentloaded" });
    const row = page.locator("div.bg-card", { hasText: title }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("checkbox", { name: "Taak afronden" }).click();

    // Onder het filter "Openstaand" verdwijnt de taak — de toast is de enige feedback.
    await expect(page.getByText("Taak afgerond")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect(page.locator("div.bg-card", { hasText: title }).first()).toBeVisible({ timeout: 15_000 });

    await cleanup(page, title);
  });

  test("negeren is ook terug te draaien", async ({ page }) => {
    const title = `QA undo negeren ${Date.now()}`;
    await createTask(page, title);

    await page.goto("/taken", { waitUntil: "domcontentloaded" });
    const row = page.locator("div.bg-card", { hasText: title }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Taak negeren" }).click();

    await expect(page.getByText("Taak genegeerd")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole("button", { name: "Ongedaan maken" }).click();
    await expect(page.locator("div.bg-card", { hasText: title }).first()).toBeVisible({ timeout: 15_000 });

    await cleanup(page, title);
  });

  test("taak aanmaken op de workbench, afronden op /taken, terug zichtbaar op de workbench", async ({ page }) => {
    const title = `QA merge ${Date.now()}`;

    // 1 + 2. Aanmaken via de gedeelde editor; verschijnt in de focuslijst van de cockpit.
    await createTask(page, title);

    // 3. Afronden op het volledige overzicht.
    await page.goto("/taken", { waitUntil: "domcontentloaded" });
    const taskRow = page.locator("div.bg-card", { hasText: title }).first();
    await expect(taskRow).toBeVisible({ timeout: 20_000 });
    await taskRow.getByRole("checkbox", { name: "Taak afronden" }).click();
    // Het standaardfilter is "Openstaand", dus een afgeronde taak hoort te verdwijnen.
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });

    // 4. De cockpit ziet dezelfde mutatie — gedeelde cache-invalidatie.
    await gotoWorkbench(page);
    const doneStrip = page.locator("div", { has: page.getByRole("heading", { name: /Vandaag afgerond \(\d+\)/ }) }).last();
    await expect(doneStrip.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });

    // 5. Heropenen kan vanuit het afgerond-filter; de taak valt dan uit díe selectie.
    await page.goto("/taken?status=done", { waitUntil: "domcontentloaded" });
    const closedRow = page.locator("div.bg-card", { hasText: title }).first();
    await expect(closedRow).toBeVisible({ timeout: 20_000 });
    await closedRow.getByRole("checkbox", { name: "Taak heropenen" }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });

    // 6. Opruimen: negeren kan alleen op een open taak, dus terug naar het openstaand-filter.
    await page.goto("/taken", { waitUntil: "domcontentloaded" });
    const reopened = page.locator("div.bg-card", { hasText: title }).first();
    await expect(reopened).toBeVisible({ timeout: 20_000 });
    await reopened.getByRole("button", { name: "Taak negeren" }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
});
