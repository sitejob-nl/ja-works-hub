import { createContext } from 'react';

export type PlatformLanguage = 'nl' | 'en';

export interface TranslationContextValue {
  language: PlatformLanguage;
  isTranslating: boolean;
  setLanguage: (language: PlatformLanguage) => void;
  toggleLanguage: () => void;
}

export const TranslationContext = createContext<TranslationContextValue | undefined>(undefined);
