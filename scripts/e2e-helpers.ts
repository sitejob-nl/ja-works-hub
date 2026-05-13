import { expect, Page, test } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_FILE = path.resolve(__dirname, ".auth-state.json");

export const SUPABASE_URL = "https://noaupcteygfvlyymqtew.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vYXVwY3RleWdmdmx5eW1xdGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzAxNTEsImV4cCI6MjA4ODU0NjE1MX0.YmwNWZSt7IPTBnSNtKwMLlqPXiOaZdWeOQCbFrtWeT4";

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

async function getStoredSession(page: Page): Promise<StoredSupabaseSession | null> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.includes("auth-token")) {
        try {
          return JSON.parse(localStorage.getItem(k) || "null");
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

export async function getAccessToken(page: Page): Promise<string | null> {
  const session = await getStoredSession(page);
  return session?.access_token ?? session?.currentSession?.access_token ?? null;
}

async function storeSession(page: Page, session: unknown): Promise<void> {
  await page.evaluate(
    ({ nextSession, projectRef }) => {
      localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(nextSession));
    },
    { nextSession: session, projectRef: "noaupcteygfvlyymqtew" }
  );
}

async function refreshStoredSession(page: Page): Promise<boolean> {
  const session = await getStoredSession(page);
  const refreshToken = session?.refresh_token ?? session?.currentSession?.refresh_token;
  if (!refreshToken) return false;

  const resp = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { refresh_token: refreshToken },
  });

  if (!resp.ok()) return false;

  await storeSession(page, await resp.json());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.context().storageState({ path: STORAGE_FILE });
  return true;
}

function sessionIsFresh(session: StoredSupabaseSession | null): boolean {
  const token = session?.access_token ?? session?.currentSession?.access_token;
  const expiresAt = session?.expires_at ?? session?.currentSession?.expires_at;
  if (!token) return false;
  if (!expiresAt) return true;
  return expiresAt > Math.floor(Date.now() / 1000) + 60;
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  const existingSession = await getStoredSession(page);
  if (!email && !password && sessionIsFresh(existingSession)) return;
  if (!email && !password && await refreshStoredSession(page)) return;

  if (!email || !password) {
    test.skip(true, "TEST_EMAIL / TEST_PASSWORD env vars niet gezet en bestaande sessie kon niet worden ververst; auth skip");
    return;
  }

  const resp = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(resp.ok(), `Login faalde: ${await resp.text()}`).toBeTruthy();
  const body = await resp.json();

  await storeSession(page, body);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.context().storageState({ path: STORAGE_FILE });
}
