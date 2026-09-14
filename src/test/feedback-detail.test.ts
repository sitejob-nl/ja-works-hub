import { describe, expect, it, vi } from 'vitest';
import { readMyFeedback } from '../../supabase/functions/feedback/detail';

function fixture() {
  const row: Record<string, unknown> = { id: 'report', submitted_by: 'owner', organization_id: 'org', number: 12,
    title: 'Screenshot ontbreekt', has_screenshot: true, screenshot_path: 'org/report.png', request_hash: 'private' };
  const sign = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null });
  const bucket = vi.fn(() => ({ createSignedUrl: sign }));
  const admin = { storage: { from: bucket }, from() {
    let columns: string[] = [];
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const query = {
      select(value: string) { columns = value.split(','); return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      async maybeSingle() { return { error: null, data: filters.every(f => f(row)) ? Object.fromEntries(columns.map(c => [c, row[c]])) : null }; },
    };
    return query;
  } };
  return { row, admin, sign, bucket };
}

describe('own feedback screenshot access', () => {
  it('signs the saved attachment for five minutes without exposing internal fields', async () => {
    const { admin, sign, bucket } = fixture();
    const result = await readMyFeedback(admin, 'owner', 'org', 'report');
    expect(result?.screenshotUrl).toBe('https://storage.example/signed');
    expect(result?.report.has_screenshot).toBe(true);
    expect(bucket).toHaveBeenCalledWith('feedback-screenshots');
    expect(sign).toHaveBeenCalledWith('org/report.png', 300);
    for (const column of ['screenshot_path', 'request_hash', 'organization_id', 'submitted_by']) expect(result?.report).not.toHaveProperty(column);
  });
  it.each([['colleague', 'org', 'report'], ['owner', 'other-org', 'report'], ['owner', 'org', 'other-report']])(
    'does not sign or disclose an attachment outside scope: %s / %s / %s', async (user, org, id) => {
      const { admin, sign } = fixture();
      expect(await readMyFeedback(admin, user, org, id)).toBeNull();
      expect(sign).not.toHaveBeenCalled();
    });
  it.each([true, false])('keeps a report readable without a stored attachment (expected: %s)', async hasScreenshot => {
    const { admin, row, sign } = fixture();
    row.has_screenshot = hasScreenshot; row.screenshot_path = null;
    const result = await readMyFeedback(admin, 'owner', 'org', 'report');
    expect(result?.report.title).toBe('Screenshot ontbreekt');
    expect(result?.screenshotUrl).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });
  it.each(['response', 'network'])('keeps the report readable when storage fails: %s', async failure => {
    const { admin, sign } = fixture();
    if (failure === 'response') sign.mockResolvedValue({ data: null, error: new Error('Storage unavailable') });
    else sign.mockRejectedValue(new Error('Network unavailable'));
    const result = await readMyFeedback(admin, 'owner', 'org', 'report');
    expect(result?.report.title).toBe('Screenshot ontbreekt');
    expect(result?.screenshotUrl).toBeNull();
  });
});
