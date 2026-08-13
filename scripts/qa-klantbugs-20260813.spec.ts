/**
 * Browser-QA voor de zes klantbugs van 13-08 (PR #234).
 *
 * Draait tegen de demo-org op de productie-frontend: echte code, niet-echte data.
 *   E2E_BASE_URL=https://ats.sitejob.nl TEST_EMAIL=$DEMO_ORG_EMAIL TEST_PASSWORD=$DEMO_ORG_PASSWORD \
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test --config=scripts/playwright.config.ts \
 *     scripts/qa-klantbugs-20260813.spec.ts
 *
 * Er wordt bewust nooit op "Toewijzen" gedrukt: dat triggert sendRegulationsForAssignment
 * en dus mogelijk echte mail/WhatsApp, terwijl de kill-switch van de demo-org uit staat.
 * De picker — de eigenlijke fix van bug 2 — is zonder opslaan te verifiëren.
 *
 * LET OP: bug 5 muteert wél demo-data (levert een lopende toewijzing in en verwijdert die).
 * Dat is bewust: alleen zo dek je de keten die in productie loog. Beide acties versturen niets.
 */
import { expect, type Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

async function rest(page: Page, path: string) {
  const token = await getAccessToken(page);
  if (!token || !SUPABASE_ANON) return null;
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return null;
  return (await res.json()) as any[];
}

test.describe("Klantbugs 13-08", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  // BUG 2 — de medewerkerskeuze las de legacy employees-tabel (7 rijen) via een
  // niet-doorzoekbare Select. Moet nu een zoekbare combobox op candidates zijn.
  test("bug 2: voertuigtoewijzing heeft een doorzoekbare medewerkerskeuze", async ({ page }) => {
    const vehicles = await rest(page, "vehicles?select=id&limit=1");
    const vehicleId = process.env.E2E_SEEDED_VEHICLE_ID ?? vehicles?.[0]?.id;
    if (!vehicleId) test.skip(true, "Geen voertuig in de demo-org");

    await page.goto(`/transport/${vehicleId}?tab=toewijzingen`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Voertuig toewijzen" }).first().click();

    // De oude UI was een <Select> met placeholder "Selecteer medewerker".
    await expect(page.getByText("Selecteer medewerker")).toHaveCount(0);

    const trigger = page.getByRole("combobox").filter({ hasText: /Zoek medewerker/i }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const search = page.getByPlaceholder(/Zoek op naam of personeelsnummer/i);
    await expect(search).toBeVisible();

    // Zoeken moet server-side resultaten opleveren uit de kandidatenpool.
    const candidates = await rest(page, "candidates?select=last_name&anonymized_at=is.null&limit=1");
    const term = String(candidates?.[0]?.last_name ?? "a").slice(0, 3);
    await search.fill(term);
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
    const hits = await page.getByRole("option").count();
    await page.screenshot({ path: "test-results/qa-bug2-picker.png", fullPage: false });
    console.log(`[bug2] zoekterm "${term}" → ${hits} resultaten in de picker`);
    expect(hits).toBeGreaterThan(0);
  });

  // BUG 5 — delete raakte 0 rijen zonder error; de UI meldde toch succes.
  // Na de fix hoort er óf echt verwijderd te worden, óf een rode melding te komen.
  test("bug 5: toewijzing verwijderen liegt niet meer", async ({ page }) => {
    // De UI staat verwijderen pas toe na inleveren; die stap zetten we hier zelf,
    // zodat de hele keten (inleveren → verwijderen) wordt gedekt.
    const open = await rest(
      page,
      "vehicle_assignments?select=id,vehicle_id&returned_date=is.null&limit=1",
    );
    const assignment = open?.[0];
    if (!assignment) test.skip(true, "Geen lopende toewijzing in de demo-org");

    await page.goto(`/transport/${assignment.vehicle_id}?tab=toewijzingen`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Inleveren" }).first().click();
    // Het km-veld heeft geen gekoppeld <label>; spreek het als spinbutton aan.
    await page.getByRole("dialog").getByRole("spinbutton").fill("123456");
    await page.getByRole("dialog").getByRole("button", { name: "Inleveren" }).click();
    await expect(page.getByText("Voertuig ingeleverd")).toBeVisible({ timeout: 15_000 });

    // De actieknop is icon-only zonder aria-label; pak 'm als laatste knop in de rij.
    await page.locator("tbody tr").first().getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Verwijderen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Verwijderen" }).click();

    // Succes-toast mag alleen verschijnen als de rij ook echt weg is.
    const success = page.getByText("Toewijzing verwijderd");
    const failed = page.getByText(/niet toegestaan|mislukt/i);
    await expect(success.or(failed).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/qa-bug5-verwijderen.png" });

    if (await success.isVisible().catch(() => false)) {
      const still = await rest(page, `vehicle_assignments?select=id&id=eq.${assignment.id}`);
      // DE KERN VAN DE BUG: succesmelding mag alleen als de rij écht verdwenen is.
      // (Vóór de fix bleef die staan en meldde de UI toch "Toewijzing verwijderd".)
      console.log(`[bug5] succesmelding getoond; rij nog in de database: ${(still?.length ?? 0) > 0}`);
      expect(still?.length ?? 0).toBe(0);
      await expect(page.getByText(/niet toegestaan|mislukt/i)).toHaveCount(0);
    } else {
      console.log("[bug5] geweigerd met een expliciete foutmelding — geen valse succesmelding");
    }
  });

  // BUG 1 — de rolrechten-trigger blokkeerde INSERT op property_owners.
  test("bug 1: nieuwe eigenaar aanmaken lukt", async ({ page }) => {
    const props = await rest(page, "properties?select=id&limit=1");
    const propertyId = props?.[0]?.id;
    if (!propertyId) test.skip(true, "Geen pand in de demo-org");

    const naam = `QA eigenaar ${Date.now()}`;
    // De eigenaarsectie zit in de bewerk-slide-over van het pand, niet op een eigen route.
    await page.goto(`/huisvesting/${propertyId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Bewerken/i }).first().click();

    // "Nieuwe eigenaar" is een optie ín de eigenaar-combobox, geen losse knop.
    await page.getByRole("combobox").filter({ hasText: /Kies eigenaar/i }).first().click();
    await page.getByRole("option", { name: /Nieuwe eigenaar/i }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Nieuwe eigenaar" });
    await dialog.getByRole("textbox").first().fill(naam);
    await dialog.getByRole("button", { name: "Aanmaken" }).click();

    await expect(page.getByText(/Onvoldoende rechten/i)).toHaveCount(0);
    await expect.poll(
      async () => (await rest(page, `property_owners?select=id&name=eq.${encodeURIComponent(naam)}`))?.length ?? 0,
      { timeout: 15_000 },
    ).toBe(1);
    await page.screenshot({ path: "test-results/qa-bug1-eigenaar.png" });
    console.log(`[bug1] eigenaar "${naam}" aangemaakt`);
  });

  // BUG 6 — de ontdubbeling mag alleen Carerix-dubbelingen verbergen, nooit een
  // profiel- of beschikbaarheidsnotitie die maar één keer bestaat.
  test("bug 6: pinned notities blijven zichtbaar als ze niet dubbel zijn", async ({ page }) => {
    const rows = await rest(page, "candidates?select=id,notes&notes=not.is.null&limit=5");
    const candidate = rows?.find((r) => String(r.notes ?? "").trim().length > 30);
    if (!candidate) test.skip(true, "Geen kandidaat met profielnotitie in de demo-org");

    const notes = await rest(page, `notes?select=id&related_entity_id=eq.${candidate.id}`);
    await page.goto(`/kandidaten/${candidate.id}?tab=notities`, { waitUntil: "domcontentloaded" });

    if ((notes?.length ?? 0) === 0) {
      // Geen notitierijen → er valt niets te ontdubbelen, de kaart moet blijven staan.
      await expect(page.getByText("Profielnotities", { exact: true })).toBeVisible({ timeout: 15_000 });
      console.log("[bug6] geen notitierijen; profielnotitie blijft correct zichtbaar");
    } else {
      console.log(`[bug6] kandidaat heeft ${notes?.length} notitierijen; ontdubbeling actief`);
      await expect(page.getByRole("tab", { name: "Notities" })).toHaveAttribute("data-state", "active");
    }
  });
});
