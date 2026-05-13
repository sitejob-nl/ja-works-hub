// API contract tests — verifieren dat edge functions goed reageren op
// ontbrekende/ongeldige auth. Voeren geen destructieve acties uit.

import { test, expect } from "@playwright/test";

const SUPABASE_URL = "https://noaupcteygfvlyymqtew.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vYXVwY3RleWdmdmx5eW1xdGV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzAxNTEsImV4cCI6MjA4ODU0NjE1MX0.YmwNWZSt7IPTBnSNtKwMLlqPXiOaZdWeOQCbFrtWeT4";

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

  test("automated-messages — rejects without X-Automated-Key", async ({ request }) => {
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

  test("automated-messages — rejects unknown job", async ({ request }) => {
    const key = process.env.AUTOMATED_KEY ?? "VwEQ-VFVx-Gx3wYtN50pP4hpV_Sr-O4QGOebM1KTgNo";
    const res = await request.post(
      `${SUPABASE_URL}/functions/v1/automated-messages?job=nonexistent-job`,
      {
        headers: {
          "X-Automated-Key": key,
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
