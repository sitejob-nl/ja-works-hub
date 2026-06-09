import { AlertTriangle, Briefcase, CalendarDays, Car, CheckCircle2, ClipboardCheck, Clock3, HelpCircle, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import WorkHistoryTimeline from '@/components/candidates/WorkHistoryTimeline';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type WorkEntry = { bedrijf: string; functie: string; periode: string; duur_maanden: number; kernactiviteiten?: string[] };
type Gap = { periode: string; duur_maanden: number; mogelijke_verklaring: string };

type ScreeningAnswer = {
  asked?: boolean;
  notes?: string | null;
};

type CandidateMatchContextProps = {
  candidate?: any | null;
  compact?: boolean;
  className?: string;
};

const SCREENING_STATUS: Record<string, { label: string; className: string }> = {
  niet_gestart: { label: 'Screening niet gestart', className: 'bg-muted text-muted-foreground border-0' },
  in_gesprek: { label: 'Screening in gesprek', className: 'bg-blue-100 text-blue-700 border-0' },
  concept_opgeslagen: { label: 'Screening concept', className: 'bg-amber-100 text-amber-800 border-0' },
  afgerond: { label: 'Screening afgerond', className: 'bg-stat-green/10 text-stat-green border-0' },
  afgekeurd: { label: 'Screening afgekeurd', className: 'bg-red-100 text-red-700 border-0' },
};

const RESULT_LABEL: Record<string, { label: string; className: string }> = {
  goedgekeurd: { label: 'Goedgekeurd', className: 'bg-stat-green/10 text-stat-green border-0' },
  afgekeurd: { label: 'Afgekeurd', className: 'bg-red-100 text-red-700 border-0' },
  niet_gescreend: { label: 'Niet gescreend', className: 'bg-muted text-muted-foreground border-0' },
};

const PATTERN_LABEL: Record<string, string> = {
  oplopend: 'Oplopende werkhistorie',
  stabiel: 'Stabiele werkhistorie',
  dalend: 'Dalende werkhistorie',
  wisselend: 'Wisselende werkhistorie',
};

const STEP_GROUPS = [
  {
    title: 'Mobiliteit',
    icon: Car,
    keys: ['drivers_license_type', 'own_car', 'housing_preference'],
  },
  {
    title: 'Werkprofiel',
    icon: Briefcase,
    keys: ['experience_summary', 'education_certificates', 'countries_worked'],
  },
  {
    title: 'Beschikbaarheid',
    icon: CalendarDays,
    keys: ['availability_date', 'salary_wish', 'overtime_shifts', 'desired_stay'],
  },
  {
    title: 'Persoonlijke context',
    icon: MessageSquare,
    keys: ['family_context', 'motivation_future', 'personal_risks'],
  },
  {
    title: 'Besluit',
    icon: ClipboardCheck,
    keys: ['critical_unknowns', 'next_action'],
  },
];

const ANSWER_LABELS: Record<string, string> = {
  drivers_license_type: 'Rijbewijs',
  own_car: 'Eigen auto',
  housing_preference: 'Huisvesting',
  experience_summary: 'Ervaring',
  education_certificates: 'Opleiding/certificaten',
  countries_worked: 'Landen gewerkt',
  availability_date: 'Beschikbaarheid bevestigd',
  salary_wish: 'Salarisindicatie',
  overtime_shifts: 'Overwerk/ploegen',
  desired_stay: 'Gewenste verblijfsduur',
  family_context: 'Familie/context',
  motivation_future: 'Motivatie',
  personal_risks: 'Aandachtspunten',
  critical_unknowns: 'Kritieke onbekenden',
  next_action: 'Volgende actie',
};

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const asArray = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? value.filter(Boolean) as T[] : [];

const noteText = (answer?: ScreeningAnswer | null) => String(answer?.notes ?? '').trim();

const getScreening = (candidate?: any | null) => asObject(candidate?.screening_data);
const getAnswers = (candidate?: any | null) => asObject(getScreening(candidate).answers) as Record<string, ScreeningAnswer>;
const getAnalysis = (candidate?: any | null) => asObject(candidate?.ai_analysis);
const getWorkHistory = (candidate?: any | null) => asObject(getAnalysis(candidate).werkhistorie);
const getEmployers = (candidate?: any | null) => asArray<WorkEntry>(getWorkHistory(candidate).werkgevers);
const getGaps = (candidate?: any | null) => asArray<Gap>(getWorkHistory(candidate).gaten);

const getAvailability = (candidate?: any | null) => {
  const screening = getScreening(candidate);
  const structured = asObject(screening.availability);
  return {
    availableFrom: String(candidate?.available_from ?? structured.available_from ?? '').trim(),
    availableUntil: String(candidate?.available_until ?? structured.available_until ?? '').trim(),
    arrivalDate: String(candidate?.arrival_date ?? structured.arrival_date ?? '').trim(),
    notes: String(candidate?.availability_notes ?? '').trim(),
  };
};

const dateOrDash = (date?: string | null) => date ? formatDate(date) : null;

const getScreeningStatusMeta = (candidate?: any | null) => {
  const screening = getScreening(candidate);
  const status = String(screening.status ?? (candidate?.screened_at ? 'afgerond' : '')).trim();
  if (!status) return null;
  return SCREENING_STATUS[status] ?? { label: status.replaceAll('_', ' '), className: 'bg-muted text-muted-foreground border-0' };
};

const getResultMeta = (candidate?: any | null) => {
  const result = String(getScreening(candidate).result ?? '').trim();
  if (!result) return null;
  return RESULT_LABEL[result] ?? { label: result.replaceAll('_', ' '), className: 'bg-muted text-muted-foreground border-0' };
};

const getAnsweredCount = (answers: Record<string, ScreeningAnswer>) =>
  Object.values(answers).filter((answer) => answer?.asked || noteText(answer)).length;

const hasContext = (candidate?: any | null) => {
  if (!candidate) return false;
  if (getEmployers(candidate).length > 0) return true;
  if (Object.keys(getScreening(candidate)).length > 0 || candidate.screened_at) return true;
  if (candidate.available_from || candidate.available_until || candidate.arrival_date) return true;
  if (candidate.ai_summary || candidate.availability_notes) return true;
  return false;
};

const CandidateMatchContext = ({ candidate, compact = false, className }: CandidateMatchContextProps) => {
  if (!hasContext(candidate)) return null;

  const screening = getScreening(candidate);
  const answers = getAnswers(candidate);
  const workHistory = getWorkHistory(candidate);
  const employers = getEmployers(candidate);
  const gaps = getGaps(candidate);
  const statusMeta = getScreeningStatusMeta(candidate);
  const resultMeta = getResultMeta(candidate);
  const availability = getAvailability(candidate);
  const answeredCount = getAnsweredCount(answers);
  const summary = String(screening.summary ?? candidate?.ai_summary ?? '').trim();
  const professionalRating = String(asObject(screening.professional).rating ?? '').replaceAll('_', ' ');
  const professionalNotes = String(asObject(screening.professional).notes ?? '').trim();
  const riskLevel = String(asObject(screening.personal).risk_level ?? '').replaceAll('_', ' ');
  const personalNotes = String(asObject(screening.personal).notes ?? '').trim();
  const totalYears = typeof workHistory.totale_werkervaring_jaren === 'number' ? workHistory.totale_werkervaring_jaren : undefined;
  const pattern = String(workHistory.patroon ?? '').trim();

  if (compact) {
    return (
      <div className={cn('rounded-md border bg-muted/20 p-2 space-y-2', className)}>
        <div className="flex flex-wrap gap-1.5">
          {totalYears != null && (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <Briefcase className="h-3 w-3" /> {totalYears} jaar ervaring
            </Badge>
          )}
          {pattern && <Badge variant="outline" className="text-[11px]">{PATTERN_LABEL[pattern] ?? pattern}</Badge>}
          {statusMeta && <Badge className={cn('text-[11px]', statusMeta.className)}>{statusMeta.label}</Badge>}
          {resultMeta && <Badge className={cn('text-[11px]', resultMeta.className)}>{resultMeta.label}</Badge>}
          {availability.availableFrom && (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <CalendarDays className="h-3 w-3" /> Vanaf {dateOrDash(availability.availableFrom)}
            </Badge>
          )}
        </div>
        {employers.length > 0 && (
          <WorkHistoryTimeline
            werkgevers={employers}
            gaten={gaps}
            totaleJaren={totalYears}
            compact
          />
        )}
        {summary && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {employers.length > 0 && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Werkhistorie uit AI-dossier</p>
            {pattern && <Badge variant="outline">{PATTERN_LABEL[pattern] ?? pattern}</Badge>}
          </div>
          <WorkHistoryTimeline werkgevers={employers} gaten={gaps} totaleJaren={totalYears} />
          <div className="grid gap-2 sm:grid-cols-2">
            {employers.slice(0, 6).map((entry, index) => (
              <div key={`${entry.bedrijf}-${entry.periode}-${index}`} className="rounded-md border bg-background p-2 text-sm">
                <p className="font-medium">{entry.functie || 'Functie onbekend'}</p>
                <p className="text-muted-foreground">{entry.bedrijf || 'Werkgever onbekend'} - {entry.periode || 'periode onbekend'}</p>
                {entry.kernactiviteiten?.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">{entry.kernactiviteiten.slice(0, 3).join(', ')}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-md border bg-muted/20 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-medium">Screeningresultaten</p>
          {statusMeta && <Badge className={cn('text-xs', statusMeta.className)}>{statusMeta.label}</Badge>}
          {resultMeta && <Badge className={cn('text-xs', resultMeta.className)}>{resultMeta.label}</Badge>}
          {answeredCount > 0 && (
            <Badge variant="outline" className="gap-1 text-xs">
              <CheckCircle2 className="h-3 w-3" /> {answeredCount} punten vastgelegd
            </Badge>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-background p-2 text-xs">
            <p className="text-muted-foreground">Beschikbaar vanaf</p>
            <p className="font-medium">{dateOrDash(availability.availableFrom) ?? 'Onbekend'}</p>
          </div>
          <div className="rounded-md border bg-background p-2 text-xs">
            <p className="text-muted-foreground">Beschikbaar tot</p>
            <p className="font-medium">{dateOrDash(availability.availableUntil) ?? 'Open'}</p>
          </div>
          <div className="rounded-md border bg-background p-2 text-xs">
            <p className="text-muted-foreground">Aankomst/check-in</p>
            <p className="font-medium">{dateOrDash(availability.arrivalDate) ?? 'Onbekend'}</p>
          </div>
        </div>

        {summary ? (
          <div className="rounded-md border bg-background p-3">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Recruiter-samenvatting</p>
            <p className="text-sm">{summary}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nog geen uitgebreide screening-samenvatting vastgelegd.</p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {STEP_GROUPS.map((group) => {
            const items = group.keys
              .map((key) => ({ key, label: ANSWER_LABELS[key] ?? key, value: noteText(answers[key]) }))
              .filter((item) => item.value);
            if (items.length === 0) return null;
            const Icon = group.icon;
            return (
              <div key={group.title} className="rounded-md border bg-background p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {group.title}
                </p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.key} className="text-sm">
                      <p className="font-medium">{item.label}</p>
                      <p className="text-muted-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {(professionalRating && professionalRating !== 'niet beoordeeld') || professionalNotes || (riskLevel && riskLevel !== 'niet beoordeeld') || personalNotes ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" /> Professionele beoordeling
              </p>
              {professionalRating && professionalRating !== 'niet beoordeeld' && <Badge variant="outline" className="mb-2">{professionalRating}</Badge>}
              {professionalNotes ? <p className="text-sm text-muted-foreground">{professionalNotes}</p> : <p className="text-sm text-muted-foreground">Geen vakinhoudelijke notities.</p>}
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" /> Persoonlijk risico
              </p>
              {riskLevel && riskLevel !== 'niet beoordeeld' && <Badge variant="outline" className="mb-2">{riskLevel}</Badge>}
              {personalNotes ? <p className="text-sm text-muted-foreground">{personalNotes}</p> : <p className="text-sm text-muted-foreground">Geen persoonlijke notities.</p>}
            </div>
          </div>
        ) : null}

        {!statusMeta && !resultMeta && !answeredCount && !summary && (
          <div className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm text-muted-foreground">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Screening is nog niet als callflow vastgelegd. Gebruik dit als belvraag voordat je de match doorzet.
          </div>
        )}

        {screening.updated_at && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> Laatst bijgewerkt: {formatDate(String(screening.updated_at))}
          </p>
        )}
      </div>
    </div>
  );
};

export default CandidateMatchContext;
