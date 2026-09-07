import { expect, test, type Page } from '@playwright/test';
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from './e2e-helpers';

/**
 * Browser-QA voor "auto-toewijzing beëindigen en verwijderen vanuit de medewerker".
 *
 * Draait tegen de dev-server van de worktree met het demo-org account (DEMO_ORG_*).
 * Maakt een eigen QA-voertuig en -kandidaat aan zodat de geseede demo-data ongemoeid
 * blijft, en ruimt die na afloop weer op. Controleert naast het scherm ook de
 * database (voertuigstatus, kilometerstand, auditregels) via de REST-API met de
 * sessie van de ingelogde gebruiker.
 */
process.env.TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.DEMO_ORG_EMAIL;
process.env.TEST_PASSWORD = process.env.TEST_PASSWORD ?? process.env.DEMO_ORG_PASSWORD;

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

async function authHeaders(page: Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error('Geen access token beschikbaar');
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function rest<T>(page: Page, method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown): Promise<T> {
  const res = await page.request[method](`${SUPABASE_URL}/rest/v1/${path}`, { headers: await authHeaders(page), data });
  expect(res.ok(), `${method.toUpperCase()} ${path} faalde: ${await res.text()}`).toBeTruthy();
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const vehicleRow = (page: Page, id: string) =>
  rest<Array<{ status: string; current_mileage: number | null }>>(page, 'get', `vehicles?select=status,current_mileage&id=eq.${id}`).then((r) => r[0]);

const assignmentsFor = (page: Page, candidateId: string) =>
  rest<Array<{ id: string; returned_date: string | null; end_mileage: number | null }>>(
    page, 'get', `vehicle_assignments?select=id,returned_date,end_mileage&candidate_id=eq.${candidateId}&order=created_at.desc`,
  );

const auditFor = (page: Page, recordId: string) =>
  rest<Array<{ action: string; old_values: any; new_values: any; reason: string | null }>>(
    page, 'get', `audit_log?select=action,old_values,new_values,reason&table_name=eq.vehicle_assignments&record_id=eq.${recordId}&order=created_at.asc`,
  );

/**
 * Wijs het QA-voertuig toe vanaf het medewerkersdossier (tab Vervoer).
 * De labels in de toewijs-sheet hangen niet via htmlFor aan hun input, dus de velden
 * worden op type gezocht in plaats van op label.
 */
async function assignFromEmployee(page: Page, plate: string) {
  await expect(page.getByText('Geen voertuig toegewezen')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  const sheet = page.getByRole('dialog');
  // Het dossier kan vlak na het laden nog een keer hermounten; een klik van vóór die
  // hermount verliest dan zijn sheet-state. Daarom kort wachten en zo nodig nog eens klikken.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Voertuig toewijzen' }).click();
    if (await sheet.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) break;
    await page.waitForTimeout(1000);
  }
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Voertuig toewijzen' })).toBeVisible();
  await sheet.locator('input[type="date"]').first().fill(todayISO());
  await sheet.getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(plate) }).click();
  await sheet.getByRole('button', { name: 'Toewijzen', exact: true }).click();
  await expect(page.getByText('Voertuig toegewezen').first()).toBeVisible();
  await expect(sheet).toBeHidden();
}

