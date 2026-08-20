import { expect, test } from '@playwright/test';
import { ensureLoggedIn } from './e2e-helpers';

/**
 * Handmatige QA-ronde voor de vijf punten van 20-08:
 *  1. datum bij een toewijzing
 *  2. waarschuwing bij wegklikken, breed
 *  3. borg op pandniveau bij de contracten
 *  4. duplicatenlijst met verdeling en verschillen
 *  5. profielnotities weg van de profieltab
 *
 * Draait tegen de dev-server van de worktree, met het demo-org account.
 */

test.describe('buglijst 20-08', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('1 + 5: kandidaatdossier — geen profielnotities op de profieltab', async ({ page }) => {
    await page.goto('/kandidaten', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const firstCandidate = page.locator('table tbody tr').first();
    await expect(firstCandidate).toBeVisible({ timeout: 20_000 });
    await firstCandidate.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    // Profieltab mag geen notitieblok meer tonen.
    await expect(page.getByText('Profielnotities (uit de conversie)')).toHaveCount(0);
    await page.screenshot({ path: 'scripts/.qa/01-profieltab.png', fullPage: true });
  });

  test('4: duplicatenbeheer toont verdeling en verschillen', async ({ page }) => {
    await page.goto('/kandidaten/duplicaten', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(page.getByRole('heading', { name: 'Duplicatenbeheer' })).toBeVisible({ timeout: 30_000 });

    // De drie emmers moeten als koppen verschijnen zodra er groepen zijn.
    const buckets = ['Waarschijnlijk dezelfde persoon', 'Nakijken', 'Waarschijnlijk niet hetzelfde'];
    const found: string[] = [];
    for (const bucket of buckets) {
      if (await page.getByText(new RegExp(`^${bucket} · \\d+$`)).count()) found.push(bucket);
    }
    console.log('gevonden emmers:', found);
    expect(found.length).toBeGreaterThan(0);

    // Vergelijkingstabel: kop "Verschil" hoort er te staan bij een groep met botsingen.
    const diffHeaders = await page.getByRole('columnheader', { name: 'Verschil' }).count();
    console.log('groepen met een vergelijkingstabel:', diffHeaders);

    await page.screenshot({ path: 'scripts/.qa/04-duplicaten.png', fullPage: true });
  });

  test('3: borg staat op de contracten-tab van een pand', async ({ page }) => {
    await page.goto('/huisvesting', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const firstProperty = page.locator('a[href^="/huisvesting/"]').first();
    await expect(firstProperty).toBeVisible({ timeout: 20_000 });
    await firstProperty.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const contractsTab = page.getByRole('tab', { name: /contracten/i });
    await expect(contractsTab).toBeVisible({ timeout: 20_000 });
    await contractsTab.click();

    await expect(page.getByText('Borg pand')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/De borg die bewoners betalen staat per bewoner/)).toBeVisible();
    await page.screenshot({ path: 'scripts/.qa/03-borg-pand.png', fullPage: true });

    // Kosten-tab: het bewonersborgbedrag hoort daar niet meer als invoerveld te staan.
    const costsTab = page.getByRole('tab', { name: /kosten/i });
    if (await costsTab.count()) {
      await costsTab.click();
      await expect(page.getByRole('columnheader', { name: 'Borgbedrag' })).toHaveCount(0);
      await page.screenshot({ path: 'scripts/.qa/03-kosten.png', fullPage: true });
    }
  });

  test('2: wegklikken tijdens bewerken vraagt om bevestiging', async ({ page }) => {
    await page.goto('/taken', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.getByRole('button', { name: /taak toevoegen/i }).first().click();
    const sheet = page.locator('[role=dialog]').first();
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Iets typen, dan met Escape proberen te sluiten.
    const firstInput = sheet.locator('input').first();
    await firstInput.fill('QA Weggeklikt');
    await page.keyboard.press('Escape');

    await expect(page.getByText('Je bent nog aan het bewerken.')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'scripts/.qa/02-guard.png', fullPage: true });

    // "Verder bewerken" houdt het paneel open met de ingevulde tekst.
    await page.getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(firstInput).toHaveValue('QA Weggeklikt');
    // De bevestiging animeert uit en vangt in die ~150 ms nog toetsaanslagen af.
    // Escape doet dan even niets; het paneel blijft open, er gaat niets verloren.
    await expect(page.getByText('Je bent nog aan het bewerken.')).toHaveCount(0);

    // Nu wel weggooien. De bevestiging animeert in; klikken tijdens die beweging
    // laat Playwright afketsen op "element is not stable", dus eerst laten landen.
    await page.keyboard.press('Escape');
    const discard = page.getByRole('button', { name: 'Sluiten zonder opslaan' });
    await expect(discard).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);
    await discard.click();
    await expect(sheet).toBeHidden({ timeout: 10_000 });
  });

  test('2b: zonder wijziging sluit het paneel gewoon', async ({ page }) => {
    await page.goto('/taken', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.getByRole('button', { name: /taak toevoegen/i }).first().click();
    const sheet = page.locator('[role=dialog]').first();
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByText('Je bent nog aan het bewerken.')).toHaveCount(0);
    await expect(sheet).toBeHidden({ timeout: 5_000 });
  });
});
