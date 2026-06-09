import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, CalendarDays, Euro, MapPin, Sparkles, UserPlus, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { type MatchBreakdown } from '@/lib/matching';

const scoreBadgeClass: Record<MatchBreakdown['label'], string> = {
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-yellow-100 text-yellow-700 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
};

// Reverse matching: passende OPEN vacatures voor deze kandidaat (via rank-vacancies edge fn).
const CandidateVacancyMatchesTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [minScore, setMinScore] = useState(60);
  const [includeHardBlocks, setIncludeHardBlocks] = useState(false);
  const [requireSkillSignal, setRequireSkillSignal] = useState(false);
  const [requireKnownDistance, setRequireKnownDistance] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  // Bestaande matches uitsluiten zodat we alleen nieuwe vacatures voorstellen.
  const { data: existing } = useQuery({
    queryKey: ['candidate-existing-match-vacancies', orgId, candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('matches').select('vacancy_id').eq('organization_id', orgId).eq('candidate_id', candidateId);
      if (error) throw error;
      return (data ?? []).map((m: any) => m.vacancy_id).filter(Boolean);
    },
  });

  const { data: results, isError, isFetching } = useQuery({
    queryKey: ['rank-vacancies', candidateId, (existing ?? []).length, minScore, includeHardBlocks, requireSkillSignal, requireKnownDistance],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('rank-vacancies', {
        body: {
          candidate_id: candidateId,
          exclude_vacancy_ids: existing ?? [],
          include_weak: includeHardBlocks || minScore < 45,
          criteria_options: {
            minScore,
            requireSkillSignal,
            requireKnownDistance,
          },
          limit: 75,
        },
      });
      if (error) throw error;
      return (data?.results ?? []) as any[];
    },
    enabled: !!existing,
  });

  const filtered = (results ?? []).filter((r: any) => {
    const bd = r.breakdown ?? {};
    const hasHardBlocks = (bd.hardBlocks ?? []).length > 0;
    const hasSkillSignal = (bd.skillMatches ?? []).length > 0 || (bd.certificationMatches ?? []).length > 0;
    const hasKnownDistance = bd.distance?.km != null || bd.distance?.durationMin != null;
    if ((r.score ?? 0) < minScore) return false;
    if (!includeHardBlocks && hasHardBlocks) return false;
    if (requireSkillSignal && !hasSkillSignal) return false;
    if (requireKnownDistance && !hasKnownDistance) return false;
    return true;
  });

  const vacancyMeta = (vacancy: any) => {
    const salary =
      vacancy.salary_display ||
      (typeof vacancy.hourly_rate === 'number' ? `${formatEUR(vacancy.hourly_rate)}/uur` : null) ||
      (typeof vacancy.salary_min === 'number' || typeof vacancy.salary_max === 'number'
        ? [vacancy.salary_min ? formatEUR(vacancy.salary_min) : null, vacancy.salary_max ? formatEUR(vacancy.salary_max) : null].filter(Boolean).join(' - ')
        : null);
    const start = vacancy.start_date_text || (vacancy.start_date ? formatDate(vacancy.start_date) : null);
    const spots = typeof vacancy.required_count === 'number'
      ? `${vacancy.filled_count ?? 0}/${vacancy.required_count} gevuld`
      : null;
    return { salary, start, spots };
  };

  const proposeMutation = useMutation({
    mutationFn: async (r: any) => {
      const { data: match, error } = await (supabase as any).from('matches').insert({
        organization_id: orgId,
        vacancy_id: r.vacancy.id,
        candidate_id: candidateId,
        proposed_by: user?.id ?? null,
        status: 'nieuwe_match' as any,
        source: 'eigen_match',
        match_score: r.score ?? null,
        match_reasoning: r.breakdown?.reasoning ?? null,
        match_breakdown: (r.breakdown ?? null) as any,
        distance_km: r.breakdown?.distance?.km ?? null,
      }).select('id').single();
      if (error) throw error;
      try {
        await supabase.functions.invoke('calculate-match', {
          body: { match_id: match.id, candidate_id: candidateId, vacancy_id: r.vacancy.id },
        });
      } catch { /* non-blocking */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-existing-match-vacancies', orgId, candidateId] });
      qc.invalidateQueries({ queryKey: ['candidate-matches', orgId, candidateId] });
      qc.invalidateQueries({ queryKey: ['rank-vacancies', candidateId] });
      toast.success('Voorgesteld op vacature (AI-score wordt berekend)');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-base">Passende vacatures</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Open vacatures gerangschikt op match met deze kandidaat</p>
        </div>
        <div className="w-full sm:w-72 rounded-md border bg-card px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">Minimumscore</span>
            <span className="tabular-nums text-muted-foreground">{minScore}%</span>
          </div>
          <Slider value={[minScore]} min={0} max={90} step={5} onValueChange={(value) => setMinScore(value[0] ?? 0)} className="mt-2" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <label className="flex items-center gap-2">
          <Checkbox checked={!includeHardBlocks} onCheckedChange={(checked) => setIncludeHardBlocks(!checked)} />
          Zonder harde blokkades
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={requireSkillSignal} onCheckedChange={(checked) => setRequireSkillSignal(checked === true)} />
          Skill/cert-match vereist
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={requireKnownDistance} onCheckedChange={(checked) => setRequireKnownDistance(checked === true)} />
          Afstand bekend
        </label>
      </div>

      {isFetching && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 animate-pulse" /> Open vacatures rangschikken…
        </p>
      )}

      <div className="space-y-2">
        {isFetching && !results &&
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={`vac-skeleton-${i}`} className="p-3 space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-full" />
            </Card>
          ))}
        {filtered.map((r: any) => {
          const meta = vacancyMeta(r.vacancy);
          const canonicalSkills = (r.vacancy.canonical_required_skills ?? []).filter((s: string) => !(r.vacancy.required_skills ?? []).includes(s));
          return (
          <Card key={r.vacancy.id} className="p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <Link to={`/vacatures/${r.vacancy.id}`} className="font-medium text-sm hover:text-primary truncate">{r.vacancy.title}</Link>
                  <Badge className={cn('text-[10px] px-1.5 py-0 flex-shrink-0', scoreBadgeClass[r.label as MatchBreakdown['label']])}>
                    {r.score}% match
                  </Badge>
                </div>
                {r.vacancy.company_name && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Briefcase className="h-3 w-3" /> {r.vacancy.company_name}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {r.vacancy.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {r.vacancy.location}</span>}
                  {meta.salary && <span className="inline-flex items-center gap-1"><Euro className="h-3 w-3" /> {meta.salary}</span>}
                  {meta.start && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {meta.start}</span>}
                  {meta.spots && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {meta.spots}</span>}
                </div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(r.breakdown?.skillMatches ?? []).slice(0, 4).map((s: string) => <Badge key={`skill-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
                  {(r.breakdown?.certificationMatches ?? []).slice(0, 2).map((s: string) => <Badge key={`cert-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
                  {(r.breakdown?.skillMatches ?? []).length === 0 && (r.breakdown?.certificationMatches ?? []).length === 0 &&
                    [...(r.vacancy.required_skills ?? []), ...canonicalSkills].slice(0, 3).map((s: string) => <Badge key={`req-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
                </div>
                {(r.breakdown?.missing ?? []).length > 0 && (
                  <p className="text-[11px] text-amber-700 mt-1 line-clamp-1">{r.breakdown.missing[0]}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <Button size="sm" variant="outline" onClick={() => proposeMutation.mutate(r)} disabled={proposeMutation.isPending}>
                  <UserPlus className="h-3 w-3 mr-1" /> Voorstellen
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setDetail(r)}>
                  Waarom?
                </Button>
              </div>
            </div>
          </Card>
          );
        })}
        {isError && <p className="text-sm text-red-600">Vacatures konden niet worden geladen. Probeer het opnieuw.</p>}
        {!isError && !isFetching && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {minScore > 0 ? `Geen open vacatures met match ≥ ${minScore}%.` : 'Geen passende open vacatures gevonden.'}
          </p>
        )}
      </div>

      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Waarom deze match?
              {detail && (
                <Badge className={cn('text-xs', scoreBadgeClass[detail.label as MatchBreakdown['label']])}>{detail.score}%</Badge>
              )}
            </DialogTitle>
            <DialogDescription>{detail?.vacancy?.title} — opbouw van de matchscore.</DialogDescription>
          </DialogHeader>
          {detail?.breakdown && (() => {
            const bd = detail.breakdown;
            const labelNl: Record<string, string> = { skills: 'Vaardigheden', certifications: 'Certificaten', functionGroup: 'Functiegroep', distance: 'Afstand', availability: 'Beschikbaarheid' };
            const components = Object.entries(bd.componentScores ?? {}) as [string, any][];
            const meta = vacancyMeta(detail.vacancy ?? {});
            return (
              <div className="space-y-4 text-sm">
                <div className="rounded-md border bg-muted/30 p-3 text-xs">
                  <p className="font-medium text-sm mb-2">Vacaturecontext</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-muted-foreground">Opdrachtgever:</span> {detail.vacancy?.company_name ?? '—'}</div>
                    <div><span className="text-muted-foreground">Locatie:</span> {detail.vacancy?.location ?? '—'}</div>
                    <div><span className="text-muted-foreground">Tarief/salaris:</span> {meta.salary ?? '—'}</div>
                    <div><span className="text-muted-foreground">Start:</span> {meta.start ?? '—'}</div>
                    <div><span className="text-muted-foreground">Bezetting:</span> {meta.spots ?? '—'}</div>
                    <div><span className="text-muted-foreground">Urgentie:</span> {detail.vacancy?.urgency ?? '—'}</div>
                  </div>
                  {detail.vacancy?.description && (
                    <p className="mt-2 line-clamp-3 text-muted-foreground">{detail.vacancy.description}</p>
                  )}
                </div>
                {bd.reasoning && <p className="text-muted-foreground">{bd.reasoning}</p>}
                {components.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Score-opbouw (punten per onderdeel)</p>
                    {components.map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span>{labelNl[key] ?? key}</span>
                        <span className="text-muted-foreground tabular-nums">{typeof val === 'number' ? `${val} pt` : String(val)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(bd.hardBlocks ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-red-600 uppercase mb-1">Harde blokkades</p>
                    <ul className="list-disc list-inside space-y-0.5 text-red-600">{bd.hardBlocks.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                  </div>
                )}
                {(bd.positives ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-emerald-700 uppercase mb-1">Pluspunten</p>
                    <ul className="list-disc list-inside space-y-0.5 text-emerald-700">{bd.positives.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                  </div>
                )}
                {(bd.missing ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 uppercase mb-1">Ontbreekt / aandachtspunten</p>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-700">{bd.missing.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>Sluiten</Button>
            {detail && (
              <Button onClick={() => { proposeMutation.mutate(detail); setDetail(null); }} disabled={proposeMutation.isPending}>
                <UserPlus className="h-3 w-3 mr-1" /> Voorstellen
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CandidateVacancyMatchesTab;
