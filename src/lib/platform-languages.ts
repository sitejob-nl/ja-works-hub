import type { PlatformLanguage } from '@/contexts/translation-context';

export interface PlatformLanguageOption {
  value: PlatformLanguage;
  /** Naam in de taal zelf. */
  label: string;
  short: string;
  flag: string;
}

/**
 * De talen die het portaal aanbiedt. Nederlands is de bron; de rest wordt vertaald met
 * een meegebouwd woordenboek (`src/lib/portal-dictionary.ts`). Een taal toevoegen
 * betekent: hier een regel erbij én een woordenboek aanleveren in `DICTIONARIES`.
 */
export const PLATFORM_LANGUAGES: PlatformLanguageOption[] = [
  { value: 'nl', label: 'Nederlands', short: 'NL', flag: '🇳🇱' },
  { value: 'en', label: 'English', short: 'EN', flag: '🇬🇧' },
];

export const SOURCE_LANGUAGE: PlatformLanguage = 'nl';

export function isPlatformLanguage(value: unknown): value is PlatformLanguage {
  return PLATFORM_LANGUAGES.some((item) => item.value === value);
}

export function normalizeLanguage(value: unknown): PlatformLanguage {
  return isPlatformLanguage(value) ? value : SOURCE_LANGUAGE;
}

export function languageOption(value: PlatformLanguage): PlatformLanguageOption {
  return PLATFORM_LANGUAGES.find((item) => item.value === value) ?? PLATFORM_LANGUAGES[0];
}
