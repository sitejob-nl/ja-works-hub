import { expect, test, type Page } from '@playwright/test';
import { ensureLoggedIn, kiesPaginagrootte } from './e2e-helpers';

// Browser-QA voor de uitrol van de tabelbesturing (sorteerbare kolomkoppen + paginagrootte,
// bouwsteen uit #250) over kandidaten (beide tabbladen), opdrachtgevers en contactpersonen.
// Per lijst: default-sortering, klik op een kop (server-side lijsten: ook het `order=`-param
// in de PostgREST-request, inclusief tiebreak), richting omdraaien, sortering over
// paginagrenzen heen, paginagrootte wisselen, verversen, en de bestaande filters náást de
// sortering. Draait tegen de demo-org (DEMO_ORG_* → TEST_EMAIL/TEST_PASSWORD).

// Dezelfde collatie als src/lib/table-sort.ts: accent-ongevoelig, getalbewust.
const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

// Celtekst → eerste regel (badges als "+1" staan op een eigen regel), lege cellen eruit.
const waarden = (cellen: string[]) =>
  cellen.map((c) => c.split('\n')[0].trim()).filter((c) => c && c !== '—');

const gesorteerd = (cellen: string[], richting: 'asc' | 'desc' = 'asc') => {
  const lijst = waarden(cellen);
  const sorted = [...lijst].sort((a, b) => (richting === 'asc' ? collator.compare(a, b) : collator.compare(b, a)));
  return lijst.join('|') === sorted.join('|');
};

// Cellen tonen dd-MM-yyyy.
const nlDatum = (s: string): number | null => {
  const m = s.match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
};
const datumsGesorteerd = (cellen: string[], richting: 'asc' | 'desc') => {
  const ts = cellen.map(nlDatum).filter((t): t is number => t !== null);
  const sorted = [...ts].sort((a, b) => (richting === 'asc' ? a - b : b - a));
  return ts.join() === sorted.join();
};

/** Leest een kolom op kopnaam, zodat de rolafhankelijke checkbox-kolom de index niet verschuift. */
async function kolom(page: Page, kop: string): Promise<string[]> {
  const koppen = await page.locator('table thead th').allInnerTexts();
  const index = koppen.findIndex((k) => k.trim() === kop);
  if (index < 0) throw new Error(`Kolom "${kop}" niet gevonden in ${JSON.stringify(koppen)}`);
  return page.locator(`table tbody tr td:nth-child(${index + 1})`).allInnerTexts();
}

const kopstatus = (page: Page, kop: string) => page.getByRole('columnheader', { name: kop });

/**
 * Klikt een kolomkop. Voor server-gesorteerde lijsten wacht hij op de PostgREST-request
 * en controleert het `order=`-param — dát is het bewijs dat er over de hele set gesorteerd
 * wordt, met tiebreak, en niet over de zichtbare pagina.
 */
async function klikKop(page: Page, kop: string, verwacht?: { tabel: string; order: string }) {
  const knop = page.getByRole('button', { name: kop, exact: true });
  if (!verwacht) {
    await knop.click();
    return;
  }
  const [response] = await Promise.all([
    page.waitForResponse((r) => {
      const url = decodeURIComponent(r.url());
      return url.includes(`/rest/v1/${verwacht.tabel}?`) && url.includes(`order=${verwacht.order}`);
    }),
    knop.click(),
  ]);
  expect(response.ok()).toBeTruthy();
}

/** Volgende pagina, en wachten tot de tweede pagina (offset) echt binnen is. */
async function volgendePagina(page: Page, tabel: string, offset: number) {
  await Promise.all([
    page.waitForResponse((r) => {
      const url = decodeURIComponent(r.url());
      return url.includes(`/rest/v1/${tabel}?`) && url.includes(`offset=${offset}`);
    }),
    page.getByLabel('Ga naar de volgende pagina').click(),
  ]);
}

const rijen = (page: Page) => page.locator('table tbody tr');

