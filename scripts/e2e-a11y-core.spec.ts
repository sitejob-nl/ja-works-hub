import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_STATE = path.resolve(__dirname, '.auth-state.json');
const PROJECT_REF = 'noaupcteygfvlyymqtew';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`;
const SUPABASE_ANON =
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY;
const LOGIN_EMAIL =
  process.env.TEST_EMAIL ??
  process.env.DEMO_ORG_EMAIL ??
  process.env.QA_SUPERADMIN_EMAIL;
const LOGIN_PASSWORD =
  process.env.TEST_PASSWORD ??
  process.env.DEMO_ORG_PASSWORD ??
  process.env.QA_SUPERADMIN_PASSWORD;

const routes = [
  { path: '/kandidaten', label: 'kandidaten' },
  { path: '/match-pipeline', label: 'match pipeline' },
  { path: '/uren', label: 'uren' },
];

function readRefreshTokenFromStorageState() {
  if (!fs.existsSync(AUTH_STATE)) return null;
  const state = JSON.parse(fs.readFileSync(AUTH_STATE, 'utf8')) as {
    origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
  };
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (!item.name.includes('auth-token')) continue;
      const stored = JSON.parse(item.value) as {
        refresh_token?: string;
        currentSession?: { refresh_token?: string };
      };
      const refreshToken = stored.refresh_token ?? stored.currentSession?.refresh_token;
      if (refreshToken) return refreshToken;
    }
  }
  return null;
}

async function installSession(page: import('@playwright/test').Page, session: unknown) {
  await page.addInitScript(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, value);
    },
    { key: AUTH_KEY, value: JSON.stringify(session) },
  );
}

async function ensureA11yLoggedIn(page: import('@playwright/test').Page) {
  if (!SUPABASE_ANON) {
    test.skip(true, 'Supabase anon key ontbreekt; auth skip');
    return;
  }

  if (LOGIN_EMAIL && LOGIN_PASSWORD) {
    const response = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
    });
    expect(response.ok(), `Login faalde: ${await response.text()}`).toBeTruthy();
    await installSession(page, await response.json());
    return;
  }

  const refreshToken = readRefreshTokenFromStorageState();
  if (!refreshToken) {
    test.skip(true, 'Geen TEST-login en geen refresh token in lokale auth-state; auth skip');
    return;
  }

  const response = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    data: { refresh_token: refreshToken },
  });

  if (!response.ok()) {
    test.skip(true, 'Lokale refresh token is verlopen; auth skip');
    return;
  }

  await installSession(page, await response.json());
}

test.describe('core a11y control names', () => {
  test.skip(
    !SUPABASE_ANON || (!fs.existsSync(AUTH_STATE) && (!LOGIN_EMAIL || !LOGIN_PASSWORD)),
    'Supabase env, lokale auth-state of QA/demo login ontbreekt; sla core a11y smoke over.',
  );

  test.beforeEach(async ({ page }) => {
    await ensureA11yLoggedIn(page);
  });

  for (const route of routes) {
    test(`${route.label} heeft geen zichtbare naamloze buttons of checkboxes`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);

      await expect(page).not.toHaveURL(/\/login/);

      const unnamedControls = await page.evaluate(() => {
        const selector = 'button, [role="button"], input[type="checkbox"], [role="checkbox"]';

        const isVisible = (element: Element) => {
          if (element.closest('[aria-hidden="true"]')) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const textByIds = (element: Element, attr: string) => {
          const ids = element.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? [];
          return ids.map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim();
        };

        const labelText = (element: Element) => {
          if (element instanceof HTMLInputElement && element.labels?.length) {
            return Array.from(element.labels).map((label) => label.innerText).join(' ').trim();
          }
          return '';
        };

        const controlName = (element: Element) => {
          return [
            element.getAttribute('aria-label'),
            textByIds(element, 'aria-labelledby'),
            labelText(element),
            element instanceof HTMLElement ? element.innerText : '',
            element.getAttribute('title'),
            element.getAttribute('value'),
          ].find((value) => value && value.trim().length > 0)?.trim() ?? '';
        };

        return Array.from(document.querySelectorAll(selector))
          .filter((element) => isVisible(element) && !controlName(element))
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            type: element.getAttribute('type'),
            className: element.getAttribute('class'),
          }));
      });

      expect(unnamedControls).toEqual([]);
    });
  }
});
