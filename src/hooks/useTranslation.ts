import { useContext } from 'react';
import { TranslationContext } from '@/contexts/translation-context';

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslation must be used within TranslationProvider');
  }
  return context;
}
