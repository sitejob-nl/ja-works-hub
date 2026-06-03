import { expect, Page, test } from "@playwright/test";

export const SUPABASE_URL = "https://noaupcteygfvlyymqtew.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vYXVwY3RleWdmdmx5eW1xdGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzAxNTEsImV4cCI6MjA4ODU0NjE1MX0.YmwNWZSt7IPTBnSNtKwMLlqPXiOaZdWeOQCbFrtWeT4";

const PROJECT_REF = "noaupcteygfvlyymqtew";
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`;

type StoredSupabaseSession = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  currentSession?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
};

// De app-client (src/integrations/supabase/client.ts) bewaart de sessie in
// sessionStorage en wist bij elke load alle sb-*-auth-token keys uit localStorage.
// Lees daarom primair uit sessionStorage; localStorage blijft als fallback.
async function getStoredSession(page: Page): Promise<StoredSupabaseSession | null> {
  return page.evaluate(() => {
    const read = (store: Storage) => {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith("sb-") && k.includes("auth-token")) {
          try {
            return JSON.parse(store.getItem(k) || "null");
          } catch {
            return null;
          }
        }
      }
      return null;
    };
    return read(window.sessionStorage) || read(window.localStorage);
  });
}

export async function getAccessToken(page: Page): Promise<string | null> {
  const session = await getStoredSession(page);
  return session?.access_token ?? session?.currentSession?.access_token ?? null;
}

function sessionIsFresh(session: StoredSupabaseSession | null): boolean {
  const token = session?.access_token ?? session?.currentSession?.access_token;
  const expiresAt = session?.expires_at ?? session?.currentSession?.expires_at;
  if (!token) return false;
  if (!expiresAt) return true;
  return expiresAt > Math.floor(Date.now() / 1000) + 60;
}

async function fetchPasswordSession(page: Page, email: string, password: string): Promise<unknown> {
  const resp = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(resp.ok(), `Login faalde: ${await resp.text()}`).toBeTruthy();
  return resp.json();
}

/**
 * Zorgt dat de pagina als admin is ingelogd. Omdat de app-client de sessie in
 * sessionStorage bewaart én sb-* keys uit localStorage wist bij elke load,
 * injecteren we de sessie via addInitScript in sessionStorage. Dat overleeft de
 * localStorage-wipe en wordt bij elke navigatie binnen deze context opnieuw gezet.
 *
 * Vereist process.env.TEST_EMAIL / TEST_PASSWORD; anders wordt de test geskipt
 * (tenzij er al een verse sessie in storage staat).
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (sessionIsFresh(await getStoredSession(page))) return;
    test.skip(true, "TEST_EMAIL / TEST_PASSWORD env vars niet gezet en geen verse sessie; auth skip");
    return;
  }

  const session = await fetchPasswordSession(page, email, password);

  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        /* sessionStorage niet beschikbaar — negeren */
      }
    },
    { key: AUTH_KEY, value: JSON.stringify(session) },
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Geef de app-client even om de sessie te lezen; niet hard falen op trage redirects.
  await page.waitForLoadState("networkidle").catch(() => {});
}
