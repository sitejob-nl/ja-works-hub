import { expect, test } from "@playwright/test";
import { ensureLoggedIn } from "./e2e-helpers";

// READ-ONLY inspectie van date-aware kamer-beschikbaarheid.
// Klikt NOOIT op "Toewijzen" en muteert geen data — leest enkel dropdown-inhoud.

const CANDIDATE_ID = "80ff1802-9d06-4dce-b7e9-2c9c504f48e8"; // Elena Popescu
const TARGET_PROPERTY = "Demo Huisvesting Eindhoven";
const TARGET_ROOM = "Kamer 1";

async function openHousingTabAndSheet(page: import("@playwright/test").Page) {
  await page.goto(`/kandidaten/${CANDIDATE_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Naar de Huisvesting-tab
  const housingTab = page.getByRole("tab", { name: "Huisvesting" });
  await expect(housingTab, "Huisvesting-tab moet zichtbaar zijn").toBeVisible({ timeout: 20_000 });
  await housingTab.click();

  // De knop "Wijs kamer toe" is alleen zichtbaar als er GEEN actieve huisvesting is.
  const assignBtn = page.getByRole("button", { name: "Wijs kamer toe" });
  await expect(assignBtn, "Knop 'Wijs kamer toe' moet zichtbaar zijn (kandidaat zonder huisvesting)").toBeVisible({
    timeout: 15_000,
  });
  await assignBtn.click();

  // Sheet open
  await expect(page.getByRole("heading", { name: "Kamer toewijzen" })).toBeVisible();
}

// Geeft de zichtbare opties van een (geopende) Radix Select-listbox terug.
async function readSelectOptions(page: import("@playwright/test").Page): Promise<string[]> {
  const options = page.getByRole("option");
  await page.waitForTimeout(300);
  const count = await options.count();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push((await options.nth(i).innerText()).trim());
  }
  return out;
}

test("date-aware kamer-beschikbaarheid (read-only)", async ({ page }) => {
  await ensureLoggedIn(page);
  await openHousingTabAndSheet(page);

  const evidence: Record<string, unknown> = {};

  // ---- Flow-volgorde + disabled states (geen datum gekozen) ----
  const checkInInput = page.locator('input[type="date"]').first();
  await expect(checkInInput, "Check-in datum input moet bestaan").toBeVisible();

  const propertyTrigger = page.getByRole("combobox").first();
  // Volgorde van labels in de sheet
  const labels = await page.locator("label").allInnerTexts();
  evidence.labelOrder = labels;

  // Pand-trigger disabled + placeholder "Kies eerst een datum"
  const propertyDisabledBefore = await propertyTrigger.isDisabled();
  const propertyPlaceholder = (await propertyTrigger.innerText()).trim();
  evidence.propertyDisabledBeforeDate = propertyDisabledBefore;
  evidence.propertyPlaceholder = propertyPlaceholder;

  // Kamer-trigger (2e combobox in de sheet body) disabled
  const roomTrigger = page.getByRole("combobox").nth(1);
  const roomDisabledBefore = await roomTrigger.isDisabled();
  const roomPlaceholder = (await roomTrigger.innerText()).trim();
  evidence.roomDisabledBeforeDate = roomDisabledBefore;
  evidence.roomPlaceholder = roomPlaceholder;

  await page.screenshot({ path: "/tmp/qa-fase2b-01-initial.png", fullPage: true });

  // ===== DATUM 2026-06-20 (voor uitcheck): Kamer 1 mag NIET selecteerbaar zijn =====
  await checkInInput.fill("2026-06-20");
  await page.waitForTimeout(800); // query 'assignable-units' + recompute

  const propDisabledAfter0620 = await propertyTrigger.isDisabled();
  evidence.propertyDisabledAfter_0620 = propDisabledAfter0620;

  await propertyTrigger.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/qa-fase2b-02-property-0620.png", fullPage: true });
  const props0620 = await readSelectOptions(page);
  evidence.propertyOptions_0620 = props0620;

  // Bevat de pandlijst het doelpand? Zo ja: open kamers en check op Kamer 1.
  let room1Visible0620 = false;
  let rooms0620: string[] = [];
  const targetPropOpt0620 = page.getByRole("option", { name: TARGET_PROPERTY });
  const targetPropPresent0620 = (await targetPropOpt0620.count()) > 0;
  evidence.targetPropertyPresent_0620 = targetPropPresent0620;
  if (targetPropPresent0620) {
    await targetPropOpt0620.first().click();
    await page.waitForTimeout(400);
    await roomTrigger.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/qa-fase2b-03-rooms-0620.png", fullPage: true });
    rooms0620 = await readSelectOptions(page);
    room1Visible0620 = rooms0620.some((r) => r.startsWith(TARGET_ROOM));
    // sluit kamer-listbox
    await page.keyboard.press("Escape");
  } else {
    // pand niet in lijst => kamer per definitie niet selecteerbaar; sluit listbox
    await page.keyboard.press("Escape");
  }
  evidence.rooms_0620 = rooms0620;
  evidence.room1Selectable_0620 = room1Visible0620;

  // ===== DATUM 2026-07-15 (op uitcheck): Kamer 1 moet WEL selecteerbaar zijn =====
  // reset eerst pand-keuze door datum te wijzigen (component reset propertyId/unitId on date change)
  await checkInInput.fill("2026-07-15");
  await page.waitForTimeout(800);

  await propertyTrigger.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/qa-fase2b-04-property-0715.png", fullPage: true });
  const props0715 = await readSelectOptions(page);
  evidence.propertyOptions_0715 = props0715;

  const targetPropOpt0715 = page.getByRole("option", { name: TARGET_PROPERTY });
  const targetPropPresent0715 = (await targetPropOpt0715.count()) > 0;
  evidence.targetPropertyPresent_0715 = targetPropPresent0715;

  let room1Visible0715 = false;
  let rooms0715: string[] = [];
  if (targetPropPresent0715) {
    await targetPropOpt0715.first().click();
    await page.waitForTimeout(400);
    await roomTrigger.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/qa-fase2b-05-rooms-0715.png", fullPage: true });
    rooms0715 = await readSelectOptions(page);
    room1Visible0715 = rooms0715.some((r) => r.startsWith(TARGET_ROOM));
    await page.keyboard.press("Escape");
  } else {
    await page.keyboard.press("Escape");
  }
  evidence.rooms_0715 = rooms0715;
  evidence.room1Selectable_0715 = room1Visible0715;

  // sluit de sheet zonder iets op te slaan
  await page.keyboard.press("Escape");

  // Dump alle bewijs als JSON zodat de runner-output het rapport voedt.
  console.log("QA_EVIDENCE_JSON=" + JSON.stringify(evidence, null, 2));

  // Soft expectations (falen blokkeren niet de evidence-dump; alles staat al gelogd)
  expect.soft(room1Visible0620, "Kamer 1 mag op 2026-06-20 NIET selecteerbaar zijn").toBe(false);
  expect.soft(room1Visible0715, "Kamer 1 moet op 2026-07-15 WEL selecteerbaar zijn").toBe(true);
});