test.describe('Vervoer-tab medewerker — inleveren en verwijderen', () => {
  test('toewijzen, inleveren en verwijderen vanaf de medewerker; voertuigkant blijft gelijk', async ({ page }) => {
    test.setTimeout(240_000);
    await ensureLoggedIn(page);
    const orgId = process.env.DEMO_ORG_ID;
    if (!orgId) test.skip(true, 'DEMO_ORG_ID ontbreekt');

    const stamp = Date.now().toString(36).toUpperCase().slice(-5);
    const plate = `QA-${stamp}`;
    let vehicleId: string | null = null;
    let candidateId: string | null = null;

    try {
      await test.step('QA-voertuig en -kandidaat aanmaken', async () => {
        const [vehicle] = await rest<Array<{ id: string }>>(page, 'post', 'vehicles', {
          organization_id: orgId, license_plate: plate, brand: 'QA', model: 'Toewijzing', status: 'beschikbaar', current_mileage: 1000,
        });
        vehicleId = vehicle.id;
        const [candidate] = await rest<Array<{ id: string }>>(page, 'post', 'candidates', {
          organization_id: orgId, first_name: 'QA', last_name: `Toewijzing ${stamp}`,
          has_drivers_license: true, drivers_license_expiry: '2030-01-01',
        });
        candidateId = candidate.id;
      });

      await page.goto(`/kandidaten/${candidateId}?tab=transport`, { waitUntil: 'domcontentloaded' });

      await test.step('toewijzen vanaf de medewerker', async () => {
        await assignFromEmployee(page, plate);
        await expect(page.getByRole('link', { name: plate })).toBeVisible();
        expect((await vehicleRow(page, vehicleId!)).status).toBe('toegewezen');
      });

      await test.step('inleveren: validatie blokkeert een te lage eindstand', async () => {
        await page.getByRole('button', { name: 'Inleveren' }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Voertuig inleveren' });
        await expect(dialog.getByLabel('Inleverdatum *')).toHaveValue(todayISO());
        await expect(dialog.getByRole('button', { name: 'Inleveren' })).toBeDisabled();
        await dialog.getByLabel('Eind kilometerstand *').fill('900');
        await expect(dialog.getByText(/lager dan de beginstand/)).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Inleveren' })).toBeDisabled();
        await dialog.getByLabel('Eind kilometerstand *').fill('1250');
        await expect(dialog.getByRole('button', { name: 'Inleveren' })).toBeEnabled();
        await page.screenshot({ path: 'scripts/.qa-toewijzing-inleveren.png' });
        await dialog.getByRole('button', { name: 'Inleveren' }).click();
        await expect(page.getByText('Voertuig ingeleverd').first()).toBeVisible();
        await expect(dialog).toBeHidden();
      });

      let assignmentId = '';
      await test.step('na inleveren: historie, voertuig beschikbaar, auditregel', async () => {
        await expect(page.getByText('Geen voertuig toegewezen')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Eerdere voertuigen' })).toBeVisible();
        await expect(page.locator('table').filter({ hasText: plate })).toContainText('1.250');

        const vehicle = await vehicleRow(page, vehicleId!);
        expect(vehicle.status).toBe('beschikbaar');
        expect(vehicle.current_mileage).toBe(1250);

        const [assignment] = await assignmentsFor(page, candidateId!);
        assignmentId = assignment.id;
        expect(assignment.returned_date).toBe(todayISO());
        expect(assignment.end_mileage).toBe(1250);
        await expect.poll(async () => (await auditFor(page, assignmentId)).map((a) => a.action)).toEqual(['update']);
        const [audit] = await auditFor(page, assignmentId);
        expect(audit.new_values).toMatchObject({ returned_date: todayISO(), end_mileage: 1250 });
      });

      await test.step('verwijderen vanaf de medewerker, met bevestiging', async () => {
        await page.getByRole('button', { name: 'Toewijzing verwijderen' }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Toewijzing verwijderen?' });
        await expect(dialog).toContainText(plate);
        await page.screenshot({ path: 'scripts/.qa-toewijzing-verwijderen.png' });
        await dialog.getByRole('button', { name: 'Verwijderen' }).click();
        await expect(page.getByText('Toewijzing verwijderd').first()).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Eerdere voertuigen' })).toBeHidden();

        expect(await assignmentsFor(page, candidateId!)).toHaveLength(0);
        await expect.poll(async () => (await auditFor(page, assignmentId)).map((a) => a.action)).toEqual(['update', 'delete']);
        expect((await vehicleRow(page, vehicleId!)).status).toBe('beschikbaar');
      });

      await test.step('voertuigkant: dezelfde acties, dezelfde uitkomst', async () => {
        await assignFromEmployee(page, plate);
        expect((await vehicleRow(page, vehicleId!)).status).toBe('toegewezen');

        await page.goto(`/transport/${vehicleId}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: 'Toewijzingen' }).click();
        const row = page.locator('table tbody tr').filter({ hasText: 'Huidig' });
        await row.getByRole('button', { name: 'Inleveren' }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Voertuig inleveren' });
        await dialog.getByLabel('Eind kilometerstand *').fill('1300');
        await dialog.getByRole('button', { name: 'Inleveren' }).click();
        await expect(page.getByText('Voertuig ingeleverd').first()).toBeVisible();
        await expect(dialog).toBeHidden();
        const vehicle = await vehicleRow(page, vehicleId!);
        expect(vehicle.status).toBe('beschikbaar');
        expect(vehicle.current_mileage).toBe(1300);

        const [assignment] = await assignmentsFor(page, candidateId!);
        const returnedRow = page.locator('table tbody tr').filter({ hasText: 'QA' }).first();
        await returnedRow.getByRole('button').last().click();
        await page.getByRole('menuitem', { name: 'Verwijderen' }).click();
        await page.getByRole('alertdialog', { name: 'Toewijzing verwijderen?' }).getByRole('button', { name: 'Verwijderen' }).click();
        await expect(page.getByText('Toewijzing verwijderd').first()).toBeVisible();
        expect(await assignmentsFor(page, candidateId!)).toHaveLength(0);
        await expect.poll(async () => (await auditFor(page, assignment.id)).map((a) => a.action)).toEqual(['update', 'delete']);
      });
    } finally {
      // Opruimen: eerst de kandidaat (RPC ruimt employees-koppelrij + toewijzingen mee op), dan het voertuig.
      if (candidateId) {
        await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/delete_candidate_record`, {
          headers: await authHeaders(page),
          data: { p_candidate_id: candidateId, p_reason: 'QA-opruiming toewijzing-vanaf-medewerker' },
        });
      }
      if (vehicleId) {
        await page.request.delete(`${SUPABASE_URL}/rest/v1/vehicle_assignments?vehicle_id=eq.${vehicleId}`, { headers: await authHeaders(page) });
        await page.request.delete(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, { headers: await authHeaders(page) });
      }
    }
  });
});
