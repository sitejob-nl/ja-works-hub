import { expect, test } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";

test.describe("Kanban en rechtenmodel", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("matchpipeline opent als Kanban met lijstfallback", async ({ page }) => {
    await page.goto("/match-pipeline", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /match pipeline/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /kanban/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /lijst/i })).toBeVisible();
    await expect(page.getByText(/Nieuwe match/i).first()).toBeVisible();
    await expect(page.getByText(/Sleep kaart|Geen matches/i).first()).toBeVisible();
  });

  test("instellingen toont configureerbare rollen en rechten", async ({ page }) => {
    await page.goto("/instellingen", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /rechten/i }).click();

    await expect(page.getByRole("heading", { name: /rollen & rechten/i })).toBeVisible();
    await expect(page.getByText("Pipeline bekijken")).toBeVisible();
    await expect(page.getByText("Kanban slepen")).toBeVisible();
    await expect(page.getByText("Afspraak definitief maken")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /admin/i }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /intercedent/i }).first()).toBeVisible();
  });
});
