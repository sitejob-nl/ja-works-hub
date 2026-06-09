import { AlertTriangle, Briefcase, CalendarClock, CheckCircle2, MapPin, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ReadinessState = 'ready' | 'warning' | 'missing';

type VacancyReadinessItem = {
  key: string;
  label: string;
  detail: string;
  state: ReadinessState;
  action: 'details' | 'matches' | 'enrich';
  icon: typeof CheckCircle2;
};

const stateMeta: Record<ReadinessState, { className: string; iconClassName: string }> = {
  ready: { className: 'border-emerald-200 bg-emerald-50 text-emerald-900', iconClassName: 'text-emerald-600' },
  warning: { className: 'border-amber-200 bg-amber-50 text-amber-900', iconClassName: 'text-amber-600' },
  missing: { className: 'border-red-200 bg-red-50 text-red-900', iconClassName: 'text-red-600' },
};

const isPastDate = (date?: string | null) =>
  Boolean(date && new Date(date) < new Date(new Date().toDateString()));

const VacancyReadinessStrip = ({
  vacancy,
  matchCount = 0,
  onDetails,
  onMatches,
  onEnrich,
}: {
  vacancy: any;
  matchCount?: number;
  onDetails: () => void;
  onMatches: () => void;
  onEnrich: () => void;
}) => {
  const hasRequirements = (vacancy.required_skills ?? []).length > 0 || (vacancy.required_certifications ?? []).length > 0;
  const openSpots = Math.max(0, Number(vacancy.required_count ?? 0) - Number(vacancy.filled_count ?? 0));
  const hasLocation = Boolean(vacancy.location);
  const hasStart = Boolean(vacancy.start_date || vacancy.start_date_text);
  const company = vacancy.companies as any;
  const hasClientContact = Boolean(company?.email || company?.phone);

  const items: VacancyReadinessItem[] = [
    {
      key: 'requirements',
      label: 'Eisen',
      detail: hasRequirements ? `${(vacancy.required_skills ?? []).length} skills, ${(vacancy.required_certifications ?? []).length} certificaten` : 'Maak matchbaar',
      state: hasRequirements ? 'ready' : 'missing',
      action: hasRequirements ? 'details' : 'enrich',
      icon: Briefcase,
    },
    {
      key: 'spots',
      label: 'Open plekken',
      detail: `${openSpots} open van ${vacancy.required_count ?? 0}`,
      state: openSpots > 0 ? 'warning' : 'ready',
      action: 'matches',
      icon: Users,
    },
    {
      key: 'start',
      label: 'Start',
      detail: vacancy.start_date_text || (vacancy.start_date ? new Date(vacancy.start_date).toLocaleDateString('nl-NL') : 'Onbekend'),
      state: !hasStart ? 'missing' : isPastDate(vacancy.start_date) && vacancy.status === 'open' ? 'warning' : 'ready',
      action: 'details',
      icon: CalendarClock,
    },
    {
      key: 'location',
      label: 'Locatie',
      detail: hasLocation ? vacancy.location : 'Ontbreekt',
      state: hasLocation ? 'ready' : 'warning',
      action: 'details',
      icon: MapPin,
    },
    {
      key: 'matches',
      label: 'Matchvoorraad',
      detail: `${matchCount} lopende matches`,
      state: matchCount > 0 ? 'ready' : 'warning',
      action: 'matches',
      icon: CheckCircle2,
    },
    {
      key: 'client',
      label: 'Opdrachtgever',
      detail: hasClientContact ? 'Contact bekend' : 'Contact checken',
      state: hasClientContact ? 'ready' : 'warning',
      action: 'details',
      icon: Briefcase,
    },
  ];

  const runAction = (action: VacancyReadinessItem['action']) => {
    if (action === 'matches') onMatches();
    else if (action === 'enrich') onEnrich();
    else onDetails();
  };

  return (
    <section aria-label="Vacature vervulstatus" className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Vervulstatus vacature</h2>
          <p className="text-xs text-muted-foreground">Maak de vacature matchbaar en volg de volgende actie.</p>
        </div>
        {items.some((item) => item.state === 'missing') ? (
          <AlertTriangle className="h-4 w-4 text-red-600" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => {
          const Icon = item.icon;
          const meta = stateMeta[item.state];
          return (
            <Button
              key={item.key}
              type="button"
              variant="outline"
              onClick={() => runAction(item.action)}
              className={cn('h-auto justify-start gap-2 rounded-md border p-3 text-left', meta.className)}
            >
              <Icon className={cn('h-4 w-4 shrink-0', meta.iconClassName)} />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{item.label}</span>
                <span className="block truncate text-[11px] opacity-80">{item.detail}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
};

export default VacancyReadinessStrip;
