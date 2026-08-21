import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureLoggedIn } from './e2e-helpers';

/**
 * Volledige visuele QA-ronde over de vijf punten van 20-08, headed.
 *
 * De ronde van gisteren draaide headless en raakte punt 1 en de opdrachtgever-kant
 * van punt 5 helemaal niet; de kandidaat-kant van punt 5 was vals groen (de test
 * controleerde op een dossier dat nooit openging). Deze ronde loopt elk punt af en
 * legt van elke bewering een screenshot vast.
 *
 * Draait tegen de gekozen E2E_BASE_URL met het demo-org account.
 */

const SHOT = 'scripts/.qa-headed';

// Vaste demo-org entiteiten, opgezocht in de database zodat navigatie niet van
// zoekresultaten of sorteervolgorde afhangt.
const MEDEWERKER = '863d888f-95ee-4c24-94da-876935dbfc79'; // geldig rijbewijs, geen auto, geen woning
const KANDIDAAT_MET_NOTITIE = '80ff1802-9d06-4dce-b7e9-2c9c504f48e8'; // Elena Popescu
const BEDRIJF_MET_NOTITIE = 'cc726420-9911-44d3-9bdd-3fac50b9f9c5'; // Demo Logistiek Tilburg
const PAND = '3b63b83b-eff3-451b-b56c-ec8a411cbe15'; // Demo Huisvesting Eindhoven, 4 kamers, 2 bewoners
const VOERTUIG = 'd3c02e90-d8d1-459c-881e-5ad98d9e9b08'; // FL-1560
const VOERTUIG_TOEGEWEZEN = 'b4415abe-29a4-4802-937a-6491dd9e7798'; // DEMO-01, toegewezen in 1a
const PLAATSING = '626999c5-99ae-4d18-b06a-8e8529ddd179';

const GUARD_TITEL = 'Je bent nog aan het bewerken.';
const VANDAAG = new Date().toISOString().slice(0, 10);

