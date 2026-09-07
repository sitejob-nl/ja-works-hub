import { expect, test } from '@playwright/test';
import { ensureLoggedIn, kiesPaginagrootte } from './e2e-helpers';

// Browser-QA voor het ticket "Sorteerbare kolomkoppen en instelbare paginagrootte op
// Transport": sorteren, paginagrootte wisselen, verversen, en zien dat de keuze staat.
// De uitrol over de andere lijsten staat in qa-tabel-sortering-uitrol-*.spec.ts.

const plates = (page: import('@playwright/test').Page) =>
  page.locator('table tbody tr td:first-child').allInnerTexts();

test.describe('/transport — sortering en paginagrootte', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('sorteert, wisselt paginagrootte en overleeft een refresh', async ({ page }) => {
    await page.goto('/transport');
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Standaard: 10 rijen, oplopend op kenteken.
    await expect(page.locator('table tbody tr')).toHaveCount(10);
    const kenteken = page.getByRole('columnheader', { name: 'Kenteken' });
    await expect(kenteken).toHaveAttribute('aria-sort', 'ascending');

    // Klik op een andere kop → sorteert daarop, kop toont de richting, URL houdt het vast.
    await page.getByRole('button', { name: 'Bouwjaar' }).click();
    await expect(page.getByRole('columnheader', { name: 'Bouwjaar' })).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/sort=year%3Adesc/);
    const jarenDesc = await page.locator('table tbody tr td:nth-child(3)').allInnerTexts();
    const numeriek = jarenDesc.filter((j) => /^\d{4}$/.test(j.trim())).map(Number);
    expect(numeriek).toEqual([...numeriek].sort((a, b) => b - a));

    // Nogmaals klikken draait de richting om.
    await page.getByRole('button', { name: 'Bouwjaar' }).click();
    await expect(page.getByRole('columnheader', { name: 'Bouwjaar' })).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=year%3Aasc/);

    // Sortering geldt over de hele set, niet per pagina: de eerste rij van pagina 2
    // moet ná de laatste rij van pagina 1 komen.
    await page.getByRole('button', { name: 'Bouwjaar' }).click(); // terug naar desc
    const laatsteVanPagina1 = (await page.locator('table tbody tr td:nth-child(3)').allInnerTexts()).at(-1);
    await page.getByLabel('Ga naar de volgende pagina').click();
    await expect(page).toHaveURL(/page=2/);
    const eersteVanPagina2 = (await page.locator('table tbody tr td:nth-child(3)').allInnerTexts())[0];
    if (/^\d{4}$/.test(String(laatsteVanPagina1)) && /^\d{4}$/.test(String(eersteVanPagina2))) {
      expect(Number(eersteVanPagina2)).toBeLessThanOrEqual(Number(laatsteVanPagina1));
    }

    // Paginagrootte wisselen → 50 rijen én terug naar pagina 1.
    // De app scrollt een binnencontainer (window.scrollY blijft 0), dus de voettekst
    // eerst in beeld brengen — anders opent de dropdown verankerd buiten het scherm.
    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await expect(page).not.toHaveURL(/page=/);
    // De lijst haalt opnieuw op na het wisselen; wacht tot de grotere pagina er staat.
    await expect.poll(() => page.locator('table tbody tr').count()).toBeGreaterThan(10);

    const voorRefresh = await plates(page);

    // Verversen: sortering én paginagrootte staan er nog.
    await page.reload();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Bouwjaar' })).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByLabel('Rijen per pagina')).toContainText('50');
    expect(await plates(page)).toEqual(voorRefresh);

    await page.screenshot({ path: 'scripts/.qa-transport-sortering.png', fullPage: false });
  });

  test('zoek- en statusfilter blijven werken naast de sortering', async ({ page }) => {
    await page.goto('/transport?sort=current_mileage%3Adesc&per=20');
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'KM-stand' })).toHaveAttribute('aria-sort', 'descending');

    await page.getByPlaceholder('Zoek op kenteken, merk of model').fill('a');
    await page.waitForTimeout(1200);
    // Sortering overleeft het filteren.
    await expect(page.getByRole('columnheader', { name: 'KM-stand' })).toHaveAttribute('aria-sort', 'descending');
    const km = (await page.locator('table tbody tr td:nth-child(6)').allInnerTexts())
      .map((t) => Number(t.replace(/\D/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0);
    expect(km).toEqual([...km].sort((a, b) => b - a));
  });
});
