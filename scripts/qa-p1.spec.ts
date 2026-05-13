import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from './e2e-helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe.configure({ mode: 'serial' });

async function decodeJwtHeader(token: string): Promise<{ alg?: string }> {
  const [h] = token.split('.');
  const pad = '='.repeat((4 - h.length % 4) % 4);
  const json = Buffer.from(h.replace(/-/g,'+').replace(/_/g,'/') + pad, 'base64').toString('utf8');
  return JSON.parse(json);
}

test('P1.1 — edge functions accepteren ES256 JWT (self-auth)', async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await ensureLoggedIn(page);
  const token = await getAccessToken(page);

  expect(token, 'Access token moet aanwezig zijn na login').toBeTruthy();

  // Check JWT alg
  const header = await decodeJwtHeader(token!);
  console.log('[P1.1] JWT alg:', header.alg);

  // Test edge function: send-match-proposal met preview=true + dummy match id
  // Verwacht: NIET 401 ES256 meer. Self-auth kan wel 404/400 geven, dat is acceptabel.
  const resp = await page.request.post(`${SUPABASE_URL}/functions/v1/send-match-proposal`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    data: { preview: true, match_id: '00000000-0000-0000-0000-000000000000' },
  });
  const text = await resp.text();
  console.log('[P1.1] send-match-proposal:', resp.status(), text.slice(0, 200));

  expect(text).not.toContain('ES256');
  expect(text).not.toContain('UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM');
  // 401 zou betekenen auth werkt niet; 404 = match niet gevonden (normaal)
  expect([200, 400, 404]).toContain(resp.status());

  // generate-notifications
  const resp2 = await page.request.post(`${SUPABASE_URL}/functions/v1/generate-notifications`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    data: {},
  });
  const text2 = await resp2.text();
  console.log('[P1.1] generate-notifications:', resp2.status(), text2.slice(0, 200));

  expect(text2).not.toContain('ES256');

  // Screenshot voor archief
  await page.screenshot({ path: path.resolve(__dirname, '../p1.1-jwt-ok.png') });
});

test('P1.1b — navigeer naar vacature-matches en check geen ES256 errors', async ({ page }) => {
  test.setTimeout(60_000);

  await ensureLoggedIn(page);

  const consoleErrors: string[] = [];
  const networkErrors: { url: string; status: number; body: string }[] = [];

  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', async res => {
    if (res.url().includes('/functions/v1/') && res.status() >= 400) {
      try {
        const body = await res.text();
        networkErrors.push({ url: res.url(), status: res.status(), body: body.slice(0, 300) });
      } catch { /* ignore */ }
    }
  });

  await page.goto('/vacatures', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000); // wacht op data-load en notifications call

  const es256Errors = [
    ...consoleErrors.filter(e => e.includes('ES256') || e.includes('UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM')),
    ...networkErrors.filter(e => e.body.includes('ES256')),
  ];

  console.log('[P1.1b] Console errors:', consoleErrors.length);
  console.log('[P1.1b] Edge function errors:', networkErrors.length);
  for (const e of networkErrors) console.log('  -', e.status, e.url.split('/').pop(), '|', e.body);

  await page.screenshot({ path: path.resolve(__dirname, '../p1.1b-vacatures-page.png') });

  expect(es256Errors, `ES256 errors gevonden: ${JSON.stringify(es256Errors)}`).toHaveLength(0);
});
