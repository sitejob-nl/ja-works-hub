import { expect, type Page, test } from "@playwright/test";
import { ensureLoggedIn, getAccessToken, SUPABASE_ANON, SUPABASE_URL } from "./e2e-helpers";

const stripGeneratedAvailabilityNotes = (notes?: string | null) =>
  String(notes ?? "")
    .split("\n")
    .filter((line) => !/^\s*(Beschikbaar vanaf|Beschikbaar tot|Aankomst\/check-in):/i.test(line))
    .join("\n")
    .trim();

async function findCandidateWithPinnedNotes(page: Page) {
  const token = await getAccessToken(page);
  if (!token || !SUPABASE_ANON) return null;

  const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
  };

  for (const filter of ["notes=not.is.null", "availability_notes=not.is.null"]) {
    const response = await page.request.get(
      `${SUPABASE_URL}/rest/v1/candidates?select=id,notes,availability_notes&${filter}&limit=1`,
      { headers },
    );
    if (!response.ok()) continue;
    const rows = await response.json();
    const candidate = Array.isArray(rows)
      ? rows.find((row) => String(row.notes ?? "").trim() || stripGeneratedAvailabilityNotes(row.availability_notes))
      : null;
    if (candidate) return candidate as { id: string; notes?: string | null; availability_notes?: string | null };
  }

  return null;
}

test.describe("Kandidaatnotities", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test("profiel- en beschikbaarheidsnotities staan zichtbaar onder Notities", async ({ page }) => {
    const candidate = await findCandidateWithPinnedNotes(page);
    if (!candidate) test.skip(true, "Geen QA-kandidaat met profiel- of beschikbaarheidsnotities gevonden");
    const availabilityNotes = stripGeneratedAvailabilityNotes(candidate.availability_notes);

    await page.goto(`/kandidaten/${candidate.id}?tab=notities`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tab", { name: "Notities" })).toHaveAttribute("data-state", "active");

    if (candidate.notes?.trim()) {
      await expect(page.getByText("Profielnotities", { exact: true })).toBeVisible();
    }
    if (availabilityNotes) {
      await expect(page.getByText("Beschikbaarheidsnotities", { exact: true })).toBeVisible();
    }
  });
});
