// B21: central mapper that turns raw Supabase / Postgres / Auth errors into plain
// Dutch messages, so users never see technical strings (RLS violations, SQLSTATE,
// "duplicate key value violates unique constraint", "JWT expired", etc).
//
// Usage: toast.error(getErrorMessage(err)) instead of toast.error(err.message).
// Intentional, already-Dutch, human messages are passed through unchanged.

type AnyError = unknown;

function extract(err: AnyError): { code?: string; message: string } {
  if (!err) return { message: '' };
  if (typeof err === 'string') return { message: err };
  const e = err as any;
  const code = e.code ?? (typeof e.status === 'number' ? String(e.status) : undefined);
  const message = e.message ?? e.error_description ?? e.error ?? e.details ?? String(e);
  return { code, message: typeof message === 'string' ? message : String(message) };
}

const TECHNICAL = /(_{2,})|constraint|violates|pg_|relation\s|column\s|syntax|sqlstate|stack|undefined is not|cannot read|null pointer|0x[0-9a-f]+/i;

export function getErrorMessage(err: AnyError, fallback = 'Er ging iets mis. Probeer het later opnieuw.'): string {
  const { code, message } = extract(err);
  const m = message.toLowerCase();

  // Postgres SQLSTATE / PostgREST / HTTP status codes
  switch (code) {
    case '23505': return 'Dit bestaat al — er is al een record met deze gegevens.';
    case '23503': return 'Dit kan niet: er zijn nog gekoppelde gegevens.';
    case '23502': return 'Een verplicht veld ontbreekt.';
    case '23514': return 'De ingevoerde waarde is niet toegestaan.';
    case '42501': return 'Je hebt geen rechten voor deze actie.';
    case '401':
    case 'PGRST301': return 'Je sessie is verlopen. Log opnieuw in.';
    case '403': return 'Je hebt geen rechten voor deze actie.';
    case '429': return 'Te veel verzoeken. Probeer het zo opnieuw.';
  }

  // Message heuristics (codes are not always present)
  if (m.includes('row-level security') || m.includes('permission denied') || m.includes('not authorized') || m.includes('onvoldoende rechten')) {
    return 'Je hebt geen rechten voor deze actie.';
  }
  if (m.includes('duplicate key') || m.includes('already exists')) return 'Dit bestaat al — er is al een record met deze gegevens.';
  if (m.includes('violates foreign key')) return 'Dit kan niet: er zijn nog gekoppelde gegevens.';
  if (m.includes('violates not-null') || m.includes('null value in column')) return 'Een verplicht veld ontbreekt.';
  if (m.includes('jwt') && m.includes('expired')) return 'Je sessie is verlopen. Log opnieuw in.';
  if (m.includes('invalid login credentials')) return 'Ongeldige inloggegevens. Probeer het opnieuw.';
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('fetch failed') || m.includes('load failed')) {
    return 'Geen verbinding. Controleer je internet en probeer opnieuw.';
  }

  // Pass through short, already-human (likely intentional Dutch) messages.
  if (message && message.length > 0 && message.length < 120 && !TECHNICAL.test(message)) {
    return message;
  }
  return fallback;
}
