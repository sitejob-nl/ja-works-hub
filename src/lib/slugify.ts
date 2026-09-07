// Combining diacritics (U+0300–U+036F): na NFD-normalisatie staan accenten los
// van hun letter en kunnen ze weg, zodat "Vergunning é" → "vergunning_e".
const DIACRITICS_RE = /[\u0300-\u036f]/g;

/** Menselijke naam → stabiele sleutel (`Inventarisatie-formulier` → `inventarisatie_formulier`). */
export const slugify = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
