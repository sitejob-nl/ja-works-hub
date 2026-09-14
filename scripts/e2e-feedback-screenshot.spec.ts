import { test, expect } from '@playwright/test';
test.setTimeout(60000);
test.skip(!process.env.DEMO_ORG_EMAIL || !process.env.DEMO_ORG_PASSWORD, 'Demo credentials required');

test('owner can view and renew a screenshot on mobile, including unavailable attachments', async ({ page }) => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const report = { id, number: 127, kind: 'bug', title: 'Mijn screenshot', description: 'De omschrijving blijft leesbaar.',
    created_at: new Date().toISOString(), status: 'open', has_screenshot: true };
  let reads = 0, unavailable = false, allowImage = false;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
    const context = canvas.getContext('2d')!; context.fillStyle = '#dc2626'; context.fillRect(0, 0, 400, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('**/__qa-feedback-image.png?*', route => !allowImage
    ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  await page.route('**/functions/v1/feedback', async route => {
    const action = route.request().postDataJSON().action;
    if (action === 'my-detail') {
      reads++;
      await route.fulfill({ json: { report, screenshotUrl: unavailable ? null : `/__qa-feedback-image.png?v=${reads}` } });
    } else if (action === 'my-notifications') await route.fulfill({ json: { reports: [] } });
    else throw new Error(`Unexpected feedback action: ${action}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/feedback/${id}`);
  await expect(page.getByText('Log in om verder te gaan', { exact: true })).toBeVisible();
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL!);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD!);
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  const skip = page.getByRole('button', { name: 'Overslaan', exact: true });
  const bell = page.getByRole('button', { name: 'Notificaties', exact: true });
  await expect(skip.or(bell).first()).toBeVisible({ timeout: 15000 });
  if (await skip.isVisible()) await skip.click();
  // The normal login may land on the dashboard; test the same owner deeplink afterwards.
  await page.goto(`/feedback/${id}`);
  const unavailableText = page.getByText('De screenshot kan nu niet worden geladen. Probeer het opnieuw.', { exact: true });
  await expect(unavailableText).toBeVisible();
  await expect(page.getByText(report.description, { exact: true })).toBeVisible();
  allowImage = true;
  await page.getByRole('button', { name: 'Screenshot opnieuw laden', exact: true }).click();
  const image = page.getByRole('img', { name: 'Screenshot bij melding #127', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(400);
  await expect(page.getByRole('link', { name: 'Screenshot op volledige grootte openen', exact: true })).toHaveAttribute('target', '_blank');
  const box = (await image.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  unavailable = true;
  await page.getByRole('button', { name: 'Vernieuwen', exact: true }).click();
  await expect(unavailableText).toBeVisible();
  await expect(page.getByText(report.description, { exact: true })).toBeVisible();
  report.has_screenshot = false;
  await page.getByRole('button', { name: 'Vernieuwen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bijgevoegde screenshot', exact: true })).toHaveCount(0);
});
