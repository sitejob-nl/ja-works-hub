// Haalt een leesbare foutmelding uit een Supabase Edge Function-fout.
//
// Edge functions geven hun fout meestal als JSON in de response-body
// ({ error, details, message }), maar supabase-js verpakt een non-2xx-response in een
// FunctionsHttpError waarvan `error.message` enkel "Edge Function returned a non-2xx
// status code" is. De echte melding zit in `error.context` (een Response, of een object
// met een `body`). Deze helper pakt die uit zodat de gebruiker ziet wát er misging i.p.v.
// een generieke "Er ging iets mis".
export const extractFunctionErrorMessage = async (
  error: unknown,
  fallbackMessage = 'Er ging iets mis',
): Promise<string> => {
  const fallback = error instanceof Error && error.message ? error.message : fallbackMessage;
  const context = (error as { context?: unknown })?.context;

  let payload: unknown = null;
  if (context instanceof Response) {
    const text = await context.clone().text().catch(() => '');
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
  } else if (context && typeof context === 'object' && 'body' in context) {
    payload = (context as { body?: unknown }).body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = { error: payload };
      }
    }
  }

  if (payload && typeof payload === 'object') {
    const body = payload as { error?: unknown; details?: unknown; message?: unknown };
    const message = body.error ?? body.message;
    if (typeof message === 'string' && message.trim()) {
      const details = typeof body.details === 'string' && body.details.trim()
        ? ` (${body.details.trim().slice(0, 180)})`
        : '';
      return `${message}${details}`;
    }
  }

  return fallback;
};
