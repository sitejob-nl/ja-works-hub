import { AlertTriangle, Briefcase, CalendarClock, Car, CheckCircle2, ClipboardCheck, Languages, Mail, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ReadinessState = 'ready' | 'warning' | 'missing';

type ReadinessItem = {
  key: string;
  label: string;
  detail: string;
  state: ReadinessState;
  tab: string;
  icon: typeof CheckCircle2;
};

const stateMeta: Record<ReadinessState, { className: string; iconClassName: string }> = {
  ready: { className: 'border-emerald-200 bg-emerald-50 text-emerald-900', iconClassName: 'text-emerald-600' },
  warning: { className: 'border-amber-200 bg-amber-50 text-amber-900', iconClassName: 'text-amber-600' },
  missing: { className: 'border-red-200 bg-red-50 text-red-900', iconClassName: 'text-red-600' },
};

const statusFrom = (ready: boolean, warning = false): ReadinessState => {
  if (ready) return 'ready';
  return warning ? 'warning' : 'missing';
};

const getScreeningStatus = (candidate: any): ReadinessState => {
  const screeningStatus = (candidate.screening_data as any)?.status;
  if (screeningStatus === 'afgerond' || candidate.screened_at) return 'ready';
  if (screeningStatus === 'in_gesprek' || screeningStatus === 'concept_opgeslagen') return 'warning';
  return 'missing';
};

const CandidateReadinessStrip = ({
  candidate,
  onTabChange,
}: {
  candidate: any;
  onTabChange: (tab: string) => void;
}) => {
  const hasContact = Boolean(candidate.phone || candidate.phone_nl || candidate.email);
  const hasSkills = Array.isArray(candidate.skills) && candidate.skills.length > 0;
  const hasLanguages = Array.isArray(candidate.languages) && candidate.languages.length > 0;
  const hasAvailability = Boolean(candidate.availability_notes);
  const hasLocation = Boolean(candidate.address_city || candidate.address_postal || candidate.address_street);
  const hasLicense = candidate.has_drivers_license === true;

  const items: ReadinessItem[] = [
    {
      key: 'screening',
      label: 'Screening',
      detail: getScreeningStatus(candidate) === 'ready' ? 'Afgerond' : getScreeningStatus(candidate) === 'warning' ? 'Concept loopt' : 'Nog bellen',
      state: getScreeningStatus(candidate),
      tab: 'screening',
      icon: ClipboardCheck,
    },
    {
      key: 'contact',
      label: 'Contact',
      detail: hasContact ? 'Belbaar' : 'Telefoon/e-mail mist',
      state: statusFrom(hasContact),
      tab: 'profiel',
      icon: candidate.email ? Mail : Phone,
    },
    {
      key: 'skills',
      label: 'Werkprofiel',
      detail: hasSkills ? `${candidate.skills.length} skills` : 'Skills ontbreken',
      state: statusFrom(hasSkills),
      tab: 'profiel',
      icon: Briefcase,
    },
    {
      key: 'availability',
      label: 'Beschikbaarheid',
      detail: hasAvailability ? 'Ingevuld' : 'Nog controleren',
      state: statusFrom(hasAvailability, true),
      tab: 'screening',
      icon: CalendarClock,
    },
    {
      key: 'language',
      label: 'Talen',
      detail: hasLanguages ? candidate.languages.slice(0, 2).join(', ') : 'Onbekend',
      state: statusFrom(hasLanguages, true),
      tab: 'profiel',
      icon: Languages,
    },
    {
      key: 'mobility',
      label: 'Mobiliteit',
      detail: hasLicense ? 'Rijbewijs bekend' : 'Rijbewijs checken',
      state: statusFrom(hasLicense, true),
      tab: 'screening',
      icon: Car,
    },
    {
      key: 'location',
      label: 'Locatie',
      detail: hasLocation ? candidate.address_city ?? 'Adres bekend' : 'Adres ontbreekt',
      state: statusFrom(hasLocation, true),
      tab: 'profiel',
      icon: MapPin,
    },
  ];

  return (
    <section aria-label="Kandidaat matchbaarheid" className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Matchbaarheid kandidaat</h2>
          <p className="text-xs text-muted-foreground">Klik een signaal om de data direct aan te vullen.</p>
        </div>
        {items.some((item) => item.state !== 'ready') ? (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {items.map((item) => {
          const Icon = item.icon;
          const meta = stateMeta[item.state];
          return (
            <Button
              key={item.key}
              type="button"
              variant="outline"
              onClick={() => onTabChange(item.tab)}
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

export default CandidateReadinessStrip;
