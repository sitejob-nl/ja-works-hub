import { describe, expect, it } from 'vitest';
import { decodeFeedbackScreenshot, feedbackPage, sanitizeFeedbackDiagnostics, scrubFeedbackText, validateFeedbackInput } from '../../supabase/functions/_shared/feedback-contract';

const input = () => ({ id: '11111111-1111-4111-8111-111111111111', kind: 'bug', title: 'Opslaan mislukt', description: 'Na opslaan verschijnt een fout', steps: 'Klik opslaan', expected: 'Gegevens bewaard', screenshot: null, diagnostics: { page: '/kandidaten?token=secret#secret', errors: [{ message: 'Fout' }] } });
describe('feedback input boundary', () => {
  it('only keeps diagnostic fields needed for support and strips URL secrets', () => {
    const result = sanitizeFeedbackDiagnostics({ page: '/kandidaten?email=private@example.nl#token', cookies: 'secret', body: { bsn: '123456789' }, errors: [{ name: 'TypeError', message: 'email=private@example.nl password=hunter2 Bearer secret-token', stack: 'at https://app.nl/app.js?access_token=secret#fragment:1:2', token: 'secret' }] });
    expect(result.page).toBe('/kandidaten');
    expect(JSON.stringify(result)).not.toMatch(/private@example|hunter2|secret|123456789/);
    expect(result.errors[0].name).toBe('TypeError');
    expect(result.errors[0].stack).toBe('at https://app.nl/app.js');
    expect(result).not.toHaveProperty('body');
  });
  it('masks sensitive numbers and rejects public token paths', () => {
    expect(scrubFeedbackText('NL91ABNA0417164300 0612345678 123456789')).not.toMatch(/NL91|0612345678|123456789/);
    expect(feedbackPage('/onboarding/private-token')).toBe('/[afgeschermd]');
    expect(feedbackPage('/profiel/private-token')).toBe('/[afgeschermd]');
  });
  it('caps recent errors and does not attach errors or reproduction steps to ideas', () => {
    expect(sanitizeFeedbackDiagnostics({ errors: Array(30).fill({ message: 'x'.repeat(5000) }) }).errors).toHaveLength(5);
    const result = validateFeedbackInput({ ...input(), kind: 'idea' });
    expect(result.diagnostics.errors).toEqual([]);
    expect(result.steps).toBe('');
    expect(result.expected).toBe('');
  });
  it('rejects missing titles, wrong kinds, client IDs and oversized fields', () => {
    for (const changes of [{ id: 'bad' }, { kind: 'email' }, { title: ' ' }, { description: 'x'.repeat(5001) }, { screenshot: 42 }]) {
      expect(() => validateFeedbackInput({ ...input(), ...changes })).toThrow();
    }
    expect(validateFeedbackInput({ ...input(), to: 'attacker@example.nl', organization_id: 'other' })).not.toHaveProperty('to');
  });
  it('validates screenshot signature, bounds and size instead of trusting a MIME label', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
    expect(decodeFeedbackScreenshot(png).length).toBeGreaterThan(33);
    expect(() => decodeFeedbackScreenshot(btoa('<svg onload="alert(1)"/>'))).toThrow();
    const bytes = decodeFeedbackScreenshot(png);
    new DataView(bytes.buffer).setUint32(16, 10000);
    expect(() => decodeFeedbackScreenshot(btoa(String.fromCharCode(...bytes)))).toThrow();
  });
});
