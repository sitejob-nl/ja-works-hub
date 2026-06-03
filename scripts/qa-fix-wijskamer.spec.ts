import { test, expect, Page, Locator } from "@playwright/test";
import * as fs from "node:fs";
import { ensureLoggedIn } from "./e2e-helpers";

// READ-ONLY verificatie van de "Wijs kamer toe"-fix. Geen mutaties: nooit op
// "Toewijzen" klikken. We inspecteren alleen de Pand/Kamer-dropdowns en maken
// screenshots als bewijs.

const CANDIDATE_ID = "80ff1802-9d06-4dce-b7e9-2c9c504f48e8"; // Elena Popescu (geen huisvesting)
const SHOT = "/tmp/qa-shots";
const REPORT = "/tmp/qa-fix-report.md";

function log(line: string) {
  fs.appendFileSync(REPORT, line + "\n");
}

// Vind de SelectTrigger (Radix combobox) die direct na een Label-tekst staat.
function triggerForLabel(page: Page, label: string): Locator {
  return page.locator(`label:has-text("${label}")`).locator("xpath=following::*[@role='combobox'][1]").first();
}

async function readTriggerState(trigger: Locator) {
  const exists = (await trigger.count()) > 0;
  if (!exists) return { exists, disabled: null as boolean | null, text: null as string | null };
  const dataDisabled = await trigger.getAttribute("data-disabled");
  const ariaDisabled = await trigger.getAttribute("aria-disabled");
  const domDisabled = await trigger.isDisabled().catch(() => false);
  const disabled = dataDisabled !== null || ariaDisabled === "true" || domDisabled;
  const text = (await trigger.innerText().catch(() => "")).trim();
  return { exists, disabled, text };
}

// Open een Radix Select. Gebruik dispatchEvent als gewone click hangt (Radix
// SelectTrigger heeft soms actionability-issues door pointer-event capture).
async function openSelect(page: Page, trigger: Locator) {
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click({ timeout: 3000, force: true }).catch(async () => {
    await trigger.dispatchEvent("pointerdown").catch(() => {});
    await trigger.dispatchEvent("pointerup").catch(() => {});
    await trigger.dispatchEvent("click").catch(() => {});
  });
  await page.locator("[role='listbox']").first().waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
}

// Lees opties via evaluateAll (geen auto-retry-wait → kan niet hangen).
async function readOptionTexts(page: Page): Promise<string[]> {
  return page
    .locator("[role='listbox'] [role='option']")
    .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()).filter(Boolean))
    .catch(() => [] as string[]);
}

async function readEmptyMsg(page: Page): Promise<string | null> {
  return page
    .locator("[role='listbox'] .text-muted-foreground")
    .evaluateAll((els) => els.map((e) => (e.textContent || "").trim()).filter(Boolean))
    .then((arr) => (arr.length ? arr.join(" | ") : null))
    .catch(() => null);
}

async function pickOption(page: Page, re: RegExp) {
  await page
    .locator("[role='listbox'] [role='option']")
    .filter({ hasText: re })
    .first()
    .click({ timeout: 4000, force: true });
}

async function closePopover(page: Page) {
  if ((await page.locator("[role='listbox']").count()) > 0) {
    await page.keyboard.press("Escape");
    await page.locator("[role='listbox']").first().waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
  }
}

