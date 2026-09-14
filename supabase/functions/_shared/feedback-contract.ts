// Shared, dependency-free boundary for the browser and the edge function.
export const FEEDBACK_RECIPIENT = 'info@sitejob.nl';
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_SCREENSHOT_EDGE = 2560;
export const INTERNAL_FEEDBACK_ROLES = ['admin', 'intercedent', 'backoffice', 'finance'] as const;
export type FeedbackKind = 'bug' | 'idea';
export type FeedbackEmailStatus = 'pending' | 'preparing' | 'sending' | 'sent' | 'paused' | 'failed' | 'unknown';
export interface FeedbackError { at: string; name: string; message: string; stack: string; eventId?: string }
export interface FeedbackDiagnostics {
  page: string; capturedAt: string; browser: string; viewport: string;
  release: string; online: boolean; errors: FeedbackError[];
}
export interface FeedbackInput {
  id: string; kind: FeedbackKind; title: string; description: string; steps: string; expected: string;
  diagnostics: FeedbackDiagnostics; screenshot: string | null;
}
export interface FeedbackReceipt {
  id: string; number: number; email_status: FeedbackEmailStatus;
  screenshot_path: string | null; has_screenshot: boolean;
}
export interface FeedbackReport extends FeedbackReceipt {
  kind: FeedbackKind; title: string; description: string; steps: string; expected: string;
  reporter_name: string; reporter_email: string; organization_id: string;
  submitted_by: string; created_at: string; diagnostics: FeedbackDiagnostics;
  email_error_code: string | null;
}

export function isFeedbackUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Diagnostics are deliberately a small allowlist, never application state / request bodies.
export function scrubFeedbackText(value: unknown, max = 1000): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 20000)
    .replace(/https?:\/\/[^\s)"'<>]+/gi, (url) => {
      try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '[URL]'; }
    })
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[TOKEN]')
    .replace(/\b(?:password|wachtwoord|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/gi, '[IBAN]')
    .replace(/(?:\+31[\s-]?|0)[1-9](?:[\s-]?\d){8}\b/g, '[TEL]')
    .replace(/\b\d{9}\b/g, '[BSN]')
    .slice(0, max);
}

export function feedbackPage(value: unknown): string {
  if (typeof value !== 'string') return '/';
  let path: string;
  try { path = new URL(value, 'https://app.invalid').pathname; } catch { return '/'; }
  // Public links can contain secrets in the path. Only a main-app route is useful here.
  if (/^\/(?:onboarding|contract\/sign|profiel|match\/reageer|match-response|baan\/interesse|portaal|klantportaal|superadmin)(?:\/|$)/i.test(path)) return '/[afgeschermd]';
  return scrubFeedbackText(path, 400);
}

export function sanitizeFeedbackDiagnostics(value: unknown): FeedbackDiagnostics {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string, max = 200) => scrubFeedbackText(v[key], max);
  const errors = Array.isArray(v.errors) ? v.errors.slice(-5).map((entry) => {
    const e = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    return {
      at: scrubFeedbackText(e.at, 40), name: scrubFeedbackText(e.name, 80),
      message: scrubFeedbackText(e.message, 500), stack: scrubFeedbackText(e.stack, 3000),
      ...(typeof e.eventId === 'string' && /^[a-f0-9]{32}$/i.test(e.eventId) ? { eventId: e.eventId } : {}),
    };
  }) : [];
  return {
    page: feedbackPage(v.page), capturedAt: text('capturedAt', 40), browser: text('browser', 400),
    viewport: text('viewport', 40), release: text('release', 120), online: v.online === true, errors,
  };
}

export function validateFeedbackInput(value: unknown): FeedbackInput {
  if (!value || typeof value !== 'object') throw new Error('Ongeldige melding.');
  const v = value as Record<string, unknown>;
  if (!isFeedbackUuid(v.id)) throw new Error('Ongeldig meldingsnummer.');
  if (v.kind !== 'bug' && v.kind !== 'idea') throw new Error('Kies een bug of verbeteridee.');
  const field = (key: string, label: string, max: number, required = false) => {
    if (typeof v[key] !== 'string' || (v[key] as string).length > max) throw new Error(`${label}: maximaal ${max} tekens.`);
    const result = (v[key] as string).trim();
    if (required && result.length < 3) throw new Error(`Vul ${label.toLowerCase()} in (minimaal 3 tekens).`);
    return result;
  };
  const title = field('title', 'Onderwerp', 160, true);
  const description = field('description', 'Omschrijving', 5000, true);
  const steps = field('steps', 'Stappen', 3000);
  const expected = field('expected', 'Verwacht resultaat', 2000);
  if (v.screenshot !== null && (typeof v.screenshot !== 'string' || v.screenshot.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4)) {
    throw new Error('Het screenshot is te groot (maximaal 2 MB).');
  }
  const diagnostics = sanitizeFeedbackDiagnostics(v.diagnostics);
  if (v.kind === 'idea') diagnostics.errors = [];
  return { id: v.id, kind: v.kind, title, description, steps: v.kind === 'bug' ? steps : '', expected: v.kind === 'bug' ? expected : '', diagnostics, screenshot: v.screenshot as string | null };
}

export function decodeFeedbackScreenshot(base64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error('Ongeldig screenshot.');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length > MAX_SCREENSHOT_BYTES || bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('Gebruik een PNG-screenshot van maximaal 2 MB.');
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > MAX_SCREENSHOT_EDGE || height > MAX_SCREENSHOT_EDGE) throw new Error('Het screenshot is te groot.');
  return bytes;
}

export function feedbackReceiptMessage(receipt: FeedbackReceipt): string {
  const prefix = `Melding #${receipt.number} is opgeslagen.`;
  if (receipt.email_status === 'sent') return `${prefix} De e-mail is verstuurd naar ${FEEDBACK_RECIPIENT}.`;
  if (receipt.email_status === 'paused') return `${prefix} De e-mail staat als concept klaar omdat uitgaande e-mail is gepauzeerd.`;
  if (receipt.email_status === 'failed') return `${prefix} De e-mail kon nog niet worden verstuurd. Je kunt het opnieuw proberen.`;
  return `${prefix} De e-mailbezorging is nog niet bevestigd. De melding is terug te vinden bij SiteJob.`;
}
