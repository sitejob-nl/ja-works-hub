// src/components/whatsapp/DateSeparator.tsx
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { nl } from 'date-fns/locale';

interface DateSeparatorProps {
  date: string;
}

export function DateSeparator({ date }: DateSeparatorProps) {
  const parsed = parseISO(date);
  let label: string;

  if (isToday(parsed)) {
    label = 'Vandaag';
  } else if (isYesterday(parsed)) {
    label = 'Gisteren';
  } else {
    label = format(parsed, 'd MMMM yyyy', { locale: nl });
  }

  return (
    <div className="flex justify-center my-3">
      <span className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">
        {label}
      </span>
    </div>
  );
}
