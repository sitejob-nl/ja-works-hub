import { expect, Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

type Json = Record<string, any>;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is verplicht voor demo-readiness QA`);
  return value;
}

async function authHeaders(page: Page) {
  const token = await getAccessToken(page);
  if (!token) throw new Error("Geen access token beschikbaar voor demo-readiness QA");
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function restGet<T>(page: Page, table: string, query: string): Promise<T[]> {
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: await authHeaders(page),
  });
  expect(res.ok(), `${table} select faalde: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T[];
}

async function restInsert<T>(page: Page, table: string, data: Json): Promise<T> {
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: {
      ...(await authHeaders(page)),
      Prefer: "return=representation",
    },
    data,
  });
  expect(res.ok(), `${table} insert faalde: ${await res.text()}`).toBeTruthy();
  const rows = (await res.json()) as T[];
  return rows[0];
}

async function expectText(page: Page, pattern: RegExp, label: string) {
  await expect(page.getByText(pattern).first(), label).toBeVisible({ timeout: 30_000 });
}

test.describe("Demo readiness QA", () => {
  test.beforeEach(async ({ page }) => {
    process.env.TEST_EMAIL = process.env.TEST_EMAIL ?? requiredEnv("DEMO_ORG_EMAIL");
    process.env.TEST_PASSWORD = process.env.TEST_PASSWORD ?? requiredEnv("DEMO_ORG_PASSWORD");
    await ensureLoggedIn(page);
  });

  test("demo-login kernflows renderen: kandidaat, vacature, match, feedback en intake", async ({ page }) => {
    const orgId = requiredEnv("DEMO_ORG_ID");
    const slug = `demo-readiness-${Date.now()}`;

    await restInsert(page, "candidate_signup_links", {
      organization_id: orgId,
      slug,
      title: "Demo publieke sollicitatie",
      description: "Playwright demo-readiness intake link.",
      source_tag: "playwright_demo_readiness",
      is_active: true,
      max_signups: 5,
      current_signups: 0,
      show_cv_upload: true,
      show_languages: true,
      show_nationality: true,
      show_drivers_license: true,
      show_availability: true,
    });

    await page.goto("/kandidaten", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder(/Zoek op naam, stad, e-mail of telefoon|Zoek op naam, stad of e-?mail/i).fill("Milan");
    await expectText(page, /Milan\s+Kowalski/i, "demo kandidaat zichtbaar");

    await page.goto("/vacatures", { waitUntil: "domcontentloaded" });
    await expectText(page, /Demo MIG-MAG lasser Eindhoven/i, "demo vacature zichtbaar");

    const vacancies = await restGet<{ id: string }>(
      page,
      "vacancies",
      `select=id&organization_id=eq.${orgId}&title=eq.${encodeURIComponent("Demo MIG-MAG lasser Eindhoven")}&limit=1`,
    );
    expect(vacancies[0]?.id).toBeTruthy();

    await page.goto(`/vacatures/${vacancies[0].id}?tab=matches`, { waitUntil: "domcontentloaded" });
    await expect(page, "vacaturetab blijft op matches").toHaveURL(/tab=matches/);
    await expectText(page, /Beste kandidaten uit eigen database|Gefilterd op vacature-eisen/i, "matchlijst zichtbaar");
    await expectText(page, /Milan\s+Kowalski|Match maken|match/i, "matchflow zichtbaar");

    await page.goto("/instellingen", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Matching/i }).click();
    await expectText(page, /Match-feedbackredenen/i, "feedbackbeheer zichtbaar");
    await expectText(page, /Mist verplichte vaardigheden|Reistijd te hoog|Niet beschikbaar/i, "demo feedbackredenen zichtbaar");

    await page.goto(`/solliciteren/${slug}`, { waitUntil: "domcontentloaded" });
    await expectText(page, /Demo publieke sollicitatie/i, "publieke intake link zichtbaar");
    await expect(page.getByLabel(/Voornaam/i), "intake voornaamveld").toBeVisible();
    await expect(page.getByLabel(/CV uploaden/i), "intake CV upload").toBeVisible();
  });

  test("server-side Mapbox/reistijd vult afstand in of bewaart nette fallback", async ({ page }) => {
    const orgId = requiredEnv("DEMO_ORG_ID");
    const candidates = await restGet<{ id: string }>(
      page,
      "candidates",
      `select=id&organization_id=eq.${orgId}&email=eq.milan.kowalski%40demo.local&limit=1`,
    );
    const vacancies = await restGet<{ id: string }>(
      page,
      "vacancies",
      `select=id&organization_id=eq.${orgId}&title=eq.${encodeURIComponent("Demo MIG-MAG lasser Eindhoven")}&limit=1`,
    );
    expect(candidates[0]?.id).toBeTruthy();
    expect(vacancies[0]?.id).toBeTruthy();

    const matches = await restGet<{ id: string }>(
      page,
      "matches",
      `select=id&organization_id=eq.${orgId}&candidate_id=eq.${candidates[0].id}&vacancy_id=eq.${vacancies[0].id}&limit=1`,
    );
    expect(matches[0]?.id).toBeTruthy();

    const response = await page.request.post(`${SUPABASE_URL}/functions/v1/calculate-match`, {
      headers: await authHeaders(page),
      data: {
        match_id: matches[0].id,
        candidate_id: candidates[0].id,
        vacancy_id: vacancies[0].id,
      },
    });
    expect(response.ok(), `calculate-match faalde: ${await response.text()}`).toBeTruthy();

    const updatedMatches = await restGet<{
      match_score: number | null;
      match_reasoning: string | null;
      match_breakdown: Json | null;
      distance_km: number | null;
      duration_min: number | null;
    }>(
      page,
      "matches",
      `select=match_score,match_reasoning,match_breakdown,distance_km,duration_min&id=eq.${matches[0].id}&limit=1`,
    );
    const match = updatedMatches[0];
    expect(match?.match_score).toBeGreaterThan(0);
    expect(match?.match_reasoning).toBeTruthy();
    expect(match?.match_breakdown).toBeTruthy();

    const distance = match.match_breakdown?.distance ?? {};
    const status = distance.status;
    expect(["ok", "missing_coords", "provider_error", "unknown"]).toContain(status);

    if (status === "ok") {
      expect(distance.durationMin ?? match.duration_min).toBeGreaterThan(0);
      expect(distance.distanceKm ?? match.distance_km).toBeGreaterThan(0);
    } else {
      const explanation = [
        match.match_reasoning,
        match.match_breakdown?.recruiterSummary,
        ...(match.match_breakdown?.missing ?? []),
      ].join(" ");
      expect(explanation).toMatch(/Reistijd|onbekend|controleren/i);
    }

    const cacheRows = await restGet<{ status: string; distance_km: number | null; duration_min: number | null }>(
      page,
      "match_distance_cache",
      `select=status,distance_km,duration_min&candidate_id=eq.${candidates[0].id}&vacancy_id=eq.${vacancies[0].id}&limit=1`,
    );
    expect(cacheRows[0]?.status).toBe(status);
  });
});
