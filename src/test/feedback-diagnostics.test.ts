import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectFeedbackDiagnostics, rememberFeedbackError, setFeedbackDiagnosticsOwner } from '@/lib/feedback-diagnostics';

afterEach(() => { setFeedbackDiagnosticsOwner(undefined); vi.useRealTimers(); });
describe('feedback session diagnostics', () => {
  it('does not carry one user’s errors into another user’s report', () => {
    setFeedbackDiagnosticsOwner('user-a');
    rememberFeedbackError(new Error('Opslaan mislukt token=secret'));
    expect(collectFeedbackDiagnostics().errors).toHaveLength(1);
    expect(collectFeedbackDiagnostics().errors[0].message).not.toContain('secret');
    setFeedbackDiagnosticsOwner('user-b');
    expect(collectFeedbackDiagnostics().errors).toEqual([]);
    setFeedbackDiagnosticsOwner(undefined);
    rememberFeedbackError(new Error('Uitgelogd'));
    expect(collectFeedbackDiagnostics().errors).toEqual([]);
  });
  it('only includes recent errors, with a bounded buffer and an exact Sentry event reference', () => {
    vi.useFakeTimers();
    setFeedbackDiagnosticsOwner('user-a');
    for (let i = 0; i < 8; i++) rememberFeedbackError(new Error(`Fout ${i}`), 'a'.repeat(32));
    const errors = collectFeedbackDiagnostics().errors;
    expect(errors).toHaveLength(5);
    expect(errors[0].message).toBe('Fout 3');
    expect(errors[0].eventId).toBe('a'.repeat(32));
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(collectFeedbackDiagnostics().errors).toEqual([]);
  });
});
