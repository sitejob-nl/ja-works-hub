import { describe, expect, it } from 'vitest';
import { acknowledgeFeedback, changeFeedbackStatus } from '../../supabase/functions/feedback/resolution';
import { validateFeedbackResolution } from '../../supabase/functions/_shared/feedback-contract';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const row: any = { id, organization_id: 'org-a', submitted_by: 'owner-a', status: 'open', resolution: '', resolution_revision: 0, resolved_at: null, resolution_read_at: null, resolution_dismissed_at: null };
  const admin = { from() {
    let patch: any;
    const filters: ((v: any) => boolean)[] = [];
    const run = () => {
      const match = filters.every(f => f(row));
      if (match && patch) Object.assign(row, patch);
      return { data: match ? { ...row } : null, error: null };
    };
    const q: any = {
      update(value: any) { patch = value; return q; }, select() { return q; },
      eq(key: string, value: any) { filters.push(v => v[key] === value); return q; },
      neq(key: string, value: any) { filters.push(v => v[key] !== value); return q; },
      is(key: string, value: any) { filters.push(v => v[key] === value); return q; },
      maybeSingle: async () => run(),
      then(resolve: any) { const r = run(); return Promise.resolve({ ...r, data: r.data ? [r.data] : [] }).then(resolve); },
    };
    return q;
  } };
  return { row, admin };
}
const resolve = { id, revision: 0, status: 'resolved', resolution: 'Opslaan werkt weer.' };

describe('personal feedback resolution', () => {
  it('atomically resolves once, and a duplicate cannot reset read/dismiss state', async () => {
    const { row, admin } = fixture();
    const results = await Promise.all([changeFeedbackStatus(admin, 'sitejob', resolve), changeFeedbackStatus(admin, 'sitejob', resolve)]);
    expect(results.map(r => r && 'changed' in r && r.changed).sort()).toEqual([false, true]);
    expect(row).toMatchObject({ status: 'resolved', resolved_by: 'sitejob', resolution_revision: 1, resolution_read_at: null });
    const resolvedAt = row.resolved_at;
    await acknowledgeFeedback(admin, 'owner-a', 'org-a', id, 1, false);
    await acknowledgeFeedback(admin, 'owner-a', 'org-a', id, 1, true);
    const readAt = row.resolution_read_at, dismissedAt = row.resolution_dismissed_at;
    await changeFeedbackStatus(admin, 'sitejob', resolve);
    expect(row.resolved_at).toBe(resolvedAt);
    expect(row.resolution_read_at).toBe(readAt);
    expect(row.resolution_dismissed_at).toBe(dismissedAt);
  });
  it('isolates acknowledgement to the authenticated owner and organization', async () => {
    const { row, admin } = fixture();
    await changeFeedbackStatus(admin, 'sitejob', resolve);
    expect(await acknowledgeFeedback(admin, 'colleague', 'org-a', id, 1, true)).toEqual({ updated: false });
    expect(await acknowledgeFeedback(admin, 'owner-a', 'org-b', id, 1, false)).toEqual({ updated: false });
    expect(row.resolution_read_at).toBeNull(); expect(row.resolution_dismissed_at).toBeNull();
  });
  it('reopening retires the notification and stale actions cannot affect a later resolution', async () => {
    const { row, admin } = fixture();
    await changeFeedbackStatus(admin, 'sitejob', resolve);
    await changeFeedbackStatus(admin, 'sitejob', { id, revision: 1, status: 'open', resolution: '' });
    expect(row).toMatchObject({ status: 'open', resolved_at: null, resolution: '', resolution_revision: 2 });
    expect(await changeFeedbackStatus(admin, 'sitejob', resolve)).toEqual({ conflict: true });
    await changeFeedbackStatus(admin, 'sitejob', { ...resolve, revision: 2, resolution: 'Ook mobiel hersteld.' });
    expect(await acknowledgeFeedback(admin, 'owner-a', 'org-a', id, 1, true)).toEqual({ updated: false });
    expect(row.resolution_dismissed_at).toBeNull();
    expect(row.resolution_revision).toBe(3);
  });
  it('does not overwrite another administrator’s explanation', async () => {
    const { row, admin } = fixture();
    await changeFeedbackStatus(admin, 'sitejob', resolve);
    expect(await changeFeedbackStatus(admin, 'other-admin', { ...resolve, resolution: 'Andere uitleg' })).toEqual({ conflict: true });
    expect(row.resolution).toBe(resolve.resolution);
  });
  it('validates status, identifier, revision and bounded explanation', () => {
    for (const patch of [{ status: 'sent' }, { id: 'invalid' }, { revision: -1 }, { revision: 0.5 }, { revision: '0' }, { resolution: 'x'.repeat(2001) }]) {
      expect(() => validateFeedbackResolution({ ...resolve, ...patch })).toThrow();
    }
    expect(validateFeedbackResolution({ ...resolve, resolution: '  Hersteld  ' }).resolution).toBe('Hersteld');
  });
});
