import { test, expect, type Page } from '@playwright/test';
test.setTimeout(60000);

// Uses the demo login for the app shell. Every feedback request is intercepted:
// these UI tests never create live feedback or send an email.
test.skip(!process.env.DEMO_ORG_EMAIL || !process.env.DEMO_ORG_PASSWORD, 'Demo credentials required');
async function openFeedback(page: Page) {
  await page.goto('/login');
  // Verify the app before entering credentials (local ports may host other projects).
  await expect(page.getByText('Log in om verder te gaan', { exact: true })).toBeVisible();
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL!);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD!);
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  const skipTour = page.getByRole('button', { name: 'Overslaan', exact: true });
  const feedback = page.getByRole('button', { name: 'Bug of idee melden', exact: true });
  await expect(skipTour.or(feedback).first()).toBeVisible({ timeout: 15000 });
  if (await skipTour.isVisible()) await skipTour.click();
  await feedback.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('bug screenshot is reviewed, redacted and sent with technical context', async ({ page }) => {
  let submitted: any;
  await page.route('**/functions/v1/feedback', async route => {
    submitted = route.request().postDataJSON().report;
    await route.fulfill({ json: { id: submitted.id, number: 123, email_status: 'sent', screenshot_path: 'private/test.png', has_screenshot: true } });
  });
  await openFeedback(page);
  await page.getByLabel('Onderwerp *', { exact: true }).fill('Kandidaat opslaan lukt niet');
  await page.getByLabel('Wat gaat er mis? *', { exact: true }).fill('Na het opslaan zie ik een foutmelding.');
  await page.getByLabel('Wat deed je vlak daarvoor?', { exact: true }).fill('Kandidaat openen en op opslaan klikken.');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = '#dc2626'; ctx.font = '20px sans-serif'; ctx.fillText('Testgegevens verbergen', 20, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Screenshot uploaden', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const canvas = page.getByRole('img', { name: 'Voorbeeld van het screenshot' });
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Melding versturen' })).toBeDisabled();
  await page.getByRole('button', { name: 'Zwartmaken', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .025, box.y + box.height * .05);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .35, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel('Ik heb het screenshot gecontroleerd', { exact: false }).check();
  await page.getByRole('button', { name: 'Melding versturen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Melding #123 is opgeslagen' })).toBeVisible();
  expect(submitted.kind).toBe('bug');
  expect(submitted.diagnostics.browser).toContain('Chrome');
  expect(submitted.diagnostics.page).not.toContain('?');
  expect(submitted).not.toHaveProperty('organization_id');
  const pixel = await page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(30, 30, 1, 1).data];
  }, submitted.screenshot);
  expect(pixel).toEqual([0, 0, 0, 255]);
});

test('mobile idea survives a lost response and retry reuses the identical payload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const attempts: any[] = [];
  await page.route('**/functions/v1/feedback', async route => {
    attempts.push(route.request().postDataJSON().report);
    if (attempts.length === 1) await route.abort('failed');
    else await route.fulfill({ json: { id: attempts[0].id, number: 124, email_status: 'paused', screenshot_path: null, has_screenshot: false } });
  });
  await openFeedback(page);
  await page.getByRole('button', { name: 'Verbeteridee', exact: true }).click();
  await page.getByLabel('Onderwerp *', { exact: true }).fill('Sneller zoeken');
  await page.getByLabel('Wat wil je kunnen en waarom? *', { exact: true }).fill('Vacatures op meerdere locaties tegelijk zoeken.');
  await expect(page.getByLabel('Wat deed je vlak daarvoor?', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('feedback-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Melding versturen' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Onderwerp *', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Opnieuw proberen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'als concept' })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(attempts[0].diagnostics.errors).toEqual([]);
  expect(attempts[0].screenshot).toBeNull();
});

test('superadmin detail destination survives login and renders its screenshot (mocked admin responses)', async ({ page }) => {
  // UI/routing coverage only: the real demo account gains no server permissions.
  // The intentionally blocked QA superadmin is never used or modified.
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
  await page.route('**/rest/v1/superadmins?**', route => route.fulfill({ json: { id: 'qa-ui-only' } }));
  await page.route('**/functions/v1/feedback', async route => {
    expect(route.request().postDataJSON()).toEqual({ action: 'detail', id });
    await route.fulfill({ json: {
      report: { id, number: 125, kind: 'bug', title: 'QA screenshot bekijken', description: 'Synthetische melding', steps: '', expected: '',
        reporter_name: 'QA', reporter_email: 'qa@example.invalid', created_at: '2026-09-14T09:00:00Z', email_status: 'paused',
        has_screenshot: true, screenshot_path: 'private/test.png', diagnostics: {} },
      screenshotUrl: `data:image/png;base64,${png}`,
    } });
  });
  await page.goto(`/superadmin/feedback/${id}`);
  await expect(page.getByText('Beheerderspaneel — Alleen bevoegd personeel', { exact: true })).toBeVisible();
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL!);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD!);
  await page.getByRole('button', { name: 'Inloggen als Superadmin', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/superadmin/feedback/${id}$`));
  await expect(page.getByRole('heading', { name: 'QA screenshot bekijken', exact: true })).toBeVisible();
  const image = page.getByRole('img', { name: 'Screenshot bij melding #125', exact: true });
  await expect(image).toBeVisible();
  await image.evaluate((img: HTMLImageElement) => img.decode());
  await expect(page.getByRole('button', { name: 'E-mail opnieuw proberen', exact: true })).toBeVisible();
});
