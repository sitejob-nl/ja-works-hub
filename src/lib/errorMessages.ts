// Zet een Supabase/Postgres/JS-fout om in een begrijpelijke Nederlandse melding.
// Synchroon — bedoeld voor query/mutation-fouten (PostgrestError, Error, string).
// Voor edge-function-fouten (FunctionsHttpError met JSON-body) is er de async
// extractFunctionErrorMessage in src/lib/functionError.ts.
//
// Doel: nooit rauwe SQL/technische strings in een toast tonen, maar een mens-vriendelijke
// tekst — terwijl door de app zélf gegooide NL-meldingen ongemoeid doorkomen.

const PG_CODE_MESSAGES: Record<string, string> = {
  '23505': 'Dit bestaat al — er is al een record met deze waarde.',
  '23503': 'Dit kan niet: er zijn nog gekoppelde gegevens. Ontkoppel of verwijder die eerst.',
  '23514': 'De ingevoerde waarde is niet toegestaan.',
  '23502': 'Een verplicht veld ontbreekt.',
  '42501': 'Je hebt geen rechten voor deze actie.',
  '22P02': 'Ongeldige invoer.',
  PGRST116: 'Niet gevonden.',
  PGRST301: 'Je sessie is verlopen — log opnieuw in.',
};

function getCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { code?: unknown; error?: { code?: unknown } };
  if (typeof e.code === 'string') return e.code;
  if (e.error && typeof e.error.code === 'string') return e.error.code;
  return null;
}

function rawMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; error?: { message?: unknown } };
    if (typeof e.message === 'string') return e.message;
    if (e.error && typeof e.error.message === 'string') return e.error.message;
  }
  return '';
}

// Patronen die op een technische/SQL-fout duiden → liever de fallback dan rauw tonen.
const TECHNICAL = /constraint|syntax error|relation ".*"|column ".*"|null value in|violates|duplicate key|invalid input|operator does not|permission denied for|pg_|jsonb?|regclass/i;

export function toFriendlyError(error: unknown, fallback = 'Er ging iets mis. Probeer het opnieuw.'): string {
  if (!error) return fallback;

  const code = getCode(error);
  if (code && PG_CODE_MESSAGES[code]) return PG_CODE_MESSAGES[code];

  const raw = rawMessage(error).trim();
  const lower = raw.toLowerCase();

  if (!raw) return fallback;
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed') || lower.includes('fetch failed')) {
    return 'Geen verbinding — controleer je internet en probeer het opnieuw.';
  }
  if (lower.includes('jwt') || lower.includes('not authenticated') || lower.includes('invalid token') || lower === 'unauthorized') {
    return 'Je sessie is verlopen — log opnieuw in.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'Je hebt geen rechten voor deze actie.';
  }
  if (lower.includes('duplicate key')) return PG_CODE_MESSAGES['23505'];
  if (lower.includes('violates foreign key')) return PG_CODE_MESSAGES['23503'];

  // Technische/SQL-achtige strings niet rauw tonen; door de app gegooide NL-meldingen wél.
  if (TECHNICAL.test(raw)) return fallback;
  return raw;
}
