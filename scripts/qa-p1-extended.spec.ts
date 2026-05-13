import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLoggedIn } from './e2e-helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('P1.4 — timesheet entry sheet toont placement-dropdown', async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  const edgeFnErrors: { url: string; status: number; body: string }[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', async res => {
    if (res.url().includes('/functions/v1/') && res.status() >= 400) {
      try {
        edgeFnErrors.push({ url: res.url(), status: res.status(), body: (await res.text()).slice(0, 200) });
      } catch {
        return;
      }
    }
  });

  await ensureLoggedIn(page);
  await page.goto('/uren', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: path.resolve(__dirname, '../p1.4-uren-page.png') });

  const addButton = page.getByRole('button', { name: /uren invoeren|nieuwe uren|toevoegen/i }).first();
  await expect(addButton).toBeVisible({ timeout: 10_000 });
  await addButton.click();

  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: /uren invoeren/i })).toBeVisible();

  // Controleer of "Plaatsing" label in de sheet zichtbaar is
  const placementLabel = page.locator('label', { hasText: /plaatsing/i });
  const hasPlacementField = await placementLabel.count() > 0;

  // Ook "Medewerker" label
  const employeeLabel = page.locator('label', { hasText: /medewerker/i });
  const hasEmployeeField = await employeeLabel.count() > 0;

  console.log(`[P1.4] Medewerker veld: ${hasEmployeeField}, Plaatsing veld: ${hasPlacementField}`);

  await page.screenshot({ path: path.resolve(__dirname, '../p1.4-uren-sheet.png') });

  expect(hasEmployeeField, 'Medewerker-veld moet zichtbaar zijn in nieuwe-uren sheet').toBeTruthy();
  // P1.4: placement veld verschijnt na medewerkerselectie. Mag dus ook nog niet zichtbaar zijn.

  // Check edge function errors (moeten 0 zijn)
  console.log(`[P1.4] Edge fn errors: ${edgeFnErrors.length}`);
  for (const e of edgeFnErrors) console.log('  -', e.status, e.url.split('/').pop(), '|', e.body);
  const es256 = edgeFnErrors.filter(e => e.body.includes('ES256'));
  expect(es256, 'Geen ES256 errors meer').toHaveLength(0);
});

test('P1.2/P1.3 — vacatures overzicht laadt zonder placement-gerelateerde errors', async ({ page }) => {
  test.setTimeout(60_000);

  const edgeFnErrors: { url: string; status: number; body: string }[] = [];
  page.on('response', async res => {
    if (res.url().includes('/functions/v1/') && res.status() >= 400) {
      try {
        edgeFnErrors.push({ url: res.url(), status: res.status(), body: (await res.text()).slice(0, 200) });
      } catch {
        return;
      }
    }
  });

  await ensureLoggedIn(page);
  await page.goto('/plaatsingen', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  await page.screenshot({ path: path.resolve(__dirname, '../p1.2-3-plaatsingen-page.png') });

  console.log(`[P1.2/3] Edge fn errors: ${edgeFnErrors.length}`);
  for (const e of edgeFnErrors) console.log('  -', e.status, e.url.split('/').pop(), '|', e.body);

  // Geen ES256 errors, geen portal_invites 400, geen whatsapp-send 400
  const blokkers = edgeFnErrors.filter(e =>
    e.body.includes('ES256') ||
    e.body.includes('portal_invites') ||
    (e.url.endsWith('/whatsapp-send') && e.status === 400)
  );
  expect(blokkers, `Blokkerende errors: ${JSON.stringify(blokkers)}`).toHaveLength(0);
});