test.describe('Tabelbesturing uitrol A — kandidaten, medewerkers, opdrachtgevers, contacten', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('/kandidaten (Alle) — server-side sorteren, paginagrootte en refresh', async ({ page }) => {
    await page.goto('/kandidaten');
    await expect(rijen(page).first()).toBeVisible();
    await expect(rijen(page)).toHaveCount(10);

    // Default: nieuwste eerst, nu zichtbaar én omkeerbaar via de kop 'Toegevoegd'.
    await expect(kopstatus(page, 'Toegevoegd')).toHaveAttribute('aria-sort', 'descending');
    expect(datumsGesorteerd(await kolom(page, 'Toegevoegd'), 'desc')).toBe(true);
    await expect(page).not.toHaveURL(/sort=/);

    // Naam: op achternaam + voornaam, met id als tiebreak. Tweede klik draait om.
    await klikKop(page, 'Naam', { tabel: 'candidates', order: 'last_name.asc.nullslast,first_name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=name%3Aasc/);
    await klikKop(page, 'Naam', { tabel: 'candidates', order: 'last_name.desc.nullslast,first_name.desc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/sort=name%3Adesc/);

    // E-mail: de cel toont het adres zelf, dus de volgorde is controleerbaar.
    await klikKop(page, 'E-mail', { tabel: 'candidates', order: 'email.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'E-mail')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => gesorteerd(await kolom(page, 'E-mail'), 'asc')).toBe(true);

    // Over paginagrenzen heen: pagina 2 sluit aan op pagina 1.
    const laatsteVanPagina1 = waarden(await kolom(page, 'E-mail')).at(-1);
    await volgendePagina(page, 'candidates', 10);
    await expect(page).toHaveURL(/page=2/);
    await expect(kopstatus(page, 'E-mail')).toHaveAttribute('aria-sort', 'ascending');
    const eersteVanPagina2 = waarden(await kolom(page, 'E-mail'))[0];
    if (laatsteVanPagina1 && eersteVanPagina2) {
      expect(collator.compare(laatsteVanPagina1, eersteVanPagina2)).toBeLessThanOrEqual(0);
    }

    // Paginagrootte → 50 rijen én terug naar pagina 1.
    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await expect(page).not.toHaveURL(/page=/);
    await expect.poll(() => rijen(page).count()).toBeGreaterThan(10);
    await expect.poll(async () => gesorteerd(await kolom(page, 'E-mail'), 'asc')).toBe(true);
    const voorRefresh = await kolom(page, 'Naam');

    // Verversen: sortering, paginagrootte en exact dezelfde rijen.
    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'E-mail')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.getByLabel('Rijen per pagina')).toContainText('50');
    await expect.poll(async () => (await kolom(page, 'Naam')).join('|')).toBe(voorRefresh.join('|'));

    await page.screenshot({ path: 'scripts/.qa-kandidaten-sortering.png', fullPage: false });
  });

  test('/kandidaten (Alle) — zoek- en statusfilter werken naast de sortering', async ({ page }) => {
    await page.goto('/kandidaten?sort=name%3Adesc&per=20');
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'descending');
    await expect(rijen(page)).toHaveCount(20);

    // Statusfilter: request draagt filter én sortering; de kop blijft actief.
    await Promise.all([
      page.waitForResponse((r) => {
        const url = decodeURIComponent(r.url());
        return url.includes('/rest/v1/candidates?') && url.includes('status=eq.') && url.includes('order=last_name.desc');
      }),
      (async () => {
        await page.getByRole('combobox').filter({ hasText: 'Alle statussen' }).click();
        await page.getByRole('option', { name: 'Beschikbaar', exact: true }).click();
      })(),
    ]);
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'descending');

    // Zoeken (accent-ongevoelig via search_unaccent) — sortering blijft staan.
    await Promise.all([
      page.waitForResponse((r) => {
        const url = decodeURIComponent(r.url());
        return url.includes('/rest/v1/candidates?') && url.includes('search_unaccent=ilike.') && url.includes('order=last_name.desc');
      }),
      page.getByPlaceholder('Zoek op naam, stad, e-mail of telefoon').fill('a'),
    ]);
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/sort=name%3Adesc/);
  });

  test('/kandidaten?tab=in-dienst (medewerkers) — client-side sorteren over de hele set', async ({ page }) => {
    await page.goto('/kandidaten?tab=in-dienst');
    await expect(rijen(page).first()).toBeVisible();
    const totaal = Number((await page.getByText(/^\d+ in dienst$/).innerText()).replace(/\D/g, ''));
    expect(totaal).toBeGreaterThan(0);
    await expect(rijen(page)).toHaveCount(Math.min(totaal, 10));

    // Default: laatst gestarte plaatsing bovenaan — de volgorde die de lijst altijd al had.
    await expect(kopstatus(page, 'Startdatum')).toHaveAttribute('aria-sort', 'descending');
    expect(datumsGesorteerd(await kolom(page, 'Startdatum'), 'desc')).toBe(true);

    // Alles op één pagina, zodat asc en desc elkaars spiegelbeeld moeten zijn.
    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await expect(rijen(page)).toHaveCount(Math.min(totaal, 50));

    await klikKop(page, 'Naam');
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/tab=in-dienst/);
    await expect(page).toHaveURL(/sort=name%3Aasc/);
    const namenAsc = waarden(await kolom(page, 'Naam'));
    await klikKop(page, 'Naam');
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'descending');
    const namenDesc = waarden(await kolom(page, 'Naam'));
    if (new Set(namenAsc).size === namenAsc.length) {
      expect(namenDesc).toEqual([...namenAsc].reverse());
    }

    // Actieve plaatsing: gejoinde bedrijfsnaam, client-side gesorteerd met de NL-collator.
    await klikKop(page, 'Actieve plaatsing');
    await expect(kopstatus(page, 'Actieve plaatsing')).toHaveAttribute('aria-sort', 'ascending');
    expect(gesorteerd(await kolom(page, 'Actieve plaatsing'), 'asc')).toBe(true);
    const voorRefresh = await kolom(page, 'Naam');

    // Verversen: tabblad, sortering en paginagrootte staan er nog.
    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(page).toHaveURL(/tab=in-dienst/);
    await expect(kopstatus(page, 'Actieve plaatsing')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.getByLabel('Rijen per pagina')).toContainText('50');
    await expect.poll(async () => (await kolom(page, 'Naam')).join('|')).toBe(voorRefresh.join('|'));

    // Zoekfilter werkt naast de sortering (client-side, geen refetch).
    const eersteVoornaam = voorRefresh[0].split(' ')[0];
    await page.getByPlaceholder('Zoek op naam...').fill(eersteVoornaam);
    await expect.poll(async () => waarden(await kolom(page, 'Naam')).every((n) => n.toLowerCase().includes(eersteVoornaam.toLowerCase()))).toBe(true);
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Actieve plaatsing')).toHaveAttribute('aria-sort', 'ascending');

    // Van tabblad wisselen wist sortering en pagina: 'Alle' opent weer op zijn eigen default.
    await page.getByRole('tab', { name: 'Alle kandidaten' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(kopstatus(page, 'Toegevoegd')).toHaveAttribute('aria-sort', 'descending');

    await page.screenshot({ path: 'scripts/.qa-in-dienst-sortering.png', fullPage: false });
  });

  test('/opdrachtgevers — server-side sorteren, paginagrootte en refresh', async ({ page }) => {
    await page.goto('/opdrachtgevers');
    await expect(rijen(page).first()).toBeVisible();
    await expect(rijen(page)).toHaveCount(10);
    await expect(kopstatus(page, 'Bedrijfsnaam')).toHaveAttribute('aria-sort', 'ascending');
    expect(gesorteerd(await kolom(page, 'Bedrijfsnaam'), 'asc')).toBe(true);

    // Stad, met naam + id als tiebreak.
    await klikKop(page, 'Stad', { tabel: 'companies', order: 'address_city.asc.nullslast,name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Stad')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=address_city%3Aasc/);
    await expect.poll(async () => gesorteerd(await kolom(page, 'Stad'), 'asc')).toBe(true);

    // Over paginagrenzen heen.
    const laatsteStad = waarden(await kolom(page, 'Stad')).at(-1);
    await volgendePagina(page, 'companies', 10);
    await expect(page).toHaveURL(/page=2/);
    const eersteStad = waarden(await kolom(page, 'Stad'))[0];
    if (laatsteStad && eersteStad) {
      expect(collator.compare(laatsteStad, eersteStad)).toBeLessThanOrEqual(0);
    }

    // Status: eerste klik zet actieve opdrachtgevers bovenaan.
    await klikKop(page, 'Status', { tabel: 'companies', order: 'is_active.desc.nullslast,name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Status')).toHaveAttribute('aria-sort', 'descending');
    await expect(page).not.toHaveURL(/page=/);
    await expect.poll(async () => {
      const statussen = waarden(await kolom(page, 'Status'));
      const eersteInactief = statussen.indexOf('Inactief');
      return eersteInactief === -1 || statussen.slice(eersteInactief).every((s) => s === 'Inactief');
    }).toBe(true);

    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await expect.poll(() => rijen(page).count()).toBeGreaterThan(10);
    const voorRefresh = await kolom(page, 'Bedrijfsnaam');

    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Status')).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByLabel('Rijen per pagina')).toContainText('50');
    await expect.poll(async () => (await kolom(page, 'Bedrijfsnaam')).join('|')).toBe(voorRefresh.join('|'));

    await page.screenshot({ path: 'scripts/.qa-opdrachtgevers-sortering.png', fullPage: false });
  });

  test('/opdrachtgevers — status- en zoekfilter werken naast de sortering', async ({ page }) => {
    await page.goto('/opdrachtgevers?sort=address_city%3Adesc');
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Stad')).toHaveAttribute('aria-sort', 'descending');

    // 'Actief' i.p.v. 'Inactief': de demo-org heeft geen inactieve opdrachtgevers, en de
    // lijst toont bij nul resultaten de lege staat zonder tabelkoppen.
    await Promise.all([
      page.waitForResponse((r) => {
        const url = decodeURIComponent(r.url());
        return url.includes('/rest/v1/companies?') && url.includes('is_active=eq.true') && url.includes('order=address_city.desc');
      }),
      (async () => {
        await page.getByRole('combobox').filter({ hasText: 'Alle' }).first().click();
        await page.getByRole('option', { name: 'Actief', exact: true }).click();
      })(),
    ]);
    await expect(kopstatus(page, 'Stad')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => waarden(await kolom(page, 'Status')).every((s) => s === 'Actief')).toBe(true);

    await Promise.all([
      page.waitForResponse((r) => {
        const url = decodeURIComponent(r.url());
        return url.includes('/rest/v1/companies?') && url.includes('name.ilike.') && url.includes('order=address_city.desc');
      }),
      page.getByPlaceholder('Zoek op naam of stad').fill('e'),
    ]);
    await expect(kopstatus(page, 'Stad')).toHaveAttribute('aria-sort', 'descending');
  });

  test('/contacten — sorteren op gejoind bedrijf, paginagrootte 20 → 10 en refresh', async ({ page }) => {
    await page.goto('/contacten');
    await expect(rijen(page).first()).toBeVisible();
    const totaal = Number((await page.getByText(/^\d+ contactpersonen$/).innerText()).replace(/\D/g, ''));
    expect(totaal).toBeGreaterThan(10);

    // Deze lijst stond al op 20 rijen; dat is de default gebleven.
    await expect(page.getByLabel('Rijen per pagina')).toContainText('20');
    await expect(rijen(page)).toHaveCount(Math.min(totaal, 20));
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'ascending');
    expect(gesorteerd(await kolom(page, 'Naam'), 'asc')).toBe(true);

    // Bedrijf is een to-one embed: PostgREST ordent de contacten op companies(name).
    await klikKop(page, 'Bedrijf', { tabel: 'company_contacts', order: 'companies(name).asc.nullslast,full_name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Bedrijf')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=company%3Aasc/);
    await expect.poll(async () => gesorteerd(await kolom(page, 'Bedrijf'), 'asc')).toBe(true);
    await klikKop(page, 'Bedrijf', { tabel: 'company_contacts', order: 'companies(name).desc.nullslast,full_name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Bedrijf')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Bedrijf'), 'desc')).toBe(true);

    // Primair: eerste klik zet de primaire contacten bovenaan.
    await klikKop(page, 'Primair', { tabel: 'company_contacts', order: 'is_primary.desc.nullslast,full_name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Primair')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => {
      const cellen = (await kolom(page, 'Primair')).map((c) => c.trim());
      const eersteLeeg = cellen.indexOf('');
      return eersteLeeg === -1 || cellen.slice(eersteLeeg).every((c) => c === '');
    }).toBe(true);

    // Paginagrootte omlaag naar 10 → twee pagina's; pagina 2 heeft de rest.
    await kiesPaginagrootte(page, '10');
    await expect(page).toHaveURL(/per=10/);
    await expect.poll(() => rijen(page).count()).toBe(10);
    await volgendePagina(page, 'company_contacts', 10);
    await expect(page).toHaveURL(/page=2/);
    await expect.poll(() => rijen(page).count()).toBe(Math.min(totaal - 10, 10));
    const voorRefresh = await kolom(page, 'Naam');

    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Primair')).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByLabel('Rijen per pagina')).toContainText('10');
    await expect(page).toHaveURL(/page=2/);
    await expect.poll(async () => (await kolom(page, 'Naam')).join('|')).toBe(voorRefresh.join('|'));

    // Zoekfilter: reset naar pagina 1, sortering blijft.
    await Promise.all([
      page.waitForResponse((r) => {
        const url = decodeURIComponent(r.url());
        return url.includes('/rest/v1/company_contacts?') && url.includes('full_name.ilike.') && url.includes('order=is_primary.desc');
      }),
      page.getByPlaceholder('Zoek op naam, e-mail of functie').fill('a'),
    ]);
    await expect(page).not.toHaveURL(/page=/);
    await expect(kopstatus(page, 'Primair')).toHaveAttribute('aria-sort', 'descending');

    await page.screenshot({ path: 'scripts/.qa-contacten-sortering.png', fullPage: false });
  });
});
