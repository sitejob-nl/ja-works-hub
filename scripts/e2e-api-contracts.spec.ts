// API contract tests — verifieren dat edge functions goed reageren op
// ontbrekende/ongeldige auth. Voeren geen destructieve acties uit.

import { test, expect } from "@playwright/test";

const SUPABASE_URL = "https://noaupcteygfvlyymqtew.supabase.co";
const SUPABASE_ANON =
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON) {
  throw new Error("E2E_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is required");
}

const EDGE_FUNCTIONS = [
  "process-sick-report",
  "send-portal-invite",
  "send-timesheet-approval",
  "send-damage-report",
  "send-match-proposal",
  "send-placement-confirmation",
  "outlook-accounts",
  "outlook-mail",
  "outlook-send-mail",
  "outlook-calendar",
  "exact-api",
  "exact-sync-account",
  "exact-sync-invoice",
  "email-campaign-processor",
  "cv-rewrite",
  "carerix-attachment-download",
  "data-export",
];

test.describe("Edge function auth gates", () => {
  for (const fn of EDGE_FUNCTIONS) {
    test(`${fn} — rejects requests without Authorization header`, async ({ request }) => {
      const res = await request.post(`${SUPABASE_URL}/functions/v1/${fn}`, {
        headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
        data: {},
        failOnStatusCode: false,
      });
      expect([401, 403]).toContain(res.status());
    });

    test(`${fn} — rejects requests with invalid bearer token`, async ({ request }) => {
      const res = await request.post(`${SUPABASE_URL}/functions/v1/${fn}`, {
        headers: {
          Authorization: "Bearer invalid.jwt.token",
          apikey: SUPABASE_ANON,
          "Content-Type": "application/json",
        },
        data: {},
        failOnStatusCode: false,
      });
      expect([401, 403]).toContain(res.status());
    });
  }

  test("automated-messages — rejects without X-Cron-Secret", async ({ request }) => {
    const res = await request.post(
      `${SUPABASE_URL}/functions/v1/automated-messages?job=onboarding-reminders`,
      {
        headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
        data: {},
        failOnStatusCode: false,
      }
    );
    expect(res.status()).toBe(401);
  });

  test("automated-messages — rejects invalid X-Cron-Secret", async ({ request }) => {
    const res = await request.post(
      `${SUPABASE_URL}/functions/v1/automated-messages?job=onboarding-reminders`,
      {
        headers: {
          "X-Cron-Secret": "invalid-cron-secret",
          apikey: SUPABASE_ANON,
          "Content-Type": "application/json",
        },
        data: {},
        failOnStatusCode: false,
      }
    );
    expect(res.status()).toBe(401);
  });

  test("automated-messages — rejects unknown job", async ({ request }) => {
    const cronSecret = process.env.E2E_CRON_SECRET ?? process.env.CRON_SECRET;
    test.skip(!cronSecret, "CRON_SECRET ontbreekt; unknown-job auth-path smoke overgeslagen");

    const res = await request.post(
      `${SUPABASE_URL}/functions/v1/automated-messages?job=nonexistent-job`,
      {
        headers: {
          "X-Cron-Secret": cronSecret,
          apikey: SUPABASE_ANON,
          "Content-Type": "application/json",
        },
        data: {},
        failOnStatusCode: false,
      }
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown job/i);
  });
});

test.describe("Public endpoints — CORS preflight", () => {
  const publicFns = [
    "onboarding-submit",
    "candidate-profile",
    "portal-activate",
    "client-portal-activate",
    "whatsapp-webhook",
  ];

  for (const fn of publicFns) {
    test(`${fn} — OPTIONS preflight returns 200`, async ({ request }) => {
      const res = await request.fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:8080",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(200);
    });
  }
});
