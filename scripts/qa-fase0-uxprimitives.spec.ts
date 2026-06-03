// QA — Fase 0 UX-primitieven (branch worktree-ux-fase0-primitives)
//
// Valideert de twee in-app bedrade gedragingen van deze branch:
//   (a) Dashboard KPI-tegels zijn klikbare deep-links naar de onderliggende lijsten.
//   (b) De "Van"-afzenderselector in EmailCompose verschijnt bij >1 bruikbare
//       mailbox en blijft (terecht) verborgen bij <=1.
//
// READ-ONLY: navigeert en klikt alleen, maakt geen records aan, verstuurt geen mail.
//
// Auth: deze branch-app slaat de Supabase-sessie op in sessionStorage en wist
// localStorage `sb-*-auth-token` op load (commit a9a5ce9, session-timeout
// hardening). De gedeelde e2e-helper injecteert in localStorage en werkt
// daardoor NIET meer. Daarom logt deze spec in via de echte login-UI, zodat de
// app-eigen client de sessie in sessionStorage zet.

import { test, expect, Page } from "@playwright/test";

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const USER_ID = process.env.DEMO_USER_ID;

// De OnboardingWizard opent bij het eerste dashboard-bezoek (localStorage-flag
// `sitejob_onboarded_<userId>` ontbreekt) en legt een modal-overlay over de
// pagina die pointer-events onderschept. Zet de flag vóór app-init zodat de
// wizard niet opent; klikken op de KPI-tegels blijft dan ongehinderd.
async function suppressOnboarding(page: Page): Promise<void> {
  if (!USER_ID) return;
  await page.addInitScript((uid) => {
    try {
      localStorage.setItem(`sitejob_onboarded_${uid}`, "1");
    } catch {
      /* ignore */
    }
  }, USER_ID);
}

async function uiLogin(page: Page): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    test.skip(true, "TEST_EMAIL / TEST_PASSWORD niet gezet — kan niet inloggen");
    return;
  }
  await suppressOnboarding(page);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const emailField = page.locator("#email");
  if ((await emailField.count()) > 0) {
    await emailField.fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /^inloggen$/i }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25_000 });
  await expect(
    page.getByText(/log in om verder te gaan/i),
    "Na login mag het login-scherm niet zichtbaar zijn"
  ).toHaveCount(0, { timeout: 10_000 });
}

// Fallback: mocht er toch een blokkerende modal-overlay openstaan
// (OnboardingWizard of anders), dismiss die via "Overslaan" en wacht tot de
// overlay weg is. Idempotent en best-effort.
async function clearBlockingOverlay(page: Page): Promise<void> {
  const overlay = page.locator('[data-state="open"].fixed.inset-0').first();
  if (!(await overlay.isVisible().catch(() => false))) return;
  const skip = page.getByRole("button", { name: /^overslaan$/i });
  if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skip.click().catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await overlay.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

test.describe("Fase 0 — Dashboard KPI-tegels zijn klikbare deep-links", () => {
  test.beforeEach(async ({ page }) => {
    await uiLogin(page);
  });

  // tegel-label -> verwachte bestemmings-URL na klik.
  // NB: /medewerkers redirect in App.tsx naar /kandidaten?tab=in-dienst.
  const tiles: { label: RegExp; expect: RegExp; note: string }[] = [
    { label: /actieve medewerkers/i, expect: /\/(medewerkers|kandidaten)/, note: "/medewerkers (redirect -> /kandidaten?tab=in-dienst)" },
    { label: /open vacatures/i, expect: /\/vacatures(\?|$|\/)/, note: "/vacatures" },
    { label: /bezetting/i, expect: /\/huisvesting(\?|$|\/)/, note: "/huisvesting" },
    { label: /uren deze week/i, expect: /\/uren(\?|$|\/)/, note: "/uren" },
  ];

  for (const tile of tiles) {
    test(`Tegel "${tile.note}" navigeert naar onderliggende lijst`, async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await clearBlockingOverlay(page);

      // Dashboard stat-cards staan in een grid; de tegel is een <a> die het label bevat.
      const tileLink = page.locator("a", { hasText: tile.label }).first();
      await expect(tileLink, `Tegel met label ${tile.label} moet een klikbare link zijn`).toBeVisible({
        timeout: 15_000,
      });
      const href = await tileLink.getAttribute("href");
      expect(href, "Tegel moet een href hebben").toBeTruthy();
       
      console.log(`QA-FASE0 TEGEL "${tile.note}": href=${href}`);

      await tileLink.click({ timeout: 10_000 });
      await page.waitForURL(tile.expect, { timeout: 15_000 });
      expect(page.url()).toMatch(tile.expect);
      // Sanity: we zijn niet teruggevallen op het login-scherm.
      await expect(page.getByText(/log in om verder te gaan/i)).toHaveCount(0);
       
      console.log(`QA-FASE0 TEGEL "${tile.note}": NA KLIK url=${page.url()}`);
    });
  }
});

