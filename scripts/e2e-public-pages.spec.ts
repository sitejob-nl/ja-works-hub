// Smoke tests voor publieke routes — geen login nodig, gebruikt testen of
// de SPA zonder runtime errors rendert en kritieke UI elementen aanwezig zijn.

import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Public routes render without errors", () => {
  test("Portal login shows email + password fields", async ({ page }) => {
    await page.goto("/portaal/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /medewerkerportaal/i })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /inloggen/i })).toBeVisible();
  });

  test("Portal activatie handles invalid token gracefully", async ({ page }) => {
    await page.goto("/portaal/activeren/bogus-qa-test-token", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /link ongeldig|verlopen/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Onboarding with invalid token returns Link ongeldig", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/onboarding/bogus-qa-test-token-xyz", {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: /link ongeldig/i })
    ).toBeVisible({ timeout: 15_000 });

    // Geen "apikey" / auth errors in console — betekent VITE_SUPABASE_PUBLISHABLE_KEY werkt
    const authErrors = errors.filter(
      (e) => /no api key|apikey|unauthorized/i.test(e)
    );
    expect(authErrors, `Auth errors in console: ${JSON.stringify(authErrors)}`).toHaveLength(0);
  });

  test("Registration page renders form", async ({ page }) => {
    await page.goto("/registreren", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /starten|registreren/i })).toBeVisible();
  });
});

test.describe("Main auth redirect", () => {
  test("Root redirects to login when unauthenticated", async ({ page, context }) => {
    // Fresh context without storage state
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Moet naar /login / /portaal/login redirecten
    await page.waitForURL(/\/(login|portaal)/, { timeout: 10_000 });
  });
});
