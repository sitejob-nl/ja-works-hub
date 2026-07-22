import type { PlatformLanguage } from '@/contexts/translation-context';

export interface PlatformLanguageOption {
  value: PlatformLanguage;
  /** Naam in de taal zelf — een Poolse medewerker zoekt "Polski", niet "Pools". */
  label: string;
  short: string;
  flag: string;
}

/**
 * De talen die het portaal aanbiedt. Nederlands is de bron; de rest wordt runtime
 * vertaald via DeepL (edge fn `translate-platform`). Uitbreiden betekent: hier een
 * regel toevoegen én de code opnemen in ALLOWED_TARGETS van die edge functie.
 */
export const PLATFORM_LANGUAGES: PlatformLanguageOption[] = [
  { value: 'nl', label: 'Nederlands', short: 'NL', flag: '🇳🇱' },
  { value: 'en', label: 'English', short: 'EN', flag: '🇬🇧' },
  { value: 'pl', label: 'Polski', short: 'PL', flag: '🇵🇱' },
  { value: 'ro', label: 'Română', short: 'RO', flag: '🇷🇴' },
];

export const SOURCE_LANGUAGE: PlatformLanguage = 'nl';

/** DeepL-doelcodes. Nederlands staat er niet in: dat is de bron, die vertalen we nooit. */
export const DEEPL_TARGETS: Record<Exclude<PlatformLanguage, 'nl'>, string> = {
  en: 'EN-US',
  pl: 'PL',
  ro: 'RO',
};

export function isPlatformLanguage(value: unknown): value is PlatformLanguage {
  return PLATFORM_LANGUAGES.some((item) => item.value === value);
}

export function normalizeLanguage(value: unknown): PlatformLanguage {
  return isPlatformLanguage(value) ? value : SOURCE_LANGUAGE;
}

export function languageOption(value: PlatformLanguage): PlatformLanguageOption {
  return PLATFORM_LANGUAGES.find((item) => item.value === value) ?? PLATFORM_LANGUAGES[0];
}
