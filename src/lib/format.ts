import { format, parseISO } from 'date-fns';
import { nl } from 'date-fns/locale';

export const formatDate = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return format(parseISO(date), 'dd-MM-yyyy', { locale: nl });
  } catch {
    return '—';
  }
};

export const formatEUR = (amount: number | null | undefined): string => {
  if (amount == null) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
};
