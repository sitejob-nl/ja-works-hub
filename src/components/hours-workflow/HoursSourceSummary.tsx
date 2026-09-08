import { formatHours } from './presentation';
import type { HoursLanguage } from './types';
import type { HoursSourceInput } from './hours-day-source';

const copy = {
  nl: { title: 'Aangeleverde details', shift: 'Dienst', pause: 'Pauze', noBreaks: 'Geen pauzes', nextDay: 'volgende dag', category: 'Broncode', hours: 'uur', missing: 'Er zijn nog geen diensttijden of broncategorieën aangeleverd.' },
  en: { title: 'Reported details', shift: 'Shift', pause: 'Break', noBreaks: 'No breaks', nextDay: 'next day', category: 'Source code', hours: 'hours', missing: 'No shift times or source categories have been reported yet.' },
  pl: { title: 'Przekazane szczegóły', shift: 'Zmiana', pause: 'Przerwa', noBreaks: 'Bez przerw', nextDay: 'następny dzień', category: 'Kod źródłowy', hours: 'godz.', missing: 'Nie przekazano jeszcze godzin zmian ani kategorii źródłowych.' },
} as const;

/** Employee-visible facts only: no matrix factors, internal findings or provenance. */
export function HoursSourceSummary({ source, language = 'nl' }: { source?: HoursSourceInput | null; language?: HoursLanguage }) {
  if (!source) return null;
  const text = copy[language];
  const withDay = (time: string, offset = 0) => `${time}${offset === 1 ? ` (${text.nextDay})` : ''}`;
  return <div className="space-y-1 rounded-md bg-muted/30 p-2 text-xs" data-no-translate="true" lang={language}>
    <p className="font-medium">{text.title}</p>
    {!source.shifts?.length && !source.categories?.length && <p>{text.missing}</p>}
    {source.shifts?.map((shift, index) => <div key={index} className="space-y-1">
      <p>{text.shift} {index + 1}: {shift.start} – {withDay(shift.end, shift.endDayOffset)}</p>
      {shift.breaks.length === 0 ? <p className="text-muted-foreground">{text.noBreaks}</p> : shift.breaks.map((pause, i) => <p key={i} className="text-muted-foreground">{text.pause}: {withDay(pause.start, pause.startDayOffset)} – {withDay(pause.end, pause.endDayOffset ?? pause.startDayOffset)}</p>)}
    </div>)}
    {source.categories?.map((category, index) => <p key={index} className="break-words">{text.category} {category.sourceCode}: {formatHours(category.minutes, language)} {text.hours}</p>)}
  </div>;
}
