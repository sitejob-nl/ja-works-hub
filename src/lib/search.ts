/**
 * Accent-insensitief zoeken: strip diacrieten + lowercase ("José" -> "jose").
 *
 * Spiegelt de gegenereerde DB-kolom `candidates.search_unaccent`, zodat een zoekterm
 * uit de UI en de waarde in de database hetzelfde genormaliseerd zijn. Gebruik deze
 * samen met `.ilike('search_unaccent', ...)`; die kolom bevat naam, stad, e-mail en
 * telefoon aan elkaar, dus een volledige naam ("milan kowalski") matcht ook — wat
 * niet lukt als je los op first_name en last_name zoekt.
 */
export const foldAccents = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Haalt tekens weg die de PostgREST-filtersyntax breken. */
export const sanitizeSearchTerm = (value: string): string => value.replace(/[%,()]/g, ' ').trim();
