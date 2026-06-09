import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MatchBreakdown } from '@/lib/matching';
import { cn } from '@/lib/utils';
import { componentLabel, scoreBadgeClass } from '@/lib/match-presenters';

type MatchInspectorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  breakdown?: MatchBreakdown | null;
  candidateQuality?: number | null;
  vacancyContext?: Array<{ label: string; value?: string | number | null }>;
  action?: ReactNode;
};

const Section = ({ title, tone, items }: { title: string; tone: string; items?: string[] }) => {
  if (!items?.length) return null;
  return (
    <div>
      <p className={`mb-1 text-xs font-medium uppercase ${tone}`}>{title}</p>
      <ul className={`list-inside list-disc space-y-0.5 text-sm ${tone}`}>
        {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
};

const MatchInspectorDialog = ({
  open,
  onOpenChange,
  title,
  description,
  breakdown,
  candidateQuality,
  vacancyContext = [],
  action,
}: MatchInspectorDialogProps) => {
  const components = Object.entries(breakdown?.componentScores ?? {}) as [string, number][];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            {breakdown && (
              <Badge className={cn('text-xs', scoreBadgeClass[breakdown.label])}>
                {breakdown.matchPercent}% match
              </Badge>
            )}
            {typeof candidateQuality === 'number' && (
              <Badge variant="outline" className="text-xs" title="Algemene AI-kwaliteitsscore, los van deze vacature">
                Dossier {candidateQuality}/100
              </Badge>
            )}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {!breakdown ? (
          <p className="text-sm text-muted-foreground">Geen score-opbouw beschikbaar voor deze match.</p>
        ) : (
          <div className="space-y-4">
            {vacancyContext.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <p className="mb-2 text-sm font-medium">Vacaturecontext</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {vacancyContext.map((item) => (
                    <div key={item.label}>
                      <span className="text-muted-foreground">{item.label}:</span> {item.value ?? '—'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {breakdown.reasoning && <p className="text-sm text-muted-foreground">{breakdown.reasoning}</p>}

            {components.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">Score-opbouw</p>
                {components.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3 text-sm">
                    <span>{componentLabel[key] ?? key}</span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(Number(value))} pt</span>
                  </div>
                ))}
              </div>
            )}

            <Section title="Harde blokkades" tone="text-red-600" items={breakdown.hardBlocks} />
            <Section title="Pluspunten" tone="text-emerald-700" items={breakdown.positives} />
            <Section title="Onbekend / controleren" tone="text-amber-700" items={breakdown.missing} />

            {(breakdown.bonuses ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {breakdown.bonuses.map((bonus, index) => (
                  <Badge key={`${bonus}-${index}`} variant="secondary" className="text-[10px]">{bonus}</Badge>
                ))}
              </div>
            )}

            {((breakdown.skillMatches ?? []).length > 0 || (breakdown.certificationMatches ?? []).length > 0) && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Matchende skills & certificaten</p>
                <div className="flex flex-wrap gap-1">
                  {(breakdown.skillMatches ?? []).map((skill) => <Badge key={`skill-${skill}`} variant="outline" className="text-xs">{skill}</Badge>)}
                  {(breakdown.certificationMatches ?? []).map((cert) => <Badge key={`cert-${cert}`} variant="outline" className="text-xs">{cert}</Badge>)}
                </div>
              </div>
            )}

            {(breakdown.distance?.km != null || breakdown.distance?.durationMin != null) && (
              <p className="text-xs text-muted-foreground">
                Afstand: {breakdown.distance.durationMin != null ? `${Math.round(breakdown.distance.durationMin)} min` : 'reistijd onbekend'}
                {breakdown.distance.km != null ? `, ${Math.round(breakdown.distance.km)} km` : ''}
                {breakdown.distance.status ? ` (${breakdown.distance.status})` : ''}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Sluiten</Button>
          {action}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatchInspectorDialog;
