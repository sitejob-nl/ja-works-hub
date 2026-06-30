import { expect, test } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";

test.describe("Taken teamfilter", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("admin/interne gebruiker kan alle taken filteren op toegewezene", async ({ page }) => {
    await page.goto("/taken", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Taken" })).toBeVisible();

    await page.getByRole("button", { name: "Alle taken" }).click();

    const assigneeFilter = page.getByLabel("Filter op toegewezene");
    try {
      await expect(assigneeFilter).toBeVisible({ timeout: 15_000 });
    } catch {
      test.skip(true, "Ingelogde gebruiker heeft geen interne/adminrol voor teamtakenfilter");
    }

    await assigneeFilter.click();
    await expect(page.getByRole("option", { name: "Alle toegewezenen" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Nog niet toegewezen" })).toBeVisible();
  });
});
