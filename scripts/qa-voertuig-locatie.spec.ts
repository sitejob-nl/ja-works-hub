import { expect, test } from '@playwright/test';
import { ensureLoggedIn } from './e2e-helpers';

/**
 * Browser-QA voor "Laatste bekende locatie van een auto": vastleggen, wijzigen, wissen,
 * en sorteren op de nieuwe kolom in het transportoverzicht.
 *
 * Draait tegen de demo-org (DEMO_ORG_* uit .env.local, via scripts/run-qa-*.sh). De test
 * eindigt met wissen, zodat het voertuig achterblijft zoals hij begon.
 */
const LOCATIE = 'QA Parkeerterrein Mierlo';
const LOCATIE_GEWIJZIGD = 'QA Garage Van Dijk';

/** Kolomindex (1-gebaseerd) van een kop, zodat de test niet op een vaste positie leunt. */
async function kolomIndex(page: import('@playwright/test').Page, naam: string): Promise<number> {
  const koppen = await page.locator('table thead th').allInnerTexts();
  const index = koppen.findIndex((kop) => kop.trim().startsWith(naam));
  expect(index, `kolom "${naam}" niet gevonden in ${JSON.stringify(koppen)}`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

test.describe('voertuig — laatste bekende locatie', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('vastleggen, wijzigen, wissen en sorteren', async ({ page }) => {
    await page.goto('/transport');
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    const kenteken = (await page.locator('table tbody tr td:first-child').first().innerText()).trim();
    await page.locator('table tbody tr td:first-child a').first().click();
    await expect(page.getByRole('heading', { name: kenteken })).toBeVisible();

    // De kaart-teksten zijn uniek genoeg om op paginaniveau te toetsen; de dialoog draagt
    // dezelfde titel, dus het invoerveld pakken we expliciet als textbox.
    await expect(page.getByText('Laatste bekende locatie').first()).toBeVisible();
    const locatieVeld = page.getByRole('textbox', { name: 'Locatie' });

    // 1. Vastleggen.
    await page.getByRole('button', { name: /Vastleggen|Bijwerken/ }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
    await locatieVeld.fill(LOCATIE);
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByText('Locatie bijgewerkt')).toBeVisible();
    await expect(page.getByText(LOCATIE, { exact: true })).toBeVisible();
    // Wie + wanneer staan erbij, en dat is een échte datum (geen "Invalid Date").
    await expect(page.getByText(/^Bijgewerkt: .+ · \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)).toBeVisible();

    // 2. Wijzigen.
    await page.getByRole('button', { name: 'Bijwerken' }).click();
    await expect(locatieVeld).toHaveValue(LOCATIE);
    await locatieVeld.fill(LOCATIE_GEWIJZIGD);
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByText('Locatie bijgewerkt')).toBeVisible();
    await expect(page.getByText(LOCATIE_GEWIJZIGD, { exact: true })).toBeVisible();

    // 3. Zichtbaar in het overzicht, mét datum.
    await page.goto('/transport');
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    const locatieKolom = await kolomIndex(page, 'Laatste locatie');
    await page.getByPlaceholder('Zoek op kenteken, merk of model').fill(kenteken);
    await expect
      .poll(async () => (await page.locator('table tbody tr td:first-child').allInnerTexts()).length)
      .toBeGreaterThan(0);
    const cel = page.locator(`table tbody tr td:nth-child(${locatieKolom})`).first();
    await expect(cel).toContainText(LOCATIE_GEWIJZIGD);
    await expect(cel).toContainText(/\d{2}-\d{2}-\d{4}/);

    // 4. Sorteren op de nieuwe kolom; lege waarden horen achteraan te staan — in beide
    //    richtingen, anders levert "sorteer aflopend" een pagina vol streepjes op.
    await page.getByPlaceholder('Zoek op kenteken, merk of model').fill('');
    await expect.poll(() => page.locator('table tbody tr').count()).toBeGreaterThan(1);
    const eersteLocatie = async () =>
      (await page.locator(`table tbody tr td:nth-child(${locatieKolom})`).allInnerTexts())[0]?.trim();

    await page.getByRole('button', { name: 'Laatste locatie' }).click();
    await expect(page.getByRole('columnheader', { name: 'Laatste locatie' })).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=last_known_location%3Aasc/);
    await expect.poll(eersteLocatie).toContain(LOCATIE_GEWIJZIGD);

    await page.getByRole('button', { name: 'Laatste locatie' }).click();
    await expect(page.getByRole('columnheader', { name: 'Laatste locatie' })).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/sort=last_known_location%3Adesc/);
    await expect.poll(eersteLocatie).toContain(LOCATIE_GEWIJZIGD);

    await page.screenshot({ path: 'scripts/.qa-voertuig-locatie-lijst.png' });

    // 5. Wissen — leeg is een geldige staat: geen datum, geen lege badge.
    await page.goto('/transport');
    await page.getByPlaceholder('Zoek op kenteken, merk of model').fill(kenteken);
    await page.locator('table tbody tr td:first-child a').first().click();
    await expect(page.getByRole('heading', { name: kenteken })).toBeVisible();
    await page.getByRole('button', { name: 'Bijwerken' }).click();
    await page.getByRole('textbox', { name: 'Locatie' }).fill('');
    await expect(page.getByText('Leeg opslaan wist de locatie, de datum en de naam.')).toBeVisible();
    await page.getByRole('button', { name: 'Wissen' }).click();
    await expect(page.getByText('Locatie gewist')).toBeVisible();
    await expect(page.getByText(/Nog niet vastgelegd/)).toBeVisible();
    await expect(page.getByText(LOCATIE_GEWIJZIGD)).toHaveCount(0);

    await page.goto('/transport');
    await page.getByPlaceholder('Zoek op kenteken, merk of model').fill(kenteken);
    await expect
      .poll(async () => (await page.locator(`table tbody tr td:nth-child(${locatieKolom})`).allInnerTexts())[0]?.trim())
      .toBe('—');
  });
});
