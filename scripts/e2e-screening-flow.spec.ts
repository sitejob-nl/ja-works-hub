import { expect, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

async function authHeaders(page: import("@playwright/test").Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen access token beschikbaar voor screening QA");
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function openCandidateWithFreshScreening(page: import("@playwright/test").Page) {
  const orgId = process.env.DEMO_ORG_ID;
  if (!orgId) {
    test.skip(true, "DEMO_ORG_ID ontbreekt; kan geen kandidaat met niet-gestarte screening kiezen");
    return;
  }

  const res = await page.request.get(
    `${SUPABASE_URL}/rest/v1/candidates?select=id&organization_id=eq.${orgId}&screened_at=is.null&screening_data=is.null&order=created_at.desc&limit=1`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok(), `Kandidaatselectie faalde: ${await res.text()}`).toBeTruthy();
  const rows = (await res.json()) as Array<{ id: string }>;
  const candidateId = rows[0]?.id;
  if (!candidateId) {
    test.skip(true, "Geen kandidaat met niet-gestarte screening in deze QA dataset");
    return;
  }

  await page.goto(`/kandidaten/${candidateId}`, { waitUntil: "domcontentloaded" });
}

async function openCandidateWithAiAnalysis(page: import("@playwright/test").Page) {
  const orgId = process.env.DEMO_ORG_ID;
  if (!orgId) {
    test.skip(true, "DEMO_ORG_ID ontbreekt; kan geen kandidaat met AI-analyse kiezen");
    return;
  }

  const res = await page.request.get(
    `${SUPABASE_URL}/rest/v1/candidates?select=id&organization_id=eq.${orgId}&ai_analysis=not.is.null&order=updated_at.desc&limit=1`,
    { headers: await authHeaders(page) },
  );
  expect(res.ok(), `AI-kandidaatselectie faalde: ${await res.text()}`).toBeTruthy();
  const rows = (await res.json()) as Array<{ id: string }>;
  const candidateId = rows[0]?.id;
  if (!candidateId) {
    test.skip(true, "Geen kandidaat met AI-analyse in deze QA dataset");
    return;
  }

  await page.goto(`/kandidaten/${candidateId}`, { waitUntil: "domcontentloaded" });
}

test.describe("Screening callflow", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("toont de meeting-screening UI als gescheiden cockpit", async ({ page }) => {
    await openCandidateWithAiAnalysis(page);

    await page.getByRole("tab", { name: /Screening/i }).click();
    await expect(page.getByRole("heading", { name: "Screening-cockpit" })).toBeVisible();
    await expect(page.getByTestId("screening-key-profile")).toContainText("Kernprofiel");
    await expect(page.getByRole("heading", { name: "AI-feiten controleren" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI-beredenering" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Belmenu / callflow" })).toBeVisible();
    await expect(page.getByTestId("screening-key-profile")).toContainText(/Functies \/ ervaring|Nog navragen/);
  });

  test("waarschuwt bij onopgeslagen screeninginput en behoudt de callflow-state", async ({ page }) => {
    await openCandidateWithFreshScreening(page);

    await page.getByRole("tab", { name: /Screening/i }).click();
    await expect(page.getByTestId("screening-start-call")).toBeVisible();
    await expect(page.getByTestId("screening-save-draft")).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Voorbereiding" })).toBeVisible();
    const stepButton = (label: string) => page.locator("button").filter({ hasText: label }).first();
    await expect(stepButton("Contact & identiteit")).toBeVisible();
    await expect(stepButton("Mobiliteit")).toBeVisible();
    await expect(stepButton("Werkprofiel")).toBeVisible();

    const marker = `QA screening ${Date.now()}`;
    const firstAnswer = page.getByTestId("screening-answer-prep_cv_check");
    await firstAnswer.fill(marker);

    await page.getByRole("tab", { name: /^Profiel$/i }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Hé, je hebt het nog niet opgeslagen.");
    await page.getByRole("button", { name: /Blijf hier/i }).click();
    await expect(firstAnswer).toHaveValue(marker);
  });

  test("vervangt de kandidaat-bewerkpagina door inline profielbewerking", async ({ page }) => {
    await page.goto("/kandidaten", { waitUntil: "domcontentloaded" });
    const firstCandidate = page.locator('a[href^="/kandidaten/"]').first();
    await expect(firstCandidate, "minimaal een kandidaatdetail-link").toBeVisible({ timeout: 30_000 });
    await firstCandidate.click();
    await expect(page.getByRole("tab", { name: /^Profiel$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bewerken$/i })).toHaveCount(0);

    const detailUrl = page.url();
    await page.goto(`${detailUrl.replace(/[?#].*$/, "")}/bewerken`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/kandidaten\/[^/]+\?tab=profiel$/);
    await expect(page.getByRole("tab", { name: /^Profiel$/i })).toHaveAttribute("data-state", "active");
  });
});
