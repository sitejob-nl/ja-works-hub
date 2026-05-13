import { expect, Page, test } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_FILE = path.resolve(__dirname, ".auth-state.json");

export const SUPABASE_URL = "https://noaupcteygfvlyymqtew.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vYXVwY3RleWdmdmx5eW1xdGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzAxNTEsImV4cCI6MjA4ODU0NjE1MX0.YmwNWZSt7IPTBnSNtKwMLlqPXiOaZdWeOQCbFrtWeT4";

export async function getAccessToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.includes("auth-token")) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || "null");
          return v?.access_token ?? v?.currentSession?.access_token ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email && !password && await getAccessToken(page)) return;

  if (!email || !password) {
    test.skip(true, "TEST_EMAIL / TEST_PASSWORD env vars niet gezet; auth skip");
    return;
  }

  const resp = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(resp.ok(), `Login faalde: ${await resp.text()}`).toBeTruthy();
  const body = await resp.json();

  await page.evaluate(
    ({ session, projectRef }) => {
      localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(session));
    },
    { session: body, projectRef: "noaupcteygfvlyymqtew" }
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.context().storageState({ path: STORAGE_FILE });
}
