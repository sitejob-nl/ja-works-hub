import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2, MessageSquare, Star, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import EntityLink from '@/components/ui/entity-link';
import CandidateMatchContext from '@/components/matches/CandidateMatchContext';
import MatchStatusSelect from '@/components/matches/MatchStatusSelect';
import type { MatchBreakdown } from '@/lib/matching';
import { cn } from '@/lib/utils';
import { getMatchStatusMeta, getStatusAgeLabel } from '@/lib/match-status';
import {
  getDecisionConfidence,
  getMatchNextActionLabel,
  getPrimaryMatchIssue,
  scoreBadgeClass,
  toScorePercent,
} from '@/lib/match-presenters';

type MatchCardProps = {
  id: string;
  status: string;
  candidate?: {
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    compliance_status?: string | null;
    available_from?: string | null;
    available_until?: string | null;
    arrival_date?: string | null;
    availability_notes?: string | null;
    ai_analysis?: unknown;
    ai_summary?: string | null;
    ai_classification?: string | null;
    ai_reliability_score?: number | null;
    screening_data?: unknown;
    screened_at?: string | null;
  } | null;
  vacancy?: {
    id?: string | null;
    title?: string | null;
    company_name?: string | null;
    company_id?: string | null;
    location?: string | null;
  } | null;
  sourceLabel?: string | null;
  score?: number | null;
  breakdown?: MatchBreakdown | null;
  candidateQuality?: number | null;
  statusChangedAt?: string | null;
  createdAt?: string | null;
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
  onStatusChange?: (status: string) => void;
  statusDisabled?: boolean;
  onInspect?: () => void;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  className?: string;
};

const fullName = (candidate?: MatchCardProps['candidate']) =>
  [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || 'Kandidaat onbekend';

const MatchCard = ({
  id,
  status,
  candidate,
  vacancy,
  sourceLabel,
  score,
  breakdown,
  candidateQuality,
  statusChangedAt,
  createdAt,
  selected = false,
  onSelectChange,
  onStatusChange,
  statusDisabled = false,
  onInspect,
  primaryAction,
  secondaryActions,
  className,
}: MatchCardProps) => {
  const statusMeta = getMatchStatusMeta(status);
  const scorePercent = breakdown?.matchPercent ?? toScorePercent(score);
  const issue = getPrimaryMatchIssue(breakdown);
  const confidence = getDecisionConfidence(breakdown);
  const statusAge = getStatusAgeLabel(statusChangedAt, createdAt);
  const nextAction = getMatchNextActionLabel(status, breakdown);
  const scoreLabel = breakdown?.label ?? (typeof scorePercent === 'number' && scorePercent >= 72 ? 'groen' : typeof scorePercent === 'number' && scorePercent >= 45 ? 'oranje' : 'rood');

  return (
    <Card className={cn('p-3 transition-colors', selected && 'ring-1 ring-primary', className)}>
      <div className="flex gap-3">
        {onSelectChange && (
          <Checkbox
            className="mt-1 shrink-0"
            checked={selected}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
            aria-label={`Selecteer match ${fullName(candidate)} ${vacancy?.title ?? ''}`}
          />
        )}

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <EntityLink type="candidate" id={candidate?.id} className="font-medium text-foreground hover:text-primary">
                  <User className="mr-1 inline h-3.5 w-3.5" />
                  {fullName(candidate)}
                </EntityLink>
                {typeof scorePercent === 'number' && (
                  <Badge className={cn('gap-1 border-0 text-[11px]', scoreBadgeClass[scoreLabel as MatchBreakdown['label']])}>
                    <Star className="h-3 w-3" /> {Math.round(scorePercent)}% match
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
                <Badge className={cn('text-[11px]', confidence.className)}>{confidence.label}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <EntityLink type="vacancy" id={vacancy?.id} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                  <Briefcase className="h-3.5 w-3.5" />
                  {vacancy?.title ?? 'Vacature onbekend'}
                </EntityLink>
                {vacancy?.company_id || vacancy?.company_name ? (
                  <EntityLink type="company" id={vacancy?.company_id} className="text-muted-foreground hover:text-primary">
                    {vacancy?.company_name ?? 'Opdrachtgever onbekend'}
                  </EntityLink>
                ) : null}
                {statusAge && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" /> {statusAge}
                  </span>
                )}
                {sourceLabel && <span>Bron: {sourceLabel}</span>}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end">
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
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-2">
              {issue && (
                <p
                  className={cn(
                    'flex items-start gap-1.5 text-xs',
                    issue.tone === 'red' && 'text-red-700',
                    issue.tone === 'amber' && 'text-amber-700',
                    issue.tone === 'green' && 'text-emerald-700',
                  )}
                >
                  {issue.tone === 'green' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span className="line-clamp-2">{issue.label}</span>
                </p>
              )}

              <div className="flex flex-wrap gap-1">
                {(breakdown?.skillMatches ?? []).slice(0, 4).map((skill) => (
                  <Badge key={`skill-${id}-${skill}`} variant="outline" className="text-xs">{skill}</Badge>
                ))}
                {(breakdown?.certificationMatches ?? []).slice(0, 2).map((cert) => (
                  <Badge key={`cert-${id}-${cert}`} variant="outline" className="text-xs">{cert}</Badge>
                ))}
                {(breakdown?.missing ?? []).slice(0, 2).map((missing) => (
                  <Badge key={`missing-${id}-${missing}`} variant="secondary" className="border-0 bg-amber-100 text-amber-800 text-xs">
                    {missing}
                  </Badge>
                ))}
              </div>

              <CandidateMatchContext candidate={candidate} compact />
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Badge variant="outline" className="gap-1 text-xs">
                <ArrowRight className="h-3 w-3" /> {nextAction}
              </Badge>
              {onInspect && (
                <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5" onClick={onInspect}>
                  <MessageSquare className="h-3.5 w-3.5" /> Waarom?
                </Button>
              )}
              {secondaryActions}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default MatchCard;
