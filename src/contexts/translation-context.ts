import { createContext } from 'react';

export type PlatformLanguage = 'nl' | 'en' | 'pl' | 'ro';

export interface TranslationContextValue {
  language: PlatformLanguage;
  isTranslating: boolean;
  setLanguage: (language: PlatformLanguage) => void;
}

export const TranslationContext = createContext<TranslationContextValue | undefined>(undefined);
