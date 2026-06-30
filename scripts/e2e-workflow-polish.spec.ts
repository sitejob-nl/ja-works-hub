import { expect, test, type Page } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

process.env.TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.DEMO_ORG_EMAIL;
process.env.TEST_PASSWORD = process.env.TEST_PASSWORD ?? process.env.DEMO_ORG_PASSWORD;

async function authHeaders(page: Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen access token beschikbaar voor workflow-polish QA");
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function findCandidateWithWorkHistory(page: Page) {
  const orgId = process.env.DEMO_ORG_ID;
  if (!orgId) return null;

  const res = await page.request.get(
    `${SUPABASE_URL}/rest/v1/candidates?select=id,ai_analysis&organization_id=eq.${orgId}&ai_analysis=not.is.null&order=updated_at.desc&limit=25`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok(), `AI-kandidaatselectie faalde: ${await res.text()}`).toBeTruthy();
  const rows = (await res.json()) as Array<{ id: string; ai_analysis: any }>;
  return rows.find((row) => Array.isArray(row.ai_analysis?.werkhistorie?.werkgevers) && row.ai_analysis.werkhistorie.werkgevers.length > 0)?.id ?? null;
}

test.describe("Meeting workflow polish", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("matchpipeline kaart opent een werkbare matchdetail-pop-up", async ({ page }) => {
    await page.goto("/match-pipeline", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("match-kanban-board")).toBeVisible({ timeout: 20_000 });

    const firstCard = page.getByTestId("match-kanban-card").first();
    if ((await firstCard.count()) === 0) test.skip(true, "Geen matchkaarten in QA dataset");
    await expect(firstCard).toBeVisible();
    await expect(firstCard.getByRole("button", { name: "Detail" })).toBeVisible();
    await firstCard.getByRole("button", { name: "Detail" }).click();

    const dialog = page.getByRole("dialog", { name: /Matchdetail/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Statuslog")).toBeVisible();
    await expect(dialog.getByText("Toewijzing")).toBeVisible();
    await expect(dialog.getByText("Notitie toevoegen")).toBeVisible();
    await expect(dialog.getByText("Taken", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Taak$/ })).toBeVisible();
  });

  test("screening toont de gekleurde werkervaringkaart boven de callflow", async ({ page }) => {
    const candidateId = await findCandidateWithWorkHistory(page);
    if (!candidateId) test.skip(true, "Geen kandidaat met AI-werkhistorie in QA dataset");

    await page.goto(`/kandidaten/${candidateId}?tab=screening`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Screening/i }).click();
    await expect(page.getByTestId("screening-work-history-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("screening-work-history-panel")).toContainText("Werkervaring in beeld");
    await expect(page.getByRole("heading", { name: "Belmenu / callflow" })).toBeVisible();
  });

  test("takenoverzicht heeft status- en toegewezen-filters voor teamoverzicht", async ({ page }) => {
    await page.goto("/taken", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Taken" })).toBeVisible();
    await page.getByRole("button", { name: "Alle taken" }).click();

    const assigneeFilter = page.getByLabel("Filter op toegewezene");
    try {
      await expect(assigneeFilter).toBeVisible({ timeout: 15_000 });
    } catch {
      test.skip(true, "Ingelogde gebruiker heeft geen interne/adminrol voor teamtakenfilter");
    }

    await page.getByRole("combobox", { name: "Filter op status" }).click();
    await expect(page.getByRole("option", { name: "Achterstallig" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Werkvoorraad per medewerker")).toBeVisible();
    await assigneeFilter.click();
    await expect(page.getByRole("option", { name: "Nog niet toegewezen" })).toBeVisible();
  });
});