async function ga(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** Het paneel dat nu open staat. Radix geeft AlertDialog role=alertdialog, dus geen botsing. */
function paneel(page: Page): Locator {
  return page.locator('[role=dialog]').last();
}

/**
 * Maakt het formulier vuil. Tekstveld heeft de voorkeur; een datumveld staat vaak al
 * voorgevuld en een gelijke waarde telt terecht niet als wijziging.
 */
async function maakVuil(p: Locator): Promise<string | null> {
  const tekst = p.locator('input[type="text"]:not([readonly]), input:not([type]):not([readonly]), textarea:not([readonly])');
  for (let i = 0; i < Math.min(await tekst.count(), 3); i++) {
    const v = tekst.nth(i);
    if (await v.isVisible().catch(() => false) && await v.isEnabled().catch(() => false)) {
      await v.fill('QA wegklik 21-08');
      return 'tekstveld';
    }
  }
  const nummer = p.locator('input[type="number"]:not([readonly])').first();
  if (await nummer.count() && await nummer.isVisible().catch(() => false)) {
    await nummer.fill('77');
    return 'nummerveld';
  }
  const datum = p.locator('input[type="date"]:not([readonly])').first();
  if (await datum.count() && await datum.isVisible().catch(() => false)) {
    await datum.fill('2027-03-09');
    return 'datumveld';
  }
  return null;
}

/**
 * De hele wegklik-dans: vuil maken, Escape, bevestiging verwachten, terug naar het
 * formulier (tekst moet er nog staan), dan alsnog weggooien.
 */
async function verwachtGuard(page: Page, naam: string, nr: string) {
  const p = paneel(page);
  await expect(p, `${naam}: paneel opent niet`).toBeVisible({ timeout: 15_000 });

  const soort = await maakVuil(p);
  expect(soort, `${naam}: geen invulbaar veld gevonden om het formulier vuil te maken`).not.toBeNull();

  await page.keyboard.press('Escape');
  await expect(page.getByText(GUARD_TITEL), `${naam}: geen waarschuwing na Escape`).toBeVisible({ timeout: 6_000 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOT}/guard-${nr}.png` });

  // Verder bewerken houdt het paneel open.
  await page.getByRole('button', { name: 'Verder bewerken' }).click();
  await expect(page.getByText(GUARD_TITEL)).toHaveCount(0);
  await expect(p, `${naam}: paneel gesloten na "Verder bewerken"`).toBeVisible();

  // En nu wel weggooien.
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  const weg = page.getByRole('button', { name: 'Sluiten zonder opslaan' });
  await expect(weg).toBeVisible({ timeout: 6_000 });
  await page.waitForTimeout(350);
  await weg.click();
  await expect(p, `${naam}: paneel blijft open na weggooien`).toBeHidden({ timeout: 10_000 });
  return soort;
}

test.describe('QA 21-08 — punt 1: datum bij een toewijzing', () => {
  test.beforeEach(async ({ page }) => { await ensureLoggedIn(page); });

  test('1a voertuig — toewijzen en dan naam + datum tonen', async ({ page }) => {
    await ga(page, `/kandidaten/${MEDEWERKER}?tab=transport`);

    const knop = page.getByRole('button', { name: 'Voertuig toewijzen' });
    await expect(knop).toBeVisible({ timeout: 20_000 });
    await knop.click();

    const sheet = paneel(page);
    await expect(sheet.getByText('Voertuig toewijzen')).toBeVisible();
    // De datum staat leeg terwijl de hulptekst "standaard nu beschikbaar" zegt; zonder
    // datum blijft Toewijzen uitgeschakeld. Eerst datum, want die reset de voertuigkeuze.
    await sheet.locator('input[type="date"]').fill(VANDAAG);
    await sheet.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await page.screenshot({ path: `${SHOT}/p1a-toewijzen.png` });
    await sheet.getByRole('button', { name: 'Toewijzen', exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });

    // Huidig voertuig: naam én datum.
    await page.waitForLoadState('networkidle').catch(() => {});
    const label = page.getByText('Toegewezen door', { exact: true }).first();
    await expect(label).toBeVisible({ timeout: 15_000 });
    const waarde = await label.locator('xpath=following-sibling::p[1]').innerText();
    console.log('[p1a] huidig voertuig — Toegewezen door:', waarde);
    expect(waarde, 'naam ontbreekt').toContain('Demo');
    expect(waarde, 'datum ontbreekt (verwacht "naam · dd-mm-jjjj")').toMatch(/·\s*\d{2}-\d{2}-\d{4}/);
    await page.screenshot({ path: `${SHOT}/p1a-huidig.png`, fullPage: true });
  });

  test('1b woning — toewijzen, inchecken, en dan naam + datum tonen', async ({ page }) => {
    await ga(page, `/kandidaten/${MEDEWERKER}?tab=huisvesting`);

    // De knop verdwijnt zodra er al een lopende of gereserveerde woning is; bij een
    // herhaalde run slaan we het toewijzen dan over.
    const knop = page.getByRole('button', { name: 'Wijs kamer toe' });
    await page.waitForTimeout(1500);
    if (await knop.count()) {
      await knop.click();
      const sheet = paneel(page);
      await sheet.locator('input[type="date"]').first().fill(VANDAAG);
      await sheet.getByRole('combobox').first().click();      // pand
      await page.getByRole('option').first().click();
      await sheet.getByRole('combobox').nth(1).click();        // kamer
      await page.getByRole('option').first().click();
      await page.screenshot({ path: `${SHOT}/p1b-toewijzen.png` });
      await sheet.getByRole('button', { name: 'Toewijzen', exact: true }).click();
      await expect(sheet).toBeHidden({ timeout: 15_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    } else {
      console.log('[p1b] er stond al een kamertoewijzing klaar — toewijsstap overgeslagen');
    }

    // Een nieuwe kamertoewijzing komt altijd als 'gereserveerd' binnen. In dat blok
    // staat "Toegewezen door" helemaal niet — alleen in het ingecheckte blok.
    await expect(page.getByText('Gereserveerd')).toBeVisible({ timeout: 15_000 });
    // Alleen in het bovenste blok kijken: de historietabel eronder heeft een kolomkop
    // met dezelfde tekst en zou de meting vervuilen.
    const blok = page.locator('div.bg-card').first();
    const inGereserveerd = await blok.getByText('Toegewezen door', { exact: true }).count();
    console.log('[p1b] direct na toewijzen (status gereserveerd) — "Toegewezen door" zichtbaar:', inGereserveerd > 0);
    await page.screenshot({ path: `${SHOT}/p1b-gereserveerd.png`, fullPage: true });

    // Inchecken via de bewonerslijst van het pand waar de kamer in zit — dat hoeft niet
    // het pand uit de constante te zijn, de keuzelijst toont alle panden met vrije kamers.
    const pandHref = await page.locator('a[href^="/huisvesting/"]').first().getAttribute('href');
    console.log('[p1b] toegewezen pand:', pandHref);
    await ga(page, `${pandHref}?tab=bewoners`);
    const incheck = page.getByRole('button', { name: 'Inchecken' }).first();
    await expect(incheck, 'geen incheck-knop gevonden').toBeVisible({ timeout: 20_000 });
    await incheck.click();
    await page.waitForTimeout(1500);

    await ga(page, `/kandidaten/${MEDEWERKER}?tab=huisvesting`);
    const label = page.getByText('Toegewezen door', { exact: true }).first();
    await expect(label, 'na inchecken staat "Toegewezen door" er nog steeds niet').toBeVisible({ timeout: 20_000 });
    const waarde = await label.locator('xpath=following-sibling::p[1]').innerText();
    console.log('[p1b] huidige woning (ingecheckt) — Toegewezen door:', waarde);
    expect(waarde).toContain('Demo');
    expect(waarde).toMatch(/·\s*\d{2}-\d{2}-\d{4}/);
    await page.screenshot({ path: `${SHOT}/p1b-huidig.png`, fullPage: true });
  });

  test('1c historie — naam + datum blijven staan na inleveren en uitchecken', async ({ page }) => {
    // Voertuig inleveren, zodat de toewijzing naar "Eerdere voertuigen" verhuist.
    await ga(page, `/transport/${VOERTUIG_TOEGEWEZEN}?tab=toewijzingen`);
    const inleveren = page.getByRole('button', { name: 'Inleveren' }).first();
    if (await inleveren.count()) {
      await inleveren.click();
      const dlg = paneel(page);
      await expect(dlg.getByText('Voertuig inleveren')).toBeVisible({ timeout: 10_000 });
      const km = dlg.locator('input[type="number"]').first();
      if (await km.count()) await km.fill('123999');
      await dlg.getByRole('button', { name: 'Inleveren', exact: true }).click();
      await page.waitForTimeout(2000);
    } else {
      console.log('[p1c] geen actieve toewijzing om in te leveren');
    }

    await ga(page, `/kandidaten/${MEDEWERKER}?tab=transport`);
    await expect(page.getByText('Eerdere voertuigen'), 'historieblok transport ontbreekt').toBeVisible({ timeout: 20_000 });
    const kop = page.getByRole('columnheader', { name: 'Toegewezen door' });
    await expect(kop).toBeVisible({ timeout: 10_000 });
    const rij = await page.locator('table tbody tr').first().innerText();
    console.log('[p1c] historieregel transport:', rij.replace(/\n/g, ' | '));
    expect(rij).toMatch(/Demo[^|]*·\s*\d{2}-\d{2}-\d{4}/);
    await page.screenshot({ path: `${SHOT}/p1c-historie-transport.png`, fullPage: true });

    // Woning uitchecken, via het pand waar de kamer in zit.
    await ga(page, `/kandidaten/${MEDEWERKER}?tab=huisvesting`);
    const pandHref2 = await page.locator('a[href^="/huisvesting/"]').first().getAttribute('href');
    await ga(page, `${pandHref2}?tab=bewoners`);
    const uitcheck = page.getByRole('button', { name: 'Uitchecken' }).first();
    if (await uitcheck.count()) {
      await uitcheck.click();
      await page.waitForTimeout(2000);
    }

    await ga(page, `/kandidaten/${MEDEWERKER}?tab=huisvesting`);
    await expect(page.getByText('Eerdere huisvesting'), 'historieblok huisvesting ontbreekt').toBeVisible({ timeout: 20_000 });
    const rij2 = await page.locator('table tbody tr').first().innerText();
    console.log('[p1c] historieregel huisvesting:', rij2.replace(/\n/g, ' | '));
    expect(rij2).toMatch(/Demo[^|]*·\s*\d{2}-\d{2}-\d{4}/);
    await page.screenshot({ path: `${SHOT}/p1c-historie-huisvesting.png`, fullPage: true });
  });
});

test.describe('QA 21-08 — punt 2: waarschuwing bij wegklikken', () => {
  test.beforeEach(async ({ page }) => { await ensureLoggedIn(page); });

  // Panelen die met één knop open gaan.
  const eenvoudig: { nr: string; naam: string; url: string; knop: string | RegExp }[] = [
    { nr: '01', naam: 'Taken — nieuwe taak', url: '/taken', knop: /taak toevoegen/i },
    { nr: '02', naam: 'Contacten — nieuw contact', url: '/contacten', knop: 'Nieuw contact' },
    { nr: '03', naam: 'Opdrachtgever — nieuwe functie', url: `/opdrachtgevers/${BEDRIJF_MET_NOTITIE}?tab=functies`, knop: 'Nieuwe functie' },
    { nr: '04', naam: 'Opdrachtgever — nieuw tarief', url: `/opdrachtgevers/${BEDRIJF_MET_NOTITIE}?tab=tarieven`, knop: 'Nieuw tarief' },
    { nr: '05', naam: 'Medewerker — nieuwe inhouding', url: `/kandidaten/${MEDEWERKER}?tab=inhoudingen`, knop: 'Nieuwe inhouding' },
    { nr: '06', naam: 'Medewerker — nieuwe reservering', url: `/kandidaten/${MEDEWERKER}?tab=reserveringen`, knop: 'Nieuwe reservering' },
    { nr: '07', naam: 'Medewerker — nieuwe subsidie', url: `/kandidaten/${MEDEWERKER}?tab=subsidies`, knop: 'Nieuwe subsidie' },
    { nr: '08', naam: 'Pand — nieuwe kamer', url: `/huisvesting/${PAND}?tab=kamers`, knop: 'Nieuwe kamer' },
    { nr: '09', naam: 'Pand — nieuwe inspectie', url: `/huisvesting/${PAND}?tab=inspecties`, knop: 'Nieuwe inspectie' },
    { nr: '10', naam: 'Voertuig — nieuwe schademelding', url: `/transport/${VOERTUIG}?tab=schade`, knop: 'Nieuwe melding' },
    { nr: '11', naam: 'Voertuig — nieuwe boete', url: `/transport/${VOERTUIG}?tab=boetes`, knop: 'Nieuwe boete' },
    { nr: '12', naam: 'Instellingen — nieuw contracttemplate', url: '/instellingen?tab=hr', knop: 'Nieuw template' },
    { nr: '13', naam: 'Instellingen — nieuwe pandeigenaar', url: '/instellingen?tab=hr', knop: 'Nieuwe eigenaar' },
    { nr: '14', naam: 'Instellingen — aangepaste complianceregel', url: '/instellingen?tab=hr', knop: 'Aangepast' },
  ];

  for (const p of eenvoudig) {
    test(`2.${p.nr} ${p.naam}`, async ({ page }) => {
      await ga(page, p.url);
      const knop = page.getByRole('button', { name: p.knop }).first();
      await expect(knop, `${p.naam}: openknop niet gevonden`).toBeVisible({ timeout: 25_000 });
      await knop.scrollIntoViewIfNeeded();
      await knop.click();
      const soort = await verwachtGuard(page, p.naam, p.nr);
      console.log(`[2.${p.nr}] ${p.naam} — vuil gemaakt via ${soort}`);
    });
  }

  test('2.15 Plaatsing — uurtype, reistype en vergoeding', async ({ page }) => {
    const tabs: [string, string, string][] = [
      ['uurtypes', 'Uurtype', '15a'],
      ['reistypes', 'Reistype', '15b'],
      ['vergoedingen', 'Vergoeding', '15c'],
    ];
    for (const [tab, knopnaam, nr] of tabs) {
      await ga(page, `/plaatsingen/${PLAATSING}`);
      const tabknop = page.getByRole('tab', { name: new RegExp(tab.replace(/s$/, ''), 'i') }).first();
      await expect(tabknop, `tab ${tab} ontbreekt`).toBeVisible({ timeout: 25_000 });
      await tabknop.click();
      const knop = page.getByRole('button', { name: knopnaam, exact: true }).first();
      await expect(knop, `${knopnaam}: openknop niet gevonden`).toBeVisible({ timeout: 15_000 });
      await knop.click();
      await verwachtGuard(page, `Plaatsing — ${knopnaam}`, nr);
    }
  });

  test('2.16 Pand — bewoner toewijzen (meerstaps)', async ({ page }) => {
    await ga(page, `/huisvesting/${PAND}?tab=bewoners`);
    const knop = page.getByRole('button', { name: 'Bewoner toewijzen' });
    await expect(knop).toBeVisible({ timeout: 25_000 });
    await knop.click();

    const sheet = paneel(page);
    // Stap 1: kandidaat kiezen. Het zoekveld hoort er bewust NIET voor te zorgen dat
    // hij om bevestiging vraagt — zoeken is geen onopgeslagen werk.
    await sheet.locator('input[placeholder*="Zoek"]').fill('E2E');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(page.getByText(GUARD_TITEL), 'zoekveld maakt het formulier ten onrechte vuil').toHaveCount(0);
    await expect(sheet).toBeHidden({ timeout: 8_000 });

    // Opnieuw, nu doorlopen tot de stap met echte formuliervelden.
    await knop.click();
    const sheet2 = paneel(page);
    await sheet2.locator('button', { hasText: /E2E|Demo/ }).first().click();  // stap 1 → 2
    await page.waitForTimeout(400);
    await sheet2.locator('button', { hasText: /Kamer|kamer/ }).first().click(); // stap 2 → 3
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT}/guard-16-stap3.png` });
    await verwachtGuard(page, 'Pand — bewoner toewijzen', '16');
  });

  test('2.17 Pand — toewijzing bewerken', async ({ page }) => {
    await ga(page, `/huisvesting/${PAND}?tab=bewoners`);
    await page.waitForTimeout(1200);
    // Bewerken zit in het overloopmenu achter de drie puntjes.
    const menu = page.locator('table tbody tr').first().getByRole('button').last();
    await expect(menu, 'geen rij-actiemenu bij een bewoner gevonden').toBeVisible({ timeout: 20_000 });
    await menu.click();
    await page.getByRole('menuitem', { name: /bewerken/i }).click();
    const sheet = paneel(page);
    await expect(sheet.getByText('Toewijzing bewerken')).toBeVisible({ timeout: 10_000 });
    await verwachtGuard(page, 'Pand — toewijzing bewerken', '17');
  });

  test('2.18 Pand — nieuwe eigenaar via de pand-wizard', async ({ page }) => {
    await ga(page, '/huisvesting');
    const nieuw = page.getByRole('button', { name: /nieuw pand/i }).first();
    await expect(nieuw, 'knop "Nieuw pand" niet gevonden').toBeVisible({ timeout: 25_000 });
    await nieuw.click();
    const slide = paneel(page);
    await expect(slide).toBeVisible({ timeout: 10_000 });
    const eigenaar = slide.getByRole('combobox').filter({ hasText: /eigenaar|selecteer/i }).first();
    await eigenaar.click();
    await page.getByRole('option', { name: /nieuwe eigenaar/i }).click();

    // Hier zit een dialoog binnen een zijpaneel; alleen de binnenste hoort te sluiten.
    const dlg = page.locator('[role=dialog]').filter({ hasText: 'Nieuwe eigenaar' }).last();
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await dlg.locator('input').first().fill('QA wegklik 21-08');
    await page.keyboard.press('Escape');
    await expect(page.getByText(GUARD_TITEL), 'geen waarschuwing na Escape').toBeVisible({ timeout: 6_000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOT}/guard-18.png` });
    await page.getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(page.getByText(GUARD_TITEL)).toHaveCount(0);
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    const weg = page.getByRole('button', { name: 'Sluiten zonder opslaan' });
    await expect(weg).toBeVisible({ timeout: 6_000 });
    await page.waitForTimeout(350);
    await weg.click();
    await expect(page.getByRole('heading', { name: 'Nieuwe eigenaar' }), 'eigenaardialoog blijft open').toBeHidden({ timeout: 10_000 });
  });

  test('2.19 schoon formulier sluit zonder te vragen', async ({ page }) => {
    await ga(page, '/taken');
    await page.getByRole('button', { name: /taak toevoegen/i }).first().click();
    const sheet = paneel(page);
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByText(GUARD_TITEL)).toHaveCount(0);
    await expect(sheet).toBeHidden({ timeout: 6_000 });
    await page.screenshot({ path: `${SHOT}/guard-19-schoon.png` });
  });
});

test.describe('QA 21-08 — punt 3: borg bij het pand', () => {
  test.beforeEach(async ({ page }) => { await ensureLoggedIn(page); });

  test('3a borgblok op de Contracten-tab, met uitleg', async ({ page }) => {
    await ga(page, `/huisvesting/${PAND}?tab=contracten`);
    await expect(page.getByText('Borg pand')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/De borg die bewoners betalen staat per bewoner/)).toBeVisible();
    await expect(page.getByLabel(/borgbedrag/i).or(page.getByPlaceholder('0,00')).first()).toBeVisible();
    await page.screenshot({ path: `${SHOT}/p3a-borg-pand.png`, fullPage: true });
  });

  test('3b bewonersborgbedrag is weg bij Kosten en Bewoners', async ({ page }) => {
    await ga(page, `/huisvesting/${PAND}?tab=kosten`);
    await expect(page.getByRole('columnheader', { name: 'Borgbedrag' })).toHaveCount(0);
    await page.screenshot({ path: `${SHOT}/p3b-kosten.png`, fullPage: true });

    await ga(page, `/huisvesting/${PAND}?tab=bewoners`);
    await expect(page.getByRole('columnheader', { name: 'Borgbedrag' })).toHaveCount(0);
    // Het vinkje "borg betaald" per bewoner hoort te blijven bestaan.
    const borgBetaald = await page.getByText(/borg betaald/i).count();
    console.log('[p3b] "borg betaald" op de bewonerstab gevonden:', borgBetaald);
    await page.screenshot({ path: `${SHOT}/p3b-bewoners.png`, fullPage: true });
  });
});

test.describe('QA 21-08 — punt 4: duplicatenlijst', () => {
  test.beforeEach(async ({ page }) => { await ensureLoggedIn(page); });

  test('4 emmers, vergelijkingstabel en acties', async ({ page }) => {
    await ga(page, '/kandidaten/duplicaten');
    await expect(page.getByRole('heading', { name: 'Duplicatenbeheer' })).toBeVisible({ timeout: 30_000 });

    for (const emmer of ['Waarschijnlijk dezelfde persoon', 'Nakijken', 'Waarschijnlijk niet hetzelfde']) {
      const n = await page.getByText(new RegExp(`^${emmer} · \\d+$`)).count();
      console.log(`[p4] emmer "${emmer}": ${n > 0 ? 'aanwezig' : 'niet aanwezig in deze org'}`);
    }
    console.log('[p4] groepen met vergelijkingstabel:', await page.getByRole('columnheader', { name: 'Verschil' }).count());
    console.log('[p4] knop "Geen duplicaat" (wegzetten):', await page.getByRole('button', { name: /geen duplicaat/i }).count());
    console.log('[p4] knop "Samenvoegen in geselecteerde":', await page.getByRole('button', { name: /samenvoegen/i }).count());
    await page.screenshot({ path: `${SHOT}/p4-duplicaten.png`, fullPage: true });
  });

  /**
   * De demo-org had alleen de emmer "waarschijnlijk niet hetzelfde"; de kern van de
   * wijziging — één klik samenvoegen en apart nakijken — was daar dus niet te zien.
   * Voor deze ronde staan er twee wegwerpgroepen in: een schoon duplicaat en een groep
   * met twee geboortedata. Ze worden na afloop weer verwijderd.
   */
  test('4b alle drie de emmers, samenvoegen en wegzetten', async ({ page }) => {
    await ga(page, '/kandidaten/duplicaten');
    await expect(page.getByRole('heading', { name: 'Duplicatenbeheer' })).toBeVisible({ timeout: 30_000 });

    for (const emmer of ['Waarschijnlijk dezelfde persoon', 'Nakijken', 'Waarschijnlijk niet hetzelfde']) {
      await expect(page.getByText(new RegExp(`^${emmer} · \\d+$`)), `emmer "${emmer}" ontbreekt`).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.getByRole('button', { name: /Alle \d+ groepen samenvoegen|groepen samenvoegen/ })).toBeVisible();
    await page.screenshot({ path: `${SHOT}/p4b-drie-emmers.png`, fullPage: true });

    // Nakijken-groep: de botsende geboortedatum hoort in de vergelijking te staan.
    const marek = page.locator('div.space-y-3').filter({ hasText: 'QA-Nakijken' }).last();
    await expect(marek.getByText('Geboortedatum')).toBeVisible({ timeout: 10_000 });
    await marek.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOT}/p4b-nakijken-verschil.png`, fullPage: true });

    // Wegzetten en weer terugzetten.
    await marek.getByRole('button', { name: /geen duplicaat/i }).click();
    await expect(page.getByText('Groep weggezet als geen duplicaat')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    await expect(page.getByText('QA-Nakijken'), 'weggezette groep staat nog in de lijst').toHaveCount(0);
    await page.screenshot({ path: `${SHOT}/p4b-weggezet.png`, fullPage: true });

    // Weggezette groepen zijn verborgen tot je ze opvraagt.
    const toonWeggezet = page.getByRole('button', { name: /^Weggezet \(\d+\)$/ });
    await expect(toonWeggezet, 'knop "Weggezet (n)" ontbreekt').toBeVisible({ timeout: 10_000 });
    await toonWeggezet.click();
    await expect(page.getByText('QA-Nakijken').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT}/p4b-weggezet-getoond.png`, fullPage: true });
    const terug = page.getByRole('button', { name: /terugzetten/i }).first();
    await expect(terug).toBeVisible({ timeout: 10_000 });
    await terug.click();
    await expect(page.getByText('Groep staat weer in de lijst')).toBeVisible({ timeout: 10_000 });

    // Samenvoegen. Eerst de losse groepsknop, dan — als dat niets doet — de bulkactie,
    // want "alle groepen in één klik" is de kern van de wijziging.
    const adrian = page.locator('div.space-y-3').filter({ hasText: 'QA-Dubbel' }).last();
    await adrian.scrollIntoViewIfNeeded();
    await expect(adrian.getByText('Behouden').first()).toBeVisible();
    await page.screenshot({ path: `${SHOT}/p4b-voor-samenvoegen.png`, fullPage: true });

    await adrian.getByRole('button', { name: /samenvoegen in geselecteerde/i }).click();
    const melding = await page.locator('[data-sonner-toast]').first()
      .innerText({ timeout: 15_000 }).catch(() => '(geen melding verschenen)');
    console.log('[p4b] melding na losse samenvoegknop:', melding.replace(/\n/g, ' | '));
    await page.screenshot({ path: `${SHOT}/p4b-na-losse-merge.png`, fullPage: true });
    await page.waitForTimeout(2000);
    const adrianWeg = (await page.getByText('QA-Dubbel').count()) === 0;
    console.log('[p4b] losse samenvoeging uitgevoerd:', adrianWeg);

    // Bulkactie: alle samenvoegbare groepen in één klik.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    const bulk = page.getByRole('button', { name: /groepen samenvoegen/ }).first();
    if (await bulk.count()) {
      await bulk.click();
      const dialoog = page.locator('[role=alertdialog]');
      await expect(dialoog).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: `${SHOT}/p4b-bulk-bevestiging.png` });
      await dialoog.getByRole('button', { name: 'Samenvoegen', exact: true }).click();
      const bulkMelding = await page.locator('[data-sonner-toast]').first()
        .innerText({ timeout: 30_000 }).catch(() => '(geen melding verschenen)');
      console.log('[p4b] melding na bulk samenvoegen:', bulkMelding.replace(/\n/g, ' | '));
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SHOT}/p4b-na-bulk.png`, fullPage: true });
    } else {
      console.log('[p4b] geen bulkknop meer — alle samenvoegbare groepen waren al weg');
    }
  });
});

