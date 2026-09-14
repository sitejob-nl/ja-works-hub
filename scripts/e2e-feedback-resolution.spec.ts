import { test, expect } from '@playwright/test';
test.setTimeout(60000);
test.skip(!process.env.DEMO_ORG_EMAIL || !process.env.DEMO_ORG_PASSWORD, 'Demo credentials required');

test('SiteJob resolves a report and its owner follows a personal bell notification', async ({ page }) => {
  const report = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', number: 126, kind: 'bug', title: 'Opslaan werkt niet',
    description: 'Synthetische bugmelding.', steps: '', expected: '', created_at: new Date().toISOString(),
    reporter_name: 'QA', reporter_email: 'qa@example.invalid', email_status: 'sent',
    status: 'open', resolution: '', resolved_at: null as string | null, resolution_revision: 0,
    resolution_read_at: null as string | null, resolution_dismissed_at: null, diagnostics: {},
  };
  let updates = 0, acknowledgements = 0;
  // Only frontend responses are mocked; the demo account has no real superadmin rights.
  await page.route('**/rest/v1/superadmins?**', route => route.fulfill({ json: { id: 'qa-ui-only' } }));
  await page.route('**/rest/v1/employee_notifications?**', route => route.fulfill({ json: [] }));
  await page.route('**/functions/v1/feedback', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'set-status') {
      expect(body).toMatchObject({ id: report.id, revision: 0, status: 'resolved', resolution: 'Opslaan werkt weer, ook op mobiel.' });
      updates++;
      Object.assign(report, { status: 'resolved', resolution: body.resolution, resolution_revision: 1, resolved_at: new Date().toISOString() });
      await route.fulfill({ json: { changed: true, status: 'resolved', resolution_revision: 1 } });
    } else if (body.action === 'detail' || body.action === 'my-detail') await route.fulfill({ json: { report, screenshotUrl: null } });
    else if (body.action === 'my-notifications') await route.fulfill({ json: { reports: report.status === 'resolved' ? [report] : [] } });
    else if (body.action === 'mine') await route.fulfill({ json: { reports: [report] } });
    else if (body.action === 'acknowledge') {
      expect(body).toMatchObject({ id: report.id, revision: 1, dismiss: false });
      acknowledgements++;
      report.resolution_read_at = new Date().toISOString();
      await route.fulfill({ json: { updated: true } });
    } else throw new Error(`Unexpected feedback action: ${body.action}`);
  });
  await page.goto(`/superadmin/feedback/${report.id}`);
  await expect(page.getByText('Beheerderspaneel — Alleen bevoegd personeel', { exact: true })).toBeVisible();
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL!);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD!);
  await page.getByRole('button', { name: 'Inloggen als Superadmin', exact: true }).click();
  await page.getByLabel('Bericht aan de melder (optioneel)', { exact: true }).fill('Opslaan werkt weer, ook op mobiel.');
  await page.getByRole('button', { name: 'Oplossen en melder informeren', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Status: Opgelost', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Melding heropenen', exact: true })).toBeVisible();
  expect(updates).toBe(1);

  await page.goto('/feedback');
  const skip = page.getByRole('button', { name: 'Overslaan', exact: true });
  const bell = page.getByRole('button', { name: 'Notificaties', exact: true });
  await expect(skip.or(bell).first()).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await bell.click();
  await page.getByRole('button').filter({ hasText: 'Bug #126 is opgelost' }).click();
  await expect(page).toHaveURL(new RegExp(`/feedback/${report.id}$`));
  await expect(page.getByRole('heading', { name: 'Terugkoppeling van SiteJob', exact: true })).toBeVisible();
  await expect(page.getByText('Opslaan werkt weer, ook op mobiel.', { exact: true })).toBeVisible();
  await expect.poll(() => acknowledgements).toBe(1);
});
