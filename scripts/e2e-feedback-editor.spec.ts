import { test, expect, type Page } from '@playwright/test';
test.setTimeout(60000);
test.skip(!process.env.DEMO_ORG_EMAIL || !process.env.DEMO_ORG_PASSWORD, 'Demo credentials required');

async function openEditor(page: Page) {
  await page.goto('/login');
  await expect(page.getByText('Log in om verder te gaan', { exact: true })).toBeVisible();
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL!);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD!);
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  const skip = page.getByRole('button', { name: 'Overslaan', exact: true });
  const button = page.getByRole('button', { name: 'Bug of idee melden', exact: true });
  await expect(skip.or(button).first()).toBeVisible({ timeout: 15000 });
  if (await skip.isVisible()) await skip.click();
  await button.click();
}

test('circle annotations can be undone and are included with redactions in the submitted PNG', async ({ page }) => {
  let submitted: any;
  await page.route('**/functions/v1/feedback', async route => {
    if (route.request().postDataJSON().action === 'my-notifications') return route.fulfill({ json: { reports: [] } });
    submitted = route.request().postDataJSON().report;
    await route.fulfill({ json: { id: submitted.id, number: 128, email_status: 'sent', has_screenshot: true, screenshot_path: 'private/qa.png' } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await page.getByLabel('Onderwerp *', { exact: true }).fill('Omcirkelde knop werkt niet');
  await page.getByLabel('Wat gaat er mis? *', { exact: true }).fill('Zie de rode cirkel in de screenshot.');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 400, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Screenshot uploaden', { exact: true }).setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const canvas = page.getByRole('img', { name: 'Voorbeeld van het screenshot' });
  const confirmed = page.getByLabel('Ik heb het screenshot gecontroleerd', { exact: false });
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    // The displayed canvas has a 1px border; points are mapped like the pointer handler.
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 5 }); await page.mouse.up();
  };
  const topPixel = () => canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(280, 60, 1, 1).data]);
  await confirmed.check();
  await page.getByRole('button', { name: 'Omcirkelen', exact: true }).click();
  await drag(.5, .3, .9, .9);
  await expect(confirmed).not.toBeChecked();
  await expect.poll(topPixel).toEqual([220, 38, 38, 255]);
  await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
  await expect.poll(topPixel).toEqual([255, 255, 255, 255]);
  await drag(.5, .3, .9, .9);
  await expect.poll(topPixel).toEqual([220, 38, 38, 255]);
  await page.getByRole('button', { name: 'Zwartmaken', exact: true }).click();
  await drag(.05, .1, .25, .4);
  await confirmed.check();
  await page.getByRole('button', { name: 'Melding versturen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Melding #128 is opgeslagen' })).toBeVisible();
  const pixels = await page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return [[280, 60], [280, 120], [50, 40]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  }, submitted.screenshot);
  expect(pixels).toEqual([[220, 38, 38, 255], [255, 255, 255, 255], [0, 0, 0, 255]]);
});

test('capture waits past a fading picker, hides the form and stops sharing; cancel retains the draft', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { cancel: false, stopped: false, hidden: false, options: null as any };
    (window as any).__captureQA = state;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async (options: any) => {
      state.options = options;
      if (state.cancel) throw new DOMException('Cancelled', 'NotAllowedError');
      const c = document.createElement('canvas'); c.width = 400; c.height = 200;
      const ctx = c.getContext('2d')!, start = performance.now();
      const draw = () => {
        const settled = performance.now() - start > 500;
        ctx.fillStyle = settled ? '#16a34a' : '#dc2626'; ctx.fillRect(0, 0, 400, 200);
        if (settled) state.hidden = !document.querySelector('[role="dialog"]');
      };
      draw(); const interval = setInterval(draw, 30);
      const stream = c.captureStream(30);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { state.stopped = true; clearInterval(interval); stop(); };
      }
      return stream;
    } });
  });
  await page.route('**/functions/v1/feedback', route => {
    expect(route.request().postDataJSON().action).toBe('my-notifications');
    return route.fulfill({ json: { reports: [] } });
  });
  await openEditor(page);
  await page.getByLabel('Onderwerp *', { exact: true }).fill('Mijn concept blijft behouden');
  await page.getByRole('button', { name: 'Scherm vastleggen', exact: true }).click();
  const canvas = page.getByRole('img', { name: 'Voorbeeld van het screenshot' });
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(30, 30, 1, 1).data])).toEqual([22, 163, 74, 255]);
  const result = await page.evaluate(() => (window as any).__captureQA);
  expect(result).toMatchObject({ stopped: true, hidden: true, options: { audio: false, preferCurrentTab: true, video: { displaySurface: 'browser' } } });
  await page.evaluate(() => { (window as any).__captureQA.cancel = true; });
  await page.getByRole('button', { name: 'Scherm vastleggen', exact: true }).click();
  await expect(page.getByLabel('Onderwerp *', { exact: true })).toHaveValue('Mijn concept blijft behouden');
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scherm vastleggen', exact: true })).toBeEnabled();
});
