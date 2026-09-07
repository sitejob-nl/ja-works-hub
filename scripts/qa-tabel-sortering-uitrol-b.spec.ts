import { expect, test, type Page } from '@playwright/test';
import { ensureLoggedIn, kiesPaginagrootte } from './e2e-helpers';

// Browser-QA voor uitrol B van de tabelbesturing (sorteerbare kolomkoppen + paginagrootte,
// bouwsteen uit #250): vacatures, plaatsingen, uren, planning en talentpools, plus de twee
// overgebleven lijsten met een vaste paginagrootte (communicatie en vacaturebank).
// Per lijst: default-sortering, klik op een kop (server-side lijsten: ook het `order=`-param
// in de PostgREST-request, inclusief tiebreak), richting omdraaien, paginagrootte wisselen,
// verversen, en een filter zetten terwijl je op pagina 2 staat. Draait tegen de demo-org
// (DEMO_ORG_* → TEST_EMAIL/TEST_PASSWORD).

// Dezelfde collatie als src/lib/table-sort.ts: accent-ongevoelig, getalbewust.
const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

// Celtekst → eerste regel (badges staan op een eigen regel), lege cellen eruit.
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

/** Leest een kolom op kopnaam, zodat een rolafhankelijke kolom de index niet verschuift. */
async function kolom(page: Page, kop: string): Promise<string[]> {
  const koppen = await page.locator('table thead th').allInnerTexts();
  const index = koppen.findIndex((k) => k.trim() === kop);
  if (index < 0) throw new Error(`Kolom "${kop}" niet gevonden in ${JSON.stringify(koppen)}`);
  return page.locator(`table tbody tr td:nth-child(${index + 1})`).allInnerTexts();
}

// `exact` is nodig: de selectiekolom op /uren heet "Selecteer alle urenregistraties" en die
// zou anders óók op de kop 'Uren' matchen.
const kopstatus = (page: Page, kop: string) => page.getByRole('columnheader', { name: kop, exact: true });

/**
 * Klikt een kolomkop. Voor server-gesorteerde lijsten wacht hij op de PostgREST-request en
 * controleert het `order=`-param — dát is het bewijs dat er over de hele set gesorteerd wordt,
 * met tiebreak, en niet over de zichtbare pagina.
 */
async function klikKop(page: Page, kop: string, verwacht?: { tabel: string; order: string }) {
  const knop = page.getByRole('button', { name: kop, exact: true });
  if (verwacht) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => {
        const url = decodeURIComponent(r.url());
        return url.includes(`/rest/v1/${verwacht.tabel}?`) && url.includes(`order=${verwacht.order}`);
      }),
      knop.click(),
    ]);
    expect(response.ok()).toBeTruthy();
  } else {
    await knop.click();
  }
  // Server-gesorteerde lijsten vervangen de tabel tijdens het laden door een spinner; wacht tot
  // de rijen er weer staan, anders leest de volgende kolomcheck een lege tabel.
  await expect(rijen(page).first()).toBeVisible();
}

const rijen = (page: Page) => page.locator('table tbody tr');

