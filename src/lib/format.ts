import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { nl } from 'date-fns/locale';

export const formatDate = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return format(parseISO(date), 'dd-MM-yyyy', { locale: nl });
  } catch {
    return '—';
  }
};

export const formatDateTime = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return format(parseISO(date), 'dd-MM-yyyy HH:mm', { locale: nl });
  } catch {
    return '—';
  }
};

export const formatRelativeTime = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return formatDistanceToNow(parseISO(date), { addSuffix: true, locale: nl });
  } catch {
    return '—';
  }
};

export const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds) return '—';
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min} min ${sec} sec`;
};

export const formatEUR = (amount: number | null | undefined): string => {
  if (amount == null) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
};