test.describe('QA 21-08 — punt 4c: losse samenvoegknop per groep', () => {
  test.beforeEach(async ({ page }) => { await ensureLoggedIn(page); });

  test('4c één groep samenvoegen met de knop in de groep zelf', async ({ page }) => {
    await ga(page, '/kandidaten/duplicaten');
    await expect(page.getByRole('heading', { name: 'Duplicatenbeheer' })).toBeVisible({ timeout: 30_000 });

    // De groepskaart = de kleinste div die zowel het profiel als de samenvoegknop bevat.
    const kaart = page.locator('div')
      .filter({ has: page.getByRole('link', { name: 'Stefan QA-Los' }).first() })
      .filter({ has: page.getByRole('button', { name: /samenvoegen in geselecteerde/i }) })
      .last();
    await expect(kaart, 'groep QA-Los niet gevonden').toBeVisible({ timeout: 15_000 });
    await kaart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOT}/p4c-voor.png`, fullPage: true });

    await kaart.getByRole('button', { name: /samenvoegen in geselecteerde/i }).click();
    const melding = page.getByText(/dubbel profiel(en)? samengevoegd/);
    await expect(melding, 'geen bevestiging na de losse samenvoegknop').toBeVisible({ timeout: 20_000 });
    console.log('[p4c] melding:', await melding.innerText());
    await page.screenshot({ path: `${SHOT}/p4c-melding.png`, fullPage: true });

    await page.waitForTimeout(2000);
    await expect(page.getByText('QA-Los'), 'groep staat er na samenvoegen nog').toHaveCount(0);
    await page.screenshot({ path: `${SHOT}/p4c-na.png`, fullPage: true });
  });
});

test.describe('QA 21-08 — punt 5: notities op één plek', () => {
  test.beforeEach(async ({ page }) => { await ensureLoggedIn(page); });

  test('5a kandidaat — Profiel-tab zonder notitieblok, Notities-tab mét de tekst', async ({ page }) => {
    await ga(page, `/kandidaten/${KANDIDAAT_MET_NOTITIE}?tab=profiel`);
    // Eerst bewijzen dat het dossier écht open staat (de vorige ronde faalde hierop).
    await expect(page.getByRole('tab', { name: 'Profiel' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('tab', { name: 'Profiel' })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText('Profielnotities (uit de conversie)')).toHaveCount(0);
    await expect(page.getByText('Nieuwe notities schrijf je op de Notities-tab.')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT}/p5a-profiel.png`, fullPage: true });

    await ga(page, `/kandidaten/${KANDIDAAT_MET_NOTITIE}?tab=notities`);
    await expect(page.getByText('Profielnotities').first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT}/p5a-notities.png`, fullPage: true });
  });

  test('5b opdrachtgever — Gegevens-tab zonder notitieveld, Notities-tab mét de tekst', async ({ page }) => {
    await ga(page, `/opdrachtgevers/${BEDRIJF_MET_NOTITIE}?tab=gegevens`);
    await expect(page.getByRole('tab', { name: 'Gegevens' })).toHaveAttribute('data-state', 'active', { timeout: 25_000 });
    // Er mag op dit tabblad geen bewerkbaar notitieveld meer staan. Alleen binnen het
    // actieve tabblad kijken: het woord "Notities" staat ook op de tabbalk zelf.
    const gegevens = page.locator('[role=tabpanel][data-state=active]');
    await expect(gegevens.getByText('Notities', { exact: true })).toHaveCount(0);
    await expect(gegevens.locator('textarea')).toHaveCount(0);
    await page.screenshot({ path: `${SHOT}/p5b-gegevens.png`, fullPage: true });

    await ga(page, `/opdrachtgevers/${BEDRIJF_MET_NOTITIE}?tab=notities`);
    await expect(page.getByText('Profielnotities').first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT}/p5b-notities.png`, fullPage: true });
  });
});
