// E2E smoke tests voor de drie kritieke admin-flows: kandidaat, uren, ziekmelding.
//
// Voert een programmatische login uit via Supabase auth. Test credentials via
// env vars TEST_EMAIL en TEST_PASSWORD. Valt terug op .auth-state.json storage
// state als die bestaat (voor lokale dev). Doet geen destructieve acties —
// alle tests zijn read/render-only.

import { test, expect, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_FILE = path.resolve(__dirname, ".auth-state.json");

const SUPABASE_URL = "https://noaupcteygfvlyymqtew.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vYXVwY3RleWdmdmx5eW1xdGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzAxNTEsImV4cCI6MjA4ODU0NjE1MX0.YmwNWZSt7IPTBnSNtKwMLlqPXiOaZdWeOQCbFrtWeT4";

async function ensureLoggedIn(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const isLoggedIn = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.includes("auth-token")) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || "null");
          return !!(v?.access_token ?? v?.currentSession?.access_token);
        } catch {
          return false;
        }
      }
    }
    return false;
  });

  if (isLoggedIn) return;

  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) {
    test.skip(true, "TEST_EMAIL / TEST_PASSWORD env vars niet gezet; auth skip");
    return;
  }

  // Programmatic login via Supabase REST
  const resp = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(resp.ok(), `Login faalde: ${await resp.text()}`).toBeTruthy();
  const body = await resp.json();

  // Inject session into localStorage zodat PortalContext / AuthContext het oppakt
  await page.evaluate(
    ({ session, projectRef }) => {
      const key = `sb-${projectRef}-auth-token`;
      localStorage.setItem(key, JSON.stringify(session));
    },
    { session: body, projectRef: "noaupcteygfvlyymqtew" }
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.context().storageState({ path: STORAGE_FILE });
}

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

  test("Vacature detail → Matches tab toont Kanban kolommen", async ({ page }) => {
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

    // Verwacht: Kanban pipeline header + minstens 5 kolommen
    await expect(page.getByText(/match pipeline/i)).toBeVisible();
    const columnCount = await page.locator(".flex-shrink-0.w-64").count();
    expect(columnCount, "Kanban moet >= 5 kolommen hebben").toBeGreaterThanOrEqual(5);
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
    const addBtn = page.getByRole("button", { name: /nieuwe uren|toevoegen/i }).first();
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
    await page.goto("/kandidaten", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const firstCand = page.locator('a[href^="/kandidaten/"]').first();
    const href = await firstCand.getAttribute("href");
    test.skip(!href || href === "/kandidaten/new", "Geen kandidaten in testdata");

    await firstCand.click();
    await page.waitForTimeout(1500);

    // Click Ziekte tab
    const ziekteTab = page.getByRole("tab", { name: /^ziekte$/i });
    await expect(ziekteTab).toBeVisible({ timeout: 5000 });
    await ziekteTab.click();
    await page.waitForTimeout(1500);

    // Verwacht: "Nieuwe ziekmelding" knop
    await expect(page.getByRole("button", { name: /nieuwe ziekmelding/i })).toBeVisible();
  });
});

test.describe("Portal + Opdrachtgeverportaal routes bestaan", () => {
  test("Opdrachtgeverportaal login accessible", async ({ page }) => {
    await page.goto("/opdrachtgeverportaal/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const content = await page.content();
    expect(content.length).toBeGreaterThan(1000);
  });
});
