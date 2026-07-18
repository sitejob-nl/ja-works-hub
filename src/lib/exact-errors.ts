import { extractFunctionErrorMessage } from './functionError';

// De Exact-edge-functions geven een machineleesbare code terug (zie
// _shared/exact-helpers.ts → classifyExactProviderError). Zonder vertaling kreeg
// de gebruiker letterlijk "exact_provider_error" in een toast te zien.
const EXACT_ERROR_MESSAGES: Record<string, string> = {
  needs_reauth:
    'De Exact-koppeling is verlopen. Koppel opnieuw via Instellingen → Koppelingen.',
  exact_tenant_not_found:
    'De Exact-koppeling bestaat niet meer bij SiteJob Connect. Ontkoppel en koppel opnieuw via Instellingen → Koppelingen.',
  exact_division_scope_error:
    'Geen toegang tot deze Exact-administratie. Controleer welke administratie gekoppeld is.',
  exact_provider_forbidden:
    'Exact Online weigerde de aanvraag (onvoldoende rechten). Controleer de koppeling in Instellingen.',
  exact_provider_unavailable:
    'Exact Online is tijdelijk niet bereikbaar (of de limiet is bereikt). Probeer het over een minuut opnieuw.',
  exact_provider_error:
    'Exact Online gaf een fout terug op deze aanvraag.',
};

/**
 * Leest de fout van een Exact-edge-function uit en vertaalt bekende foutcodes naar
 * begrijpelijke tekst. Onbekende fouten worden ongewijzigd doorgegeven.
 */
export async function toExactErrorMessage(
  error: unknown,
  fallback = 'Er ging iets mis met Exact Online',
): Promise<string> {
  const raw = (await extractFunctionErrorMessage(error, fallback)).trim();
  const friendly = EXACT_ERROR_MESSAGES[raw];
  if (friendly) return friendly;

  // De detail-tekst kan achter de code hangen; probeer nog een prefix-match.
  const matched = Object.keys(EXACT_ERROR_MESSAGES).find((code) => raw.startsWith(code));
  return matched ? EXACT_ERROR_MESSAGES[matched] : raw;
}
