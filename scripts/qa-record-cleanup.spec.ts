import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { ensureLoggedIn } from './e2e-helpers';

// Explicit demo-only live integration QA. No contact details or send actions.
const org = process.env.DEMO_ORG_ID!;
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
const marker = 'QA-cleanup-' + randomUUID().slice(0, 8);
const ids = { companies: [] as string[], placements: [] as string[], fines: [] as string[], candidate: '', vehicle: '', document: '', invoice: '', notes: [] as string[], tasks: [] as string[], paths: [] as string[] };
const checked = async (q: PromiseLike<{ data: any; error: any }>) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};
const add = async (table: string, row: Record<string, unknown>) =>
  (await checked(db.from(table).insert({ organization_id: org, ...row }).select('id').single())).id as string;

test.beforeAll(async () => {
  expect(org).toBe('6dedabe4-f62c-479e-b5fc-ebfcb824d76f');
  // Fixtures use the existing demo admin; the browser uses its own role account.
  await checked(db.auth.signInWithPassword({ email: process.env.DEMO_ORG_EMAIL!, password: process.env.DEMO_ORG_PASSWORD! }));
  const user = (await db.auth.getUser()).data.user!;
  const profile = await checked(db.from('profiles').select('organization_id,role').eq('id', user.id).single());
  expect(profile).toEqual({ organization_id: org, role: 'admin' });
  ids.companies.push(await add('companies', { name: marker }));
  ids.companies.push(await add('companies', { name: marker, phone: 'QA phone' }));
  const loser = ids.companies[1];
  ids.candidate = await add('candidates', { first_name: 'QA', last_name: marker });
  for (let i = 0; i < 5; i++) {
    ids.placements.push(await add('placements', { company_id: loser, candidate_id: ids.candidate, function_name: marker + '-placement-' + i, start_date: '2026-09-14' }));
  }
  ids.invoice = await add('invoices', { company_id: loser, invoice_number: marker, period_start: '2026-09-14', period_end: '2026-09-20' });
  await add('invoice_lines', { invoice_id: ids.invoice, placement_id: ids.placements[4], description: marker });
  ids.vehicle = await add('vehicles', { license_plate: 'QA-' + randomUUID().slice(0, 6), brand: marker });
  for (let i = 0; i < 2; i++) {
    const path = `${org}/vehicle-fines/${ids.vehicle}/${randomUUID()}.txt`;
    await checked(db.storage.from('documents').upload(path, Buffer.from(marker), { contentType: 'text/plain' }));
    ids.paths.push(path);
    ids.fines.push(await add('vehicle_fines', { vehicle_id: ids.vehicle, fine_date: '2026-09-14', amount: 10, description: marker + '-fine-' + i, photos: [path] }));
  }
  await add('company_contacts', { company_id: loser, full_name: marker + '-contact' });
  const docPath = `${org}/companies/${loser}/${randomUUID()}.txt`;
  await checked(db.storage.from('documents').upload(docPath, Buffer.from(marker), { contentType: 'text/plain' }));
  ids.paths.push(docPath);
  ids.document = await add('documents', { company_id: loser, name: marker + '-document', type: 'overig', file_path: docPath });
  for (const kind of ['opdrachtgever', 'bedrijf', 'company']) {
    ids.notes.push(await add('notes', { related_entity_id: loser, related_entity_type: kind, body: marker + '-note-' + kind, created_by: user.id }));
    ids.tasks.push(await add('recruiter_tasks', { related_entity_id: loser, related_entity_type: kind, title: marker + '-task-' + kind, created_by: user.id }));
  }
});

test.afterAll(async () => {
  // Keep trying every cleanup even if an earlier removal failed.
  const failures: string[] = [];
  const clean = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch { failures.push(name); }
  };
  if (ids.paths.length) await clean('files', () => checked(db.storage.from('documents').remove(ids.paths)));
  if (ids.document) await clean('document', () => checked(db.from('documents').delete().eq('id', ids.document)));
  if (ids.notes.length) await clean('notes', () => checked(db.from('notes').delete().in('id', ids.notes)));
  if (ids.tasks.length) await clean('tasks', () => checked(db.from('recruiter_tasks').delete().in('id', ids.tasks)));
  if (ids.invoice) await clean('invoice', () => checked(db.from('invoices').delete().eq('id', ids.invoice)));
  if (ids.placements.length) await clean('placements', () => checked(db.from('placements').delete().in('id', ids.placements)));
  if (ids.fines.length) await clean('fines', () => checked(db.from('vehicle_fines').delete().in('id', ids.fines)));
  if (ids.vehicle) await clean('vehicle', () => checked(db.from('vehicles').delete().eq('id', ids.vehicle)));
  if (ids.companies.length) await clean('companies', () => checked(db.from('companies').delete().in('id', ids.companies)));
  if (ids.candidate) await clean('candidate', () => checked(db.rpc('delete_candidate_record', { p_candidate_id: ids.candidate, p_reason: 'Opruimen eigen ' + marker })));
  expect(failures, 'All synthetic fixtures cleaned up').toEqual([]);
  expect(await checked(db.from('companies').select('id').eq('organization_id', org).eq('name', marker))).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await ensureLoggedIn(page);
  const browserUser = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const auth = await checked(browserUser.auth.signInWithPassword({ email: process.env.TEST_EMAIL!, password: process.env.TEST_PASSWORD! }));
  const profile = await checked(browserUser.from('profiles').select('role,organization_id').eq('id', auth.user.id).single());
  expect(profile).toEqual({ role: process.env.QA_ROLE || 'admin', organization_id: org });
});

