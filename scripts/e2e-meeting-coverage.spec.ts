import { expect, Page, test } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";

type TextCheck = string | RegExp;

async function pageText(page: Page): Promise<string> {
  return (await page.locator("body").innerText({ timeout: 15_000 })).replace(/\s+/g, " ");
}

async function expectText(page: Page, check: TextCheck, label: string) {
  if (typeof check === "string") {
    const text = await pageText(page);
    expect(text, `${label}: ${check}`).toContain(check);
  } else {
    await expect(page.locator("body"), label).toContainText(check, { timeout: 30_000 });
  }
}

async function attachScreenshot(page: Page, name: string) {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test.describe("Meeting coverage browser QA — JA Werkt / VDS", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("Tankpasvoorwaarden en fiscale kilometeranalyse zijn browser-zichtbaar", async ({ page }) => {
    await page.goto("/tankpas-analyse", { waitUntil: "domcontentloaded" });
    await expectText(page, /Tankpas|Brandstof/i, "tankpas pagina");
    await page.getByRole("tab", { name: /Voorwaarden/i }).click();
    await expectText(page, /Voorwaarden/i, "tankpas voorwaarden tab");
    await expectText(page, /Tankcapaciteit|tankinhoud/i, "tankcapaciteit regel");
    await expectText(page, /verbruik/i, "verbruiksregel");
    await expectText(page, /kilometer/i, "kilometerregel");
    await attachScreenshot(page, "meeting-tankpas-voorwaarden");

    await page.goto("/kilometeranalyse", { waitUntil: "domcontentloaded" });
    await expectText(page, /Kilometeranalyse|Fiscale/i, "kilometeranalyse pagina");
    await expectText(page, /marge|priv/i, "fiscale marge signalering");
    await attachScreenshot(page, "meeting-kilometeranalyse");
  });

  test("Fleetoverzicht, boetes en schade tonen meetingvelden", async ({ page }) => {
    await page.goto("/transport", { waitUntil: "domcontentloaded" });
    await expectText(page, /Deuren/i, "transport deuren kolom");
    await expectText(page, /Tankpas/i, "transport tankpas kolom");
    await expectText(page, /Notitie/i, "transport notitie kolom");
    await attachScreenshot(page, "meeting-transport-overzicht");

    const firstVehicle = page.locator('a[href^="/transport/"]').first();
    await expect(firstVehicle, "minimaal een voertuigdetail-link voor meetingcheck").toBeVisible({ timeout: 30_000 });
    await firstVehicle.click();
    await expectText(page, /Aantal deuren/i, "voertuig detail deuren");
    await expectText(page, /Boetes/i, "voertuig detail boetes tab");
    await expectText(page, /Schade/i, "voertuig detail schade tab");

    await page.getByRole("tab", { name: /Boetes/i }).click();
    await expect(page, "voertuig tabstate boetes").toHaveURL(/tab=boetes/);
    await expectText(page, /Foto|Bewijs|Boete/i, "boete foto/bewijs");
    await page.getByRole("tab", { name: /Schade/i }).click();
    await expect(page, "voertuig tabstate schade").toHaveURL(/tab=schade/);
    await expectText(page, /Foto|Schademelding|Nieuwe melding/i, "schade foto/melding");
    await attachScreenshot(page, "meeting-voertuig-incidenten");
  });

  test("Huisvesting toont woonplaats/straat, kosten, contracten, eigenaar en schoonmaak", async ({ page }) => {
    await page.goto("/huisvesting", { waitUntil: "domcontentloaded" });
    await expectText(page, /Woonplaats/i, "huisvesting woonplaats kolom");
    await expectText(page, /Straat/i, "huisvesting straat kolom");
    await expectText(page, /Totale maandlasten|Bezettingsgraad/i, "huisvesting kosten/bezetting");
    await expectText(page, /Export|Exporteer/i, "huisvesting export");
    await attachScreenshot(page, "meeting-huisvesting-overzicht");

    const firstProperty = page.locator('a[href^="/huisvesting/"]').first();
    await expect(firstProperty, "minimaal een panddetail-link voor meetingcheck").toBeVisible({ timeout: 30_000 });
    await firstProperty.click();
    await expectText(page, /Kamers/i, "pand kamers tab");
    await expectText(page, /Kosten/i, "pand kosten tab");
    await expectText(page, /Schoonmaak/i, "pand schoonmaak tab");
    await expectText(page, /Contracten/i, "pand contracten tab");
    await expectText(page, /Eigenaar/i, "pand eigenaar tab");

    await page.getByRole("tab", { name: /Contracten/i }).click();
    await expect(page, "pand tabstate contracten").toHaveURL(/tab=contracten/);
    await expectText(page, /Inhuur|Onderhuur|Contract/i, "inhuur/onderhuur contracten");
    await page.getByRole("tab", { name: /Eigenaar/i }).click();
    await expect(page, "pand tabstate eigenaar").toHaveURL(/tab=eigenaar/);
    await expectText(page, /Notities|Geen notities|Contract/i, "eigenaar notities/contracten");
    await page.getByRole("tab", { name: /Schoonmaak/i }).click();
    await expect(page, "pand tabstate schoonmaak").toHaveURL(/tab=schoonmaak/);
    await expectText(page, /Schoonmaak|foto|taak/i, "schoonmaak taak/foto flow");
    await attachScreenshot(page, "meeting-pand-detail");
  });

  test("05-14 vacature, matching en workbench regressies zijn zichtbaar", async ({ page }) => {
    await page.goto("/workbench", { waitUntil: "domcontentloaded" });
    await expectText(page, /Workbench/i, "workbench pagina");
    await expectText(page, /Kritiek|Hoge prioriteit|AI Prioriteiten/i, "workbench prioriteiten");
    await attachScreenshot(page, "meeting-0514-workbench");

    await page.goto("/vacatures", { waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder(/functietitel of opdrachtgever/i), "vacature zoekveld").toBeVisible();
    await attachScreenshot(page, "meeting-0514-vacatures");

    const firstVacancy = page.locator('a[href^="/vacatures/"]').first();
    await expect(firstVacancy, "minimaal een vacaturedetail-link voor 05-14 meetingcheck").toBeVisible({ timeout: 30_000 });
    await firstVacancy.click();
    await expectText(page, /Matches/i, "vacature detail matches tab");
    await page.getByRole("tab", { name: /Matches/i }).click();
    await expect(page, "vacature tabstate matches").toHaveURL(/tab=matches/);
    await expectText(page, /Beste kandidaten uit eigen database|Gefilterd op vacature-eisen/i, "skill-first matchlijst");
    await attachScreenshot(page, "meeting-0514-vacature-matches");

    await page.goto("/match-pipeline", { waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder(/kandidaat, functietitel of opdrachtgever/i), "matchpipeline zoekveld").toBeVisible();
    await expectText(page, /Notificeer kandidaten|Selecteer zichtbare matches/i, "matchpipeline bulk kandidaatnotificaties");
    await attachScreenshot(page, "meeting-0514-matchpipeline");
  });

  test("Instellingen tonen Outlook, Exact, engagement en juridische templates", async ({ page }) => {
    await page.goto("/instellingen", { waitUntil: "domcontentloaded" });
    await expectText(page, /Algemeen|Koppelingen|Matching|HR & documenten|Data/i, "instellingen tabs");

    await page.getByRole("tab", { name: /Koppelingen/i }).click();
    await expectText(page, /Exact Online/i, "Exact Online settings");
    await expectText(page, /Microsoft 365|Outlook/i, "Outlook settings");

    await page.getByRole("tab", { name: /Matching/i }).click();
    await expectText(page, /Verjaardagen|punten|rewards/i, "engagement settings");

    await page.getByRole("tab", { name: /HR & documenten/i }).click();
    await expectText(page, /Contracttemplates|Algemene voorwaarden|Voertuigovereenkomst/i, "juridische templates");
    await attachScreenshot(page, "meeting-instellingen");

    await page.goto("/exact-online", { waitUntil: "domcontentloaded" });
    await expectText(page, /Exact Online/i, "Exact Online pagina");
    await expectText(page, /Relaties|Facturen|Artikelen/i, "Exact Online tabs");
    await attachScreenshot(page, "meeting-exact-online");
  });

  test("Mail- en portaalroutes renderen in browser", async ({ page }) => {
    await page.goto("/email", { waitUntil: "domcontentloaded" });
    await expectText(page, /E-mail/i, "mail pagina");
    await expectText(page, /Outlook|mailbox|Naar Instellingen|Nieuw bericht/i, "mailbox state");
    await attachScreenshot(page, "meeting-email");

    await page.goto("/solliciteren/e2e-onbekende-link", { waitUntil: "domcontentloaded" });
    await expectText(page, /Ongeldige aanmeldlink|Aanmeldlink verlopen|Aanmeldlink gesloten/i, "publieke recruitment intake route");
    await attachScreenshot(page, "meeting-public-intake-invalid-link");

    await page.goto("/portaal/login", { waitUntil: "domcontentloaded" });
    await expectText(page, /E-mailadres|Wachtwoord|Inloggen/i, "medewerkerportaal login");
    await attachScreenshot(page, "meeting-medewerkerportaal-login");

    await page.goto("/klantportaal/login", { waitUntil: "domcontentloaded" });
    await expectText(page, /E-mailadres|Wachtwoord|Inloggen/i, "klantportaal login");
    await attachScreenshot(page, "meeting-klantportaal-login");
  });
});
