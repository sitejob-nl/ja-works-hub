import { sanitizeFeedbackDiagnostics, type FeedbackDiagnostics, type FeedbackError } from '../../supabase/functions/_shared/feedback-contract';

let owner: string | undefined;
let recent: FeedbackError[] = [];
export function setFeedbackDiagnosticsOwner(userId?: string) {
  if (owner !== userId) { recent = []; owner = userId; }
}
export function rememberFeedbackError(error: Error, eventId?: string) {
  if (!owner) return;
  const cleaned = sanitizeFeedbackDiagnostics({ errors: [{
    at: new Date().toISOString(), name: error.name, message: error.message,
    stack: error.stack, eventId,
  }] }).errors[0];
  recent = [...recent.slice(-4), cleaned];
}
export function collectFeedbackDiagnostics(): FeedbackDiagnostics {
  return sanitizeFeedbackDiagnostics({
    page: window.location.pathname,
    capturedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    viewport: `${window.innerWidth} × ${window.innerHeight} (${window.devicePixelRatio}x)`,
    release: import.meta.env.VITE_APP_RELEASE || 'onbekend',
    online: navigator.onLine,
    errors: recent.filter(e => Date.now() - Date.parse(e.at) < 10 * 60 * 1000),
  });
}
