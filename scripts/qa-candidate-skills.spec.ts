import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { ensureLoggedIn } from './e2e-helpers';

// Opt-in integration test: only the dedicated demo tenant, with synthetic data.
// Do not enter contact details or click any send action.
test('candidate creation links a catalog skill; Recruitmentpartner can be saved and edited', async ({ page }) => {
  const org = process.env.DEMO_ORG_ID;
  expect(org).toBe('6dedabe4-f62c-479e-b5fc-ebfcb824d76f');
  expect(process.env.TEST_EMAIL).toBe(process.env.DEMO_ORG_EMAIL);
  const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const checked = async (query: PromiseLike<{ data: any; error: any }>) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };
  await checked(db.auth.signInWithPassword({ email: process.env.TEST_EMAIL!, password: process.env.TEST_PASSWORD! }));
  const user = (await db.auth.getUser()).data.user!;
  const profile = await checked(db.from('profiles').select('organization_id').eq('id', user.id).single());
  expect(profile.organization_id).toBe(org);
  const marker = 'QA-skills-' + randomUUID().slice(0, 8);
  const skill = (await checked(db.from('skills').select('id,name,updated_at').eq('organization_id', org).eq('is_active', true).order('name').limit(1)))[0];
  expect(skill).toBeTruthy();

  try {
    await ensureLoggedIn(page);
    await page.goto('/kandidaten/new');
    await page.locator('label:has-text("Voornaam") + input').fill('QA');
    await page.locator('label:has-text("Achternaam") + input').fill(marker);
    await page.getByRole('combobox').filter({ hasText: 'Kies vaardigheden' }).click();
    await page.getByPlaceholder('Zoek vaardigheid...').fill(skill.name);
    await page.getByRole('option', { name: skill.name, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox').filter({ hasText: 'Selecteer bron' }).click();
    await page.getByRole('option', { name: 'Recruitmentpartner', exact: true }).click();
    await page.getByRole('button', { name: 'Kandidaat aanmaken', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Links versturen', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Naar kandidaat', exact: true }).click();
    await expect(page).toHaveURL(/\/kandidaten\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').at(-1)!;
    const candidate = () => checked(db.from('candidates').select('source,skills').eq('id', id).single());
    expect(await candidate()).toEqual({ source: 'Recruitmentpartner', skills: [skill.name] });
    const links = await checked(db.from('candidate_skills').select('skill_id').eq('candidate_id', id));
    expect(links).toEqual([{ skill_id: skill.id }]);

    await page.getByRole('tab', { name: 'Profiel', exact: true }).click();
    const source = page.getByRole('combobox').filter({ hasText: 'Recruitmentpartner' });
    // Use real scrolling so opening the Radix select does not undo auto-scroll.
    await page.mouse.move(900, 800);
    await expect(source).toBeVisible();
    for (let i = 0; i < 15; i++) {
      const box = await source.boundingBox();
      if (box && box.y > 80 && box.y + box.height < 1500) break;
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(50);
    }
    await expect(source).toBeInViewport();
    await source.click();
    await page.getByRole('option', { name: 'Referral', exact: true }).click();
    await expect.poll(async () => (await candidate()).source).toBe('Referral');
    await page.getByRole('combobox').filter({ hasText: 'Referral' }).click();
    await page.getByRole('option', { name: 'Recruitmentpartner', exact: true }).click();
    await expect.poll(async () => (await candidate()).source).toBe('Recruitmentpartner');
    expect(await checked(db.from('skills').select('id,name,updated_at').eq('id', skill.id).single())).toEqual(skill);
  } finally {
    // Also cleans up a candidate if the form failed after the candidate INSERT.
    const fixtures = await checked(db.from('candidates').select('id').eq('organization_id', org).eq('last_name', marker));
    for (const row of fixtures) {
      await checked(db.rpc('delete_candidate_record', { p_candidate_id: row.id, p_reason: 'Opruimen eigen ' + marker }));
    }
    expect(await checked(db.from('candidates').select('id').eq('organization_id', org).eq('last_name', marker))).toEqual([]);
  }
});
