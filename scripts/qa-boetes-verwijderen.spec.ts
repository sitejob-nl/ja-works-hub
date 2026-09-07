import { expect, test, type Page } from '@playwright/test';
import { ensureLoggedIn } from './e2e-helpers';

// Browser-QA voor het ticket "Boete verwijderen, en betaalstatus achter een bevestiging":
// op het transportoverzicht én op het boetes-tabblad van een voertuig moet de betaalstatus
// pas na bevestiging wisselen, en verwijderen moet een bevestiging met kenteken, bedrag en
// datum tonen. Draait tegen de demo-org (voertuig DEMO-01) en ruimt zijn eigen boetes op.

const DEMO_VEHICLE_ID = 'b4415abe-29a4-4802-937a-6491dd9e7798'; // DEMO-01 in de demo-org
const DEMO_PLATE = 'DEMO-01';
const RUN = Date.now().toString(36).toUpperCase();
const REF_VOERTUIG = `QA-BOETE-${RUN}-A`;
const REF_OVERZICHT = `QA-BOETE-${RUN}-B`;
const BEDRAG = '42.50';
const BEDRAG_NL = '42,50';
const SHOTS = process.env.QA_SCREENSHOT_DIR ?? 'scripts';

const vandaag = () => new Date().toISOString().slice(0, 10);
const vandaagNl = () => vandaag().split('-').reverse().join('-');

// 1×1 transparante PNG — de boete-sheet eist minimaal één foto of scan.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function openBoetesTab(page: Page) {
  await page.goto(`/transport/${DEMO_VEHICLE_ID}`);
  await page.getByRole('tab', { name: 'Boetes' }).click();
  await expect(page.getByRole('button', { name: 'Nieuwe boete' })).toBeVisible();
}

/** Registreert een boete via het voertuig-tabblad, zoals een gebruiker dat doet. */
async function registreerBoete(page: Page, referentie: string) {
  await page.getByRole('button', { name: 'Nieuwe boete' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Nieuwe boete')).toBeVisible();
  await sheet.locator('input[type="date"]').first().fill(vandaag());
  await sheet.locator('input[type="number"]').fill(BEDRAG);
  await sheet.locator('label:has-text("Beschrijving") + input').fill('QA-boete, wordt weer verwijderd');
  await sheet.locator('label:has-text("Referentienummer") + input').fill(referentie);
  await sheet.locator('input[type="file"]').setInputFiles({ name: 'boete.png', mimeType: 'image/png', buffer: PNG_1PX });
  await sheet.getByRole('button', { name: 'Opslaan' }).click();
  await expect(page.locator('table tbody tr', { hasText: referentie })).toBeVisible();
}

/** Bevestigingsdialoog met de drie feiten waaraan je de boete herkent. */
async function verwachtBoeteDialoog(page: Page, titel: string, referentieVoorScreenshot: string) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(titel);
  await expect(dialog).toContainText(DEMO_PLATE);
  await expect(dialog).toContainText(BEDRAG_NL);
  await expect(dialog).toContainText(vandaagNl());
  await dialog.screenshot({ path: `${SHOTS}/.qa-boetes-${referentieVoorScreenshot}.png` });
  return dialog;
}

test.describe('Boetes — verwijderen en betaalstatus achter een bevestiging', () => {
  // De nieuwe-boete-sheet op het voertuig-tabblad scrolt niet (geen overflow-y-auto, anders dan de
  // bewerk-sheet op het overzicht); op 900px valt "Opslaan" buiten beeld. Bestaand, buiten dit ticket.
  test.use({ viewport: { width: 1400, height: 1500 } });

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('voertuig-tabblad: betaalstatus wisselt pas na bevestiging, verwijderen toont kenteken/bedrag/datum', async ({ page }) => {
    await openBoetesTab(page);
    await registreerBoete(page, REF_VOERTUIG);
    const rij = page.locator('table tbody tr', { hasText: REF_VOERTUIG });

    // Klik op de badge: niets verspringt, er komt eerst een bevestiging.
    await rij.getByText('Niet betaald').click();
    let dialog = await verwachtBoeteDialoog(page, 'Markeren als betaald?', 'voertuig-betaald');
    await expect(rij.getByText('Niet betaald')).toBeVisible();

    // Annuleren laat de status staan.
    await dialog.getByRole('button', { name: 'Annuleren' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(rij.getByText('Niet betaald')).toBeVisible();

    // Bevestigen zet hem op betaald; de lijst is bijgewerkt.
    await rij.getByText('Niet betaald').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Markeren als betaald' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(rij.getByText('Betaald', { exact: true })).toBeVisible();

    // En weer terug — met de melding dat de betaaldatum wordt gewist.
    await rij.getByText('Betaald', { exact: true }).click();
    dialog = await verwachtBoeteDialoog(page, 'Markeren als niet betaald?', 'voertuig-niet-betaald');
    await expect(dialog).toContainText('de betaaldatum wordt gewist');
    await dialog.getByRole('button', { name: 'Markeren als niet betaald' }).click();
    await expect(rij.getByText('Niet betaald')).toBeVisible();

    // Verwijderen via het rijmenu, zoals het al werkte — nu via de gedeelde dialoog.
    await rij.locator('button').last().click();
    await page.getByRole('menuitem', { name: 'Verwijderen' }).click();
    dialog = await verwachtBoeteDialoog(page, 'Boete verwijderen?', 'voertuig-verwijderen');
    await expect(dialog).toContainText('inclusief 1 bijlage');
    await dialog.getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(rij).toHaveCount(0);
  });

  test('transportoverzicht: betaalstatus achter bevestiging en verwijderen met bevestiging', async ({ page }) => {
    await openBoetesTab(page);
    await registreerBoete(page, REF_OVERZICHT);

    await page.goto('/transport');
    await page.getByRole('tab', { name: 'Boetes' }).click();
    await page.getByPlaceholder('Zoek op kenteken, persoon, referentie...').fill(REF_OVERZICHT);
    const rij = page.locator('table tbody tr', { hasText: REF_OVERZICHT });
    await expect(rij).toBeVisible();

    // Betaalstatus: eerst bevestigen.
    await rij.getByText('Niet betaald').click();
    let dialog = await verwachtBoeteDialoog(page, 'Markeren als betaald?', 'overzicht-betaald');
    await expect(rij.getByText('Niet betaald')).toBeVisible();
    await dialog.getByRole('button', { name: 'Markeren als betaald' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();

    // Het overzicht opent op "Openstaand": de betaalde boete verdwijnt daar en staat onder "Alle boetes".
    await expect(rij).toHaveCount(0);
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Alle boetes' }).click();
    await expect(rij).toBeVisible();
    await expect(rij.getByText('Betaald', { exact: true })).toBeVisible();

    // Verwijderen vanaf het overzicht — de actie die er ontbrak.
    await rij.getByRole('button', { name: 'Verwijderen' }).click();
    dialog = await verwachtBoeteDialoog(page, 'Boete verwijderen?', 'overzicht-verwijderen');
    await expect(dialog).toContainText('inclusief 1 bijlage');
    await dialog.getByRole('button', { name: 'Annuleren' }).click();
    await expect(rij).toBeVisible();

    await rij.getByRole('button', { name: 'Verwijderen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(rij).toHaveCount(0);
  });
});
