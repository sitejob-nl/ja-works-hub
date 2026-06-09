import { expect, test } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";

test.describe("Screening callflow", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("waarschuwt bij onopgeslagen screeninginput en behoudt de callflow-state", async ({ page }) => {
    await page.goto("/kandidaten", { waitUntil: "domcontentloaded" });
    const firstCandidate = page.locator('a[href^="/kandidaten/"]').first();
    await expect(firstCandidate, "minimaal een kandidaatdetail-link").toBeVisible({ timeout: 30_000 });
    await firstCandidate.click();

    await page.getByRole("tab", { name: /Screening/i }).click();
    await expect(page.getByTestId("screening-start-call")).toBeVisible();
    await expect(page.getByTestId("screening-save-draft")).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Voorbereiding" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Contact & identiteit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mobiliteit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Werkprofiel" })).toBeVisible();

    const marker = `QA screening ${Date.now()}`;
    const firstAnswer = page.getByTestId("screening-answer-prep_cv_check");
    await firstAnswer.fill(marker);

    await page.getByRole("tab", { name: /^Profiel$/i }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Hé, je hebt het nog niet opgeslagen.");
    await page.getByRole("button", { name: /Blijf hier/i }).click();
    await expect(firstAnswer).toHaveValue(marker);
  });

  test("blokkeert verlaten van de kandidaat-bewerkpagina met onopgeslagen formulierveld", async ({ page }) => {
    await page.goto("/kandidaten", { waitUntil: "domcontentloaded" });
    const firstCandidate = page.locator('a[href^="/kandidaten/"]').first();
    await expect(firstCandidate, "minimaal een kandidaatdetail-link").toBeVisible({ timeout: 30_000 });
    await firstCandidate.click();

    await page.getByRole("button", { name: /Bewerken/i }).click();
    await expect(page).toHaveURL(/\/kandidaten\/.+\/bewerken/);

    const firstInput = page.locator("input").first();
    await firstInput.fill(`QA niet opgeslagen ${Date.now()}`);
    await page.getByRole("link", { name: /^Kandidaten$/ }).click();

    await expect(page.getByRole("alertdialog")).toContainText("Hé, je hebt het nog niet opgeslagen.");
    await page.getByRole("button", { name: /Blijf hier/i }).click();
    await expect(page).toHaveURL(/\/kandidaten\/.+\/bewerken/);
  });
});
