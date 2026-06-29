import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2, MapPin, MessageSquare, Star, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import EntityLink from '@/components/ui/entity-link';
import MatchStatusSelect from '@/components/matches/MatchStatusSelect';
import type { MatchBreakdown } from '@/lib/matching';
import { cn } from '@/lib/utils';
import { getMatchStatusMeta, getStatusAgeLabel } from '@/lib/match-status';
import { getMatchFollowupState } from '@/lib/match-followup';
import { getMatchNextActionLabel, getPrimaryMatchIssue, scoreBadgeClass, toScorePercent } from '@/lib/match-presenters';

type MatchRowProps = {
  id: string;
  status: string;
  candidate?: ({
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } & Record<string, any>) | null;
  vacancy?: ({
    id?: string | null;
    title?: string | null;
    company_name?: string | null;
    company_id?: string | null;
  } & Record<string, any>) | null;
  sourceLabel?: string | null;
  score?: number | null;
  breakdown?: MatchBreakdown | null;
  candidateQuality?: number | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  statusChangedAt?: string | null;
  createdAt?: string | null;
  interviewProposedAt?: string | null;
  interviewConfirmedAt?: string | null;
  followupDays?: number | null;
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
  onStatusChange?: (status: string) => void;
  statusDisabled?: boolean;
  onInspect?: () => void;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  hideVacancy?: boolean;
  className?: string;
};

const fullName = (c?: MatchRowProps['candidate']) =>
  [c?.first_name, c?.last_name].filter(Boolean).join(' ') || 'Kandidaat onbekend';

// Voorkomt dat klikken op een link/knop in de rij ook het detailpaneel opent.
const stop = (e: React.MouseEvent) => e.stopPropagation();

const MatchRow = ({
  id,
  status,
  candidate,
  vacancy,
  sourceLabel,
  score,
  breakdown,
  candidateQuality,
  distanceKm,
  durationMin,
  statusChangedAt,
  createdAt,
  interviewProposedAt,
  interviewConfirmedAt,
  followupDays,
  selected = false,
  onSelectChange,
  onStatusChange,
  statusDisabled = false,
  onInspect,
  primaryAction,
  secondaryActions,
  hideVacancy = false,
  className,
}: MatchRowProps) => {
  const statusMeta = getMatchStatusMeta(status);
  const scorePercent = breakdown?.matchPercent ?? toScorePercent(score);
  const scoreLabel = breakdown?.label
    ?? (typeof scorePercent === 'number' && scorePercent >= 72 ? 'groen' : typeof scorePercent === 'number' && scorePercent >= 45 ? 'oranje' : 'rood');
  const issue = getPrimaryMatchIssue(breakdown);
  const statusAge = getStatusAgeLabel(statusChangedAt, createdAt);
  const followup = getMatchFollowupState({
    status,
    statusChangedAt,
    createdAt,
    interviewProposedAt,
    interviewConfirmedAt,
    followupDays,
  });
  const nextAction = getMatchNextActionLabel(status, breakdown);
  const km = distanceKm ?? breakdown?.distance?.km ?? null;
  const mins = durationMin ?? breakdown?.distance?.durationMin ?? null;
  const skills = (breakdown?.skillMatches ?? []).slice(0, 4);
  const certs = (breakdown?.certificationMatches ?? []).slice(0, 2);

  return (
    <Card className={cn('p-3 transition-colors', selected && 'ring-1 ring-primary', className)}>
      <div className="flex items-start gap-3">
        {onSelectChange && (
          <Checkbox
            className="mt-1 shrink-0"
            checked={selected}
            onClick={stop}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
            aria-label={`Selecteer match ${fullName(candidate)}`}
          />
        )}

        {/* Klikbare rij-body -> detailpaneel met kandidaatgegevens + waarom-uitleg.
            <div role="button"> i.p.v. <button> zodat de kandidaat-deeplink (een <a>)
            er geldig in genest kan worden; klikken op de naam navigeert (stopPropagation),
            klikken elders opent het detailpaneel. */}
        <div
          role={onInspect ? 'button' : undefined}
          tabIndex={onInspect ? 0 : undefined}
          onClick={onInspect}
          onKeyDown={onInspect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInspect(); } } : undefined}
          className={cn('min-w-0 flex-1 space-y-1 text-left', onInspect && 'cursor-pointer')}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <EntityLink
              type="candidate"
              id={candidate?.id}
              className="inline-flex items-center font-medium text-foreground hover:text-stat-blue"
            >
              <User className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
              {fullName(candidate)}
            </EntityLink>
            {typeof scorePercent === 'number' && (
              <Badge className={cn('gap-1 border-0 text-[11px]', scoreBadgeClass[scoreLabel as MatchBreakdown['label']])}>
                <Star className="h-3 w-3" /> {Math.round(scorePercent)}%
              </Badge>
            )}
            {typeof candidateQuality === 'number' && (
              <Badge variant="outline" className="text-[11px]" title="Algemene AI-kwaliteitsscore, los van deze vacature">
                Dossier {candidateQuality}/100
              </Badge>
            )}
            <Badge className={cn('gap-1 text-[11px]', statusMeta.badgeClass)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.color)} /> {statusMeta.label}
            </Badge>
            {followup.level === 'warning' && (
              <Badge className="gap-1 border-0 bg-amber-100 text-amber-800 text-[11px]">
                <AlertTriangle className="h-3 w-3" /> {followup.label}
              </Badge>
            )}
            {sourceLabel && <Badge variant="outline" className="text-[10px]">{sourceLabel}</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {!hideVacancy && (vacancy?.title || vacancy?.id) && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" />
                {vacancy?.title ?? 'Vacature onbekend'}{vacancy?.company_name ? ` · ${vacancy.company_name}` : ''}
              </span>
            )}
            {(km != null || mins != null) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {mins != null ? `${Math.round(mins)} min` : 'reistijd onbekend'}{km != null ? ` · ${Math.round(km)} km` : ''}
              </span>
            )}
            {skills.map((s) => <span key={`skill-${id}-${s}`} className="rounded bg-muted px-1.5 py-0.5">{s}</span>)}
            {certs.map((c) => <span key={`cert-${id}-${c}`} className="rounded bg-muted px-1.5 py-0.5">{c}</span>)}
            {statusAge && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {statusAge}</span>}
          </div>

          {issue && (
            <p className={cn('flex items-center gap-1.5 text-xs',
              issue.tone === 'red' && 'text-red-700',
              issue.tone === 'amber' && 'text-amber-700',
              issue.tone === 'green' && 'text-emerald-700')}
            >
              {issue.tone === 'green' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
              <span className="line-clamp-1">{issue.label}</span>
            </p>
          )}
        </div>

        {/* Acties (geen detail-open) */}
        <div className="flex shrink-0 flex-col items-end gap-1.5" onClick={stop}>
          <div className="flex items-center gap-1.5">
            {onStatusChange && (
              <MatchStatusSelect
                value={status}
                onChange={onStatusChange}
                disabled={statusDisabled}
                ariaLabel={`Status wijzigen voor ${fullName(candidate)}`}
              />
            )}
            {primaryAction}
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="hidden gap-1 text-[10px] sm:inline-flex">
              <ArrowRight className="h-3 w-3" /> {nextAction}
            </Badge>
            {onInspect && (
              <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={onInspect}>
                <MessageSquare className="h-3.5 w-3.5" /> Detail
              </Button>
            )}
            {secondaryActions}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default MatchRow;