test.describe('Fase 0 — EmailCompose "Van"-afzenderselector', () => {
  test.beforeEach(async ({ page }) => {
    await uiLogin(page);
  });

  test('"Van"-selector verschijnt bij >1 mailbox, blijft verborgen bij <=1', async ({ page }) => {
    await page.goto("/email", { waitUntil: "domcontentloaded" });
    await clearBlockingOverlay(page);
    await page.waitForTimeout(3000); // outlook-accounts edge call laten settelen

    // Scenario A: geen bruikbare mailbox -> EmailInbox toont een Instellingen-prompt
    // en er is geen compose-knop. Dat is geldig gedrag; we skippen met uitleg.
    const noMailboxPrompt = page.getByText(
      /geen leesbare outlook mailbox|microsoft toestemming nodig|outlook accounts en rechten/i
    );
    const composeBtn = page.getByRole("button", { name: /nieuw bericht/i }).first();

    const haveCompose = await composeBtn.count();
    if (haveCompose === 0) {
      const promptVisible = (await noMailboxPrompt.count()) > 0;
      test.skip(
        true,
        promptVisible
          ? "Demo-org heeft geen bruikbare Outlook-mailbox gekoppeld: EmailInbox toont Instellingen-prompt, geen compose-knop. Afzenderselector niet toetsbaar via UI (verwacht)."
          : "Geen 'Nieuw bericht'-knop gevonden op /email (geen bruikbare mailbox of pagina-variant). Afzenderselector niet toetsbaar via UI."
      );
      return;
    }

    // Open de compose-dialog.
    await composeBtn.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await expect(dialog.getByText(/nieuw bericht/i)).toBeVisible();

    // De "Van"-rij rendert alleen bij usableAccounts.length > 1.
    // Combobox-trigger heeft placeholder "Kies afzender-mailbox".
    const vanLabel = dialog.getByText(/^van$/i);
    const vanSelect = dialog.getByText(/kies afzender-mailbox/i);

    const selectorPresent = (await vanLabel.count()) > 0 || (await vanSelect.count()) > 0;

    if (selectorPresent) {
      // >1 mailbox: selector moet zichtbaar en bruikbaar zijn.
      await expect(vanLabel.first()).toBeVisible();
      const trigger = dialog.getByRole("combobox").first();
      await expect(trigger).toBeVisible();
      await trigger.click();
      const options = page.getByRole("option");
      await expect(options.first()).toBeVisible({ timeout: 5000 });
      const optionCount = await options.count();
       
      console.log(`QA-FASE0 EMAIL: >1 bruikbare mailbox — "Van"-selector ZICHTBAAR met ${optionCount} optie(s).`);
      expect(optionCount).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("Escape");
    } else {
      // <=1 mailbox: selector hoort verborgen te zijn. Dat is correct gedrag.
       
      console.log('QA-FASE0 EMAIL: <=1 bruikbare mailbox — "Van"-selector terecht VERBORGEN.');
      await expect(vanSelect).toHaveCount(0);
      await expect(dialog.getByPlaceholder(/email@voorbeeld\.nl/i)).toBeVisible();
    }

    await page.keyboard.press("Escape");
  });
});