test("Wijs kamer toe — datum-onafhankelijke kamerlijst (READ-ONLY)", async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOT, { recursive: true });

  await ensureLoggedIn(page);

  // Stap 2: open Elena → Huisvesting-tab
  await page.goto(`/kandidaten/${CANDIDATE_ID}?tab=huisvesting`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const assignBtn = page.getByRole("button", { name: /Wijs kamer toe/i });
  await expect(assignBtn, "Knop 'Wijs kamer toe' moet zichtbaar zijn").toBeVisible({ timeout: 15000 });

  // Stap 3: open Sheet
  await assignBtn.click();
  await expect(page.getByText("Kamer toewijzen", { exact: false })).toBeVisible();
  const dateInput = page.locator("input[type='date']");
  const dateVal = await dateInput.inputValue().catch(() => "");

  const pandTrigger = triggerForLabel(page, "Pand");
  const pandState = await readTriggerState(pandTrigger);

  await openSelect(page, pandTrigger);
  await page.screenshot({ path: `${SHOT}/02-pand-open-geen-datum.png`, fullPage: false });
  const pandOpts1 = await readOptionTexts(page);
  const pandEmpty1 = await readEmptyMsg(page);
  await closePopover(page);

  const slotGone = pandState.disabled === false && !/datum/i.test(pandState.text || "");
  const eindhovenNoDate = pandOpts1.some((o) => /Demo Huisvesting Eindhoven|Demostraat/i.test(o));

  log("\n### Stap 3 — Sheet geopend, GEEN datum");
  log(`- Check-in datum bij openen: "${dateVal}" (verwacht leeg)`);
  log(`- Pand-select disabled: ${pandState.disabled} (verwacht false)`);
  log(`- Pand-trigger tekst/placeholder: "${pandState.text}" (verwacht "Selecteer pand", NIET "kies eerst een datum")`);
  log(`- Pand-opties zonder datum: ${JSON.stringify(pandOpts1)}`);
  if (pandEmpty1) log(`- Pand empty-msg: "${pandEmpty1}"`);
  log(`- VERDICT 'geen slot meer' (Pand direct bruikbaar, geen datum-placeholder): ${slotGone ? "PASS" : "FAIL"}`);

  log("\n### Stap 4 — Vandaag/geen datum → Kamer 1 niet beschikbaar");
  log(`- 'Demo Huisvesting Eindhoven' in Pand-lijst zonder datum: ${eindhovenNoDate}`);
  if (!eindhovenNoDate) {
    log("- Pand afwezig (enige kamer = Kamer 1, bezet t/m 2026-07-15) → Kamer 1 NIET beschikbaar: PASS");
  } else {
    await openSelect(page, pandTrigger);
    await pickOption(page, /Demo Huisvesting Eindhoven|Demostraat/i);
    const kamerTrigger = triggerForLabel(page, "Kamer");
    await openSelect(page, kamerTrigger);
    const kOpts = await readOptionTexts(page);
    await closePopover(page);
    const k1 = kOpts.some((o) => /Kamer 1\b/.test(o));
    log(`- Kamer-opties zonder datum: ${JSON.stringify(kOpts)}`);
    log(`- 'Kamer 1' selecteerbaar zonder datum: ${k1} → ${k1 ? "FAIL (zou bezet moeten zijn)" : "PASS"}`);
  }

  // Stap 5: vul datum 2026-07-15
  log("\n### Stap 5 — Check-in datum = 2026-07-15");
  await dateInput.fill("2026-07-15");
  await page.waitForTimeout(700);

  await openSelect(page, pandTrigger);
  await page.screenshot({ path: `${SHOT}/03-pand-open-2026-07-15.png`, fullPage: false });
  const pandOpts2 = await readOptionTexts(page);
  await closePopover(page);
  const eindhovenFuture = pandOpts2.some((o) => /Demo Huisvesting Eindhoven|Demostraat/i.test(o));
  log(`- Pand-opties op 2026-07-15: ${JSON.stringify(pandOpts2)}`);
  log(`- 'Demo Huisvesting Eindhoven' in Pand-lijst op 2026-07-15: ${eindhovenFuture} (verwacht true)`);

  let kamer1Future = false;
  let kamerLabel = "";
  let kamerOptions: string[] = [];
  if (eindhovenFuture) {
    await openSelect(page, pandTrigger);
    await pickOption(page, /Demo Huisvesting Eindhoven|Demostraat/i);
    await page.waitForTimeout(300);
    const kamerTrigger = triggerForLabel(page, "Kamer");
    await openSelect(page, kamerTrigger);
    kamerOptions = await readOptionTexts(page);
    await page.screenshot({ path: `${SHOT}/04-kamer-open-2026-07-15.png`, fullPage: false });
    await closePopover(page);
    const match = kamerOptions.find((o) => /Kamer 1\b/.test(o));
    kamer1Future = !!match;
    kamerLabel = match || "";
  }
  log(`- Kamer-opties op 2026-07-15 (pand Eindhoven): ${JSON.stringify(kamerOptions)}`);
  log(`- 'Kamer 1' selecteerbaar op 2026-07-15: ${kamer1Future} (label: "${kamerLabel}") → ${kamer1Future ? "PASS" : "FAIL"}`);

  // Stap 6: NIET toewijzen. Sluit de Sheet met Escape.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  log("\n### Stap 6 — Sheet gesloten, GEEN toewijzing uitgevoerd (read-only).");

  expect(slotGone, "Pand-select moet direct bruikbaar zijn zonder datum").toBeTruthy();
  expect(eindhovenNoDate, "Demo Huisvesting Eindhoven mag NIET in lijst zonder datum (Kamer 1 bezet)").toBeFalsy();
  expect(eindhovenFuture, "Demo Huisvesting Eindhoven moet in lijst op 2026-07-15").toBeTruthy();
  expect(kamer1Future, "Kamer 1 moet selecteerbaar zijn op 2026-07-15").toBeTruthy();
});
