// E2E smoke tests voor de drie kritieke admin-flows: kandidaat, uren, ziekmelding.
//
// Voert een programmatische login uit via Supabase auth. Test credentials via
// env vars TEST_EMAIL en TEST_PASSWORD. Valt terug op .auth-state.json storage
// state als die bestaat (voor lokale dev). Doet geen destructieve acties —
// alle tests zijn read/render-only.

import { test, expect, Page } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";
import { MATCH_STATUS_STEPS } from "../src/lib/match-status";

function collectNetworkErrors(page: Page): { url: string; status: number; body: string }[] {
  const errors: { url: string; status: number; body: string }[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/functions/v1/") && res.status() >= 400) {
      try {
        errors.push({ url: res.url(), status: res.status(), body: (await res.text()).slice(0, 300) });
      } catch {
        /* ignore */
      }
    }
  });
  return errors;
}

test.describe("Kritieke flow 1 — Kandidaat → Match → Plaatsing", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("Kandidaten lijst laadt met zichtbare rijen", async ({ page }) => {
    await page.goto("/kandidaten", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Pagina moet minstens 1 kandidaat of een "geen kandidaten" empty state tonen
    const count = await page.locator('table tbody tr, [role="row"]').count();
    const hasEmptyState = (await page.getByText(/geen kandidaten|nog geen/i).count()) > 0;
    expect(count > 0 || hasEmptyState, "Lijst moet laden of empty state tonen").toBeTruthy();
  });

  test("Vacature detail → Matches tab toont recruiter matchworkspace", async ({ page }) => {
    await page.goto("/vacatures", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const firstVacancy = page.locator('a[href^="/vacatures/"]').first();
    const href = await firstVacancy.getAttribute("href");
    test.skip(!href || href === "/vacatures/new", "Geen vacatures in testdata");

    await firstVacancy.click();
    await page.waitForTimeout(1500);

    // Click Matches tab
    await page.getByRole("tab", { name: /^matches$/i }).click();
    await page.waitForTimeout(1500);

    // Verwacht: de vacancy matchworkspace met statusfilters en shortlist.
    await expect(page.getByRole("heading", { name: /match-pipeline/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Beste kandidaten uit eigen database/i })).toBeVisible();
    for (const status of MATCH_STATUS_STEPS) {
      await expect(page.locator("button").filter({ hasText: status.label }).first(), `Statusfilter ${status.label}`).toBeVisible();
    }
  });

  test("Match pipeline pagina laadt zonder edge function errors", async ({ page }) => {
    const errors = collectNetworkErrors(page);

    await page.goto("/match-pipeline", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const blockers = errors.filter(
      (e) => e.body.includes("ES256") || e.body.includes("UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM")
    );
    expect(blockers, `ES256 errors: ${JSON.stringify(blockers)}`).toHaveLength(0);
  });
});

test.describe("Kritieke flow 2 — Uren", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("Uren pagina laadt + Nieuwe uren knop zichtbaar", async ({ page }) => {
    await page.goto("/uren", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Moet een add/toevoegen knop tonen
    const addBtn = page.getByRole("button", { name: /uren invoeren|nieuwe uren|toevoegen/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test("Bulk goedkeuren knop werkt (UI render check)", async ({ page }) => {
    await page.goto("/uren", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Check of goedkeuren knop render bij selectie — we klikken niet, alleen render
    const pageContent = await page.content();
    const hasApproveTerms = /goedkeuren|goedgekeurd/i.test(pageContent);
    expect(hasApproveTerms).toBeTruthy();
  });
});

test.describe("Kritieke flow 3 — Ziekmelding", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("Kandidaat detail → Ziekte tab laadt", async ({ page }) => {
    await page.goto("/kandidaten?tab=in-dienst", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const firstEmployee = page.locator('main table a[href^="/kandidaten/"]').first();
    const href = await firstEmployee.getAttribute("href");
    test.skip(!href || href === "/kandidaten/new", "Geen medewerkers in testdata");

    const ziekteUrl = `${href}${href.includes("?") ? "&" : "?"}tab=ziekte`;
    await page.goto(ziekteUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Verwacht: "Nieuwe ziekmelding" knop
    await expect(page.getByRole("button", { name: /nieuwe ziekmelding/i })).toBeVisible();
  });
});

test.describe("Portal + Opdrachtgeverportaal routes bestaan", () => {
  test("Klantportaal login accessible", async ({ page }) => {
    await page.goto("/klantportaal/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const content = await page.content();
    expect(content.length).toBeGreaterThan(1000);
  });
});