test('boete verwijderen via Transport verwijdert ook de bijlage', async ({ page }) => {
  await page.goto('/transport');
  await page.getByRole('tab', { name: 'Boetes', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: marker + '-fine-0' });
  await row.getByRole('button', { name: 'Verwijderen', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('1 bijlage');
  await dialog.getByRole('button', { name: 'Verwijderen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => checked(db.from('vehicle_fines').select('id').eq('id', ids.fines[0]))).toEqual([]);
  const files = await checked(db.storage.from('documents').list(`${org}/vehicle-fines/${ids.vehicle}`));
  expect(files.map((f: any) => f.name)).not.toContain(ids.paths[0].split('/').at(-1));
});

test('boete verwijderen vanuit het voertuig', async ({ page }) => {
  await page.goto('/transport/' + ids.vehicle);
  await page.getByRole('tab', { name: 'Boetes', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: marker + '-fine-1' });
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Verwijderen', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen', exact: true }).click();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => checked(db.from('vehicle_fines').select('id').eq('id', ids.fines[1]))).toEqual([]);
});

for (const [index, entry] of ['company', 'list', 'detail'].entries()) {
  test('testplaatsing verwijderen via ' + entry, async ({ page }) => {
    if (entry === 'company') {
      await page.goto('/opdrachtgevers/' + ids.companies[1]);
      await page.getByRole('tab', { name: 'Plaatsingen', exact: true }).click();
      await page.getByRole('row').filter({ hasText: marker + '-placement-' + index }).getByTitle('Plaatsing verwijderen').click();
    } else if (entry === 'list') {
      await page.goto('/plaatsingen');
      await page.getByPlaceholder('Zoek op naam, functie, bedrijf...').fill(marker + '-placement-' + index);
      await page.getByRole('row').filter({ hasText: marker + '-placement-' + index }).getByTitle('Plaatsing verwijderen').click();
    } else {
      await page.goto('/plaatsingen/' + ids.placements[index]);
      await page.getByRole('button', { name: 'Verwijderen', exact: true }).click();
    }
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Er hangen geen uren');
    await dialog.getByRole('button', { name: 'Verwijderen', exact: true }).click();
    await expect.poll(async () => checked(db.from('placements').select('id').eq('id', ids.placements[index]))).toEqual([]);
  });
}

test('plaatsing met factuurhistorie blijft beschermd', async ({ page }) => {
  await page.goto('/plaatsingen/' + ids.placements[4]);
  await page.getByRole('button', { name: 'Verwijderen', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('1 factuurregel');
  await expect(dialog.getByRole('button', { name: 'Verwijderen', exact: true })).toBeDisabled();
  expect(await checked(db.from('placements').select('id').eq('id', ids.placements[4]))).toHaveLength(1);
});

test('opdrachtgevers samenvoegen bewaart het dossier en respecteert financiële rechten', async ({ page }) => {
  const [survivor, loser] = ids.companies;
  await page.goto('/opdrachtgevers');
  await page.getByRole('button', { name: 'Duplicaten', exact: true }).click();
  const survivorLink = page.locator(`a[href="/opdrachtgevers/${survivor}"]`);
  const card = page.locator('.rounded-lg.border.bg-card').filter({ has: survivorLink });
  await expect(card).toContainText(marker);
  await card.locator('.rounded-md.border.p-3').filter({ has: survivorLink }).click();
  const mergeResponse = page.waitForResponse(r => r.url().includes('/rpc/merge_company_records'));
  await card.getByRole('button', { name: 'Samenvoegen in geselecteerde', exact: true }).click();
  const response = await mergeResponse;
  if (process.env.QA_ROLE && process.env.QA_ROLE !== 'admin') {
    // Existing finance.manage restrictions still apply to moving an invoice.
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe('42501');
    expect(await checked(db.from('companies').select('id').eq('id', loser))).toHaveLength(1);
    expect((await checked(db.from('notes').select('related_entity_id').in('id', ids.notes))).every((n: any) => n.related_entity_id === loser)).toBe(true);
    return;
  }
  expect(response.ok()).toBe(true);
  await expect.poll(async () => checked(db.from('companies').select('id').eq('id', loser))).toEqual([]);
  expect((await checked(db.from('placements').select('company_id').eq('id', ids.placements[3]).single())).company_id).toBe(survivor);
  expect((await checked(db.from('company_contacts').select('company_id').eq('full_name', marker + '-contact').single())).company_id).toBe(survivor);
  const doc = await checked(db.from('documents').select('company_id,file_path').eq('id', ids.document).single());
  expect(doc.company_id).toBe(survivor);
  expect(await (await checked(db.storage.from('documents').download(doc.file_path))).text()).toBe(marker);
  for (const table of ['notes', 'recruiter_tasks']) {
    const rows = await checked(db.from(table).select('related_entity_id,related_entity_type').in('id', table === 'notes' ? ids.notes : ids.tasks));
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => r.related_entity_id === survivor && r.related_entity_type === 'opdrachtgever')).toBe(true);
  }
  await page.goto('/opdrachtgevers/' + survivor);
  await page.getByRole('tab', { name: 'Notities', exact: true }).click();
  for (const kind of ['opdrachtgever', 'bedrijf', 'company']) await expect(page.getByText(marker + '-note-' + kind, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Taken', exact: true }).click();
  for (const kind of ['opdrachtgever', 'bedrijf', 'company']) await expect(page.getByText(marker + '-task-' + kind, { exact: true })).toBeVisible();
});