test.describe('Tabelbesturing uitrol B — vacatures, plaatsingen, uren, planning, talentpools', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('/vacatures — server-side sorteren, paginagrootte, refresh en statusfilter op pagina 2', async ({ page }) => {
    await page.goto('/vacatures');
    await expect(rijen(page).first()).toBeVisible();
    await expect(rijen(page)).toHaveCount(10);

    // Default: hoogste urgentie bovenaan (met start_date als tweede sleutel), nu zichtbaar.
    await expect(kopstatus(page, 'Urgentie')).toHaveAttribute('aria-sort', 'descending');
    await expect(page).not.toHaveURL(/sort=/);

    // Titel: tiebreak start_date + id gaat mee in het order-param.
    await klikKop(page, 'Titel', { tabel: 'vacancies', order: 'title.asc.nullslast,start_date.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Titel')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=title%3Aasc/);
    await expect.poll(async () => gesorteerd(await kolom(page, 'Titel'), 'asc')).toBe(true);

    await klikKop(page, 'Titel', { tabel: 'vacancies', order: 'title.desc.nullslast,start_date.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Titel')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Titel'), 'desc')).toBe(true);

    // Opdrachtgever is een to-one embed; PostgREST ordent de vacatures zelf op companies(name).
    await klikKop(page, 'Opdrachtgever', {
      tabel: 'vacancies',
      order: 'companies(name).asc.nullslast,start_date.asc.nullslast,id.asc',
    });
    await expect.poll(async () => gesorteerd(await kolom(page, 'Opdrachtgever'), 'asc')).toBe(true);

    // Over de paginagrens heen: pagina 2 sluit aan op pagina 1.
    const laatsteVanPagina1 = waarden(await kolom(page, 'Opdrachtgever')).at(-1);
    await page.getByLabel('Ga naar de volgende pagina').click();
    await expect(page).toHaveURL(/page=2/);
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Opdrachtgever')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => {
      const eerste = waarden(await kolom(page, 'Opdrachtgever'))[0];
      return !laatsteVanPagina1 || !eerste || collator.compare(laatsteVanPagina1, eerste) <= 0;
    }).toBe(true);

    // Statusfilter zetten terwijl je op pagina 2 staat: filter én paginateller in één update.
    await page.getByRole('combobox').filter({ hasText: /Open|Alle statussen/ }).first().click();
    await page.getByRole('option', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/status=open/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(rijen(page).first()).toBeVisible();

    // Paginagrootte → 50 rijen, en die keuze overleeft een refresh.
    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(page).toHaveURL(/per=50/);
    await expect(page).toHaveURL(/status=open/);
    await expect(kopstatus(page, 'Opdrachtgever')).toHaveAttribute('aria-sort', 'ascending');
  });

  test('/plaatsingen — client-side sorteren over de hele set, paginagrootte en filter op pagina 2', async ({ page }) => {
    await page.goto('/plaatsingen');
    await expect(rijen(page).first()).toBeVisible();

    // Default: laatst gestarte plaatsing bovenaan, zichtbaar op de kop 'Periode'.
    await expect(kopstatus(page, 'Periode')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => datumsGesorteerd(await kolom(page, 'Periode'), 'desc')).toBe(true);

    await klikKop(page, 'Opdrachtgever');
    await expect(kopstatus(page, 'Opdrachtgever')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Opdrachtgever'), 'asc')).toBe(true);
    await expect(page).toHaveURL(/sort=company%3Aasc/);

    await klikKop(page, 'Opdrachtgever');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Opdrachtgever'), 'desc')).toBe(true);

    // Statusfilter zetten vanaf pagina 2 — het filter mag niet verloren gaan.
    await page.goto('/plaatsingen?page=2');
    await expect(rijen(page).first()).toBeVisible();
    await page.getByRole('combobox').filter({ hasText: /Alle statussen/ }).first().click();
    await page.getByRole('option', { name: 'Actief', exact: true }).click();
    await expect(page).toHaveURL(/status=actief/);
    await expect(page).not.toHaveURL(/page=/);

    // Paginagrootte → 50 en refresh.
    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(page).toHaveURL(/per=50/);
    await expect(page).toHaveURL(/status=actief/);
  });

  test('/uren — sorteren op de gejoinde medewerker, paginagrootte en filter op pagina 2', async ({ page }) => {
    await page.goto('/uren');
    await expect(page.getByRole('heading', { name: 'Uren' })).toBeVisible();

    // De week staat in component-state, niet in de URL: terugbladeren tot een week met genoeg
    // uren voor meer dan één pagina. De rijen op het scherm zijn er hooguit `pageSize`, dus
    // kijk naar de teller "N registraties" naast de filters.
    const totaalRegistraties = async () => {
      const tekst = await page.getByText(/\d+ registraties/).first().innerText();
      return Number(tekst.match(/(\d+)/)?.[1] ?? 0);
    };
    for (let i = 0; i < 30 && (await totaalRegistraties()) <= 20; i += 1) {
      await page.getByLabel('Vorige week').click();
      await page.waitForTimeout(300);
    }
    await expect(rijen(page).first()).toBeVisible();
    expect(await totaalRegistraties()).toBeGreaterThan(20);

    await expect(kopstatus(page, 'Datum')).toHaveAttribute('aria-sort', 'descending');

    // Medewerker is een to-one embed op candidates; hier blijkt of PostgREST daar op ordent.
    await klikKop(page, 'Medewerker', {
      tabel: 'timesheets',
      order: 'candidates(last_name).asc.nullslast,candidates(first_name).asc.nullslast,id.asc',
    });
    await expect(kopstatus(page, 'Medewerker')).toHaveAttribute('aria-sort', 'ascending');
    // Geen check op de zichtbare celtekst: die toont "Voornaam Achternaam" terwijl er — net als
    // op /kandidaten — op achternaam + voornaam wordt geordend. Het order-param hierboven is
    // het bewijs; dat de kolom dan niet alfabetisch op voornaam staat, klopt.

    await klikKop(page, 'Uren', { tabel: 'timesheets', order: 'hours.desc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Uren')).toHaveAttribute('aria-sort', 'descending');

    // Statusfilter vanaf pagina 2.
    await page.getByLabel('Ga naar de volgende pagina').click();
    await expect(page).toHaveURL(/page=2/);
    await page.getByRole('combobox').filter({ hasText: /Alle statussen/ }).first().click();
    await page.getByRole('option', { name: 'Concept', exact: true }).click();
    await expect(page).toHaveURL(/status=concept/);
    await expect(page).not.toHaveURL(/page=/);

    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
  });

  test('/planning — lijstoverzicht sorteert en pagineert; kalender blijft een weekraster', async ({ page }) => {
    await page.goto('/planning');
    await page.getByRole('button', { name: 'Lijst' }).click();
    await expect(rijen(page).first()).toBeVisible();

    // Default op medewerkersnaam, net als het kalenderoverzicht.
    await expect(kopstatus(page, 'Medewerker')).toHaveAttribute('aria-sort', 'ascending');

    await klikKop(page, 'Opdrachtgever');
    await expect(kopstatus(page, 'Opdrachtgever')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Opdrachtgever'), 'asc')).toBe(true);
    await expect(page).toHaveURL(/sort=company%3Aasc/);

    await klikKop(page, 'Start');
    await expect.poll(async () => datumsGesorteerd(await kolom(page, 'Start'), 'asc')).toBe(true);

    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await page.reload();
    await page.getByRole('button', { name: 'Lijst' }).click();
    await expect(rijen(page).first()).toBeVisible();
    await expect(kopstatus(page, 'Start')).toHaveAttribute('aria-sort', 'ascending');

    // Het kalenderoverzicht heeft dagkolommen en géén tabelbesturing.
    await page.getByRole('button', { name: 'Kalender' }).click();
    await expect(page.getByRole('columnheader', { name: 'Medewerker' })).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Medewerker' })).not.toHaveAttribute('aria-sort', /.*/);
  });

  test('/talentpools — server-side sorteren en paginagrootte', async ({ page }) => {
    await page.goto('/talentpools');
    await expect(rijen(page).first()).toBeVisible();

    // Default: nieuwste pool bovenaan, nu zichtbaar op de nieuwe kop 'Aangemaakt'.
    await expect(kopstatus(page, 'Aangemaakt')).toHaveAttribute('aria-sort', 'descending');
    await expect(page).not.toHaveURL(/sort=/);

    await klikKop(page, 'Naam', { tabel: 'talentpools', order: 'name.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Naam')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=name%3Aasc/);

    await klikKop(page, 'Laatst ververst', {
      tabel: 'talentpools',
      order: 'last_refreshed_at.desc.nullslast,name.asc.nullslast,id.asc',
    });
    await expect(kopstatus(page, 'Laatst ververst')).toHaveAttribute('aria-sort', 'descending');

    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
    await page.reload();
    await expect(rijen(page).first()).toBeVisible();
    await expect(page).toHaveURL(/per=50/);
    await expect(kopstatus(page, 'Laatst ververst')).toHaveAttribute('aria-sort', 'descending');
  });

  test('/communicatie — de laatste twee lijsten met een vaste paginagrootte, deel 1', async ({ page }) => {
    await page.goto('/communicatie');
    await expect(rijen(page).first()).toBeVisible();

    await expect(kopstatus(page, 'Datum/tijd')).toHaveAttribute('aria-sort', 'descending');

    await klikKop(page, 'Onderwerp', { tabel: 'communications', order: 'subject.asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Onderwerp')).toHaveAttribute('aria-sort', 'ascending');

    // Verzender is een to-one embed op profiles.
    await klikKop(page, 'Verzender', { tabel: 'communications', order: 'profiles(full_name).asc.nullslast,id.asc' });
    await expect(kopstatus(page, 'Verzender')).toHaveAttribute('aria-sort', 'ascending');

    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
  });

  test('/vacaturebank — de laatste twee lijsten met een vaste paginagrootte, deel 2', async ({ page }) => {
    await page.goto('/vacaturebank');
    await expect(rijen(page).first()).toBeVisible();

    await expect(kopstatus(page, 'Datum')).toHaveAttribute('aria-sort', 'descending');

    await klikKop(page, 'Titel');
    await expect(kopstatus(page, 'Titel')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Titel'), 'asc')).toBe(true);

    await klikKop(page, 'Locatie');
    await expect.poll(async () => gesorteerd(await kolom(page, 'Locatie'), 'asc')).toBe(true);

    await kiesPaginagrootte(page, '50');
    await expect(page).toHaveURL(/per=50/);
  });
});
