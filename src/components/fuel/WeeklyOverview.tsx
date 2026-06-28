import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { isoDate } from '@/lib/fuel-analysis';
import { endOfWeek, format, startOfWeek, subWeeks } from 'date-fns';
import { FlagCard } from './FlagCard';

export const WeeklyOverview = ({ weekStart, weekEnd, onWeekStartChange, transactions, allFlags, openFlags, onReview, onSaveNote }: {
  weekStart: string;
  weekEnd: string;
  onWeekStartChange: (value: string) => void;
  transactions: any[];
  allFlags: any[];
  openFlags: any[];
  onReview: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
}) => {
  const weekOptions = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 8 }, (_, index) => {
      const start = subWeeks(base, index);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      return { value: isoDate(start), label: `${format(start, 'dd-MM-yyyy')} t/m ${format(end, 'dd-MM-yyyy')}` };
    });
  }, []);
  const greenCount = Math.max(0, transactions.length - allFlags.length);
  const reviewedFlags = allFlags.filter(t => t.reviewed).length;
  const redCount = allFlags.filter(t => t.flag_over_capacity || t.flag_multiple_same_day).length;
  const orangeCount = Math.max(0, allFlags.length - redCount);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 pb-5 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarDays className="h-4 w-4 text-stat-blue" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Wekelijks Q8-overzicht</h2>
                <p className="text-sm text-muted-foreground">
                  Groen blijft uit de werklijst; alleen open oranje/rode afwijkingen staan hieronder.
                </p>
              </div>
            </div>
            <Select value={weekStart} onValueChange={onWeekStartChange}>
              <SelectTrigger className="w-full md:w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {weekOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <WeeklyStat label="Periode" value={`${formatDate(weekStart)} - ${formatDate(weekEnd)}`} />
            <WeeklyStat label="Groen automatisch door" value={greenCount.toString()} tone="green" />
            <WeeklyStat label="Oranje" value={orangeCount.toString()} tone={orangeCount > 0 ? 'orange' : 'green'} />
            <WeeklyStat label="Rood" value={redCount.toString()} tone={redCount > 0 ? 'red' : 'green'} />
            <WeeklyStat label="Afgehandeld" value={reviewedFlags.toString()} />
          </div>
        </CardContent>
      </Card>

      {openFlags.length === 0 ? (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-5 pb-5 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-700" />
            <p className="text-sm font-medium">Geen openstaande Q8-afwijkingen voor deze week.</p>
          </CardContent>
        </Card>
      ) : (
        openFlags.map(t => (
          <FlagCard
            key={t.id}
            t={t}
            onReview={() => onReview(t.id)}
            onSaveNote={(note) => onSaveNote(t.id, note)}
          />
        ))
      )}
    </div>
  );
};

const WeeklyStat = ({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'orange' | 'red' }) => {
  const toneClass = {
    default: '',
    green: 'border-green-200 bg-green-50 text-green-800',
    orange: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-destructive/30 bg-destructive/5 text-destructive',
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
};
