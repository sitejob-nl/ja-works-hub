import { createContext } from 'react';

export type PlatformLanguage = 'nl' | 'en';

export interface TranslationContextValue {
  language: PlatformLanguage;
  setLanguage: (language: PlatformLanguage) => void;
}

export const TranslationContext = createContext<TranslationContextValue | undefined>(undefined);
