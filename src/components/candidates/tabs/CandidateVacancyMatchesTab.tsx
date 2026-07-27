import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, CalendarDays, Euro, MapPin, Search, SlidersHorizontal, Sparkles, UserPlus, Users } from 'lucide-react';
import EntityLink from '@/components/ui/entity-link';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import MatchInspectorDialog from '@/components/matches/MatchInspectorDialog';
import CandidateMatchContext from '@/components/matches/CandidateMatchContext';
import { cn } from '@/lib/utils';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { type MatchBreakdown } from '@/lib/matching';
import { createMatch } from '@/lib/match-lifecycle';
import { resolveDefaultMatchAssignee } from '@/lib/match-assignee';
import { verdictBadgeClass } from '@/lib/match-presenters';

const scoreBadgeClass: Record<MatchBreakdown['label'], string> = {
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-yellow-100 text-yellow-700 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
};

// rerank-matches kapt de meegestuurde lijst zelf af op MAX_CANDIDATES = 30 — hier is dat het
// aantal VACATURES, want we draaien de reverse-modus (1 kandidaat × N vacatures). Nooit meer
// meesturen dan dat, anders belooft de knop meer dan de server levert.
const RERANK_MAX_VACANCIES = 30;

// Reverse matching: passende OPEN vacatures voor deze kandidaat (via rank-vacancies edge fn).
const CandidateVacancyMatchesTab = ({ candidateId, candidate }: { candidateId: string; candidate?: any }) => {
  const orgId = useOrganizationId();
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [minScore, setMinScore] = useState(60);
  const [vacancySearch, setVacancySearch] = useState('');
  const [includeHardBlocks, setIncludeHardBlocks] = useState(false);
  const [requireSkillSignal, setRequireSkillSignal] = useState(false);
  const [requireKnownDistance, setRequireKnownDistance] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  // Stage-2 AI-herbeoordeling (rerank-matches): fit-score + onderbouwing per vacature-id.
  // Bewust achter een knop en niet automatisch bij openen: dit kost credits per (vacature ×
  // kandidaat) en je opent een dossier veel vaker dan een vacature.
  const [rerankByVacancy, setRerankByVacancy] = useState<Record<string, any>>({});

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
    queryKey: ['rank-vacancies', candidateId, (existing ?? []).length, minScore, includeHardBlocks, requireSkillSignal, requireKnownDistance, vacancySearch],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('rank-vacancies', {
        body: {
          candidate_id: candidateId,
          exclude_vacancy_ids: existing ?? [],
          include_weak: includeHardBlocks || minScore < 45,
          search: vacancySearch || undefined,
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

  const rerankActive = Object.keys(rerankByVacancy).length > 0;
  // Zodra er een AI-oordeel is, bepaalt dat de volgorde; vacatures zonder oordeel vallen terug op
  // hun regelscore, zodat een half beoordeelde lijst niet door elkaar schiet.
  const displayed = rerankActive
    ? [...filtered].sort((a: any, b: any) =>
        (rerankByVacancy[b.vacancy.id]?.fit_score ?? b.score ?? 0) -
        (rerankByVacancy[a.vacancy.id]?.fit_score ?? a.score ?? 0))
    : filtered;
  // Wat we naar de server sturen: nooit meer dan de servercap, anders wordt de rest stil weggegooid.
  const rerankTargets = displayed.slice(0, RERANK_MAX_VACANCIES);

  // Stage-2: weegt elk volledige vacaturetekst tegen het dossier van DEZE kandidaat met Gemini.
  // Server cachet per (vacature × kandidaat) — dezelfde cache als de vacaturekant, dus wat hier
  // beoordeeld is, is daar gratis (en omgekeerd).
  const rerankMutation = useMutation({
    mutationFn: async (vacancyIds: string[]) => {
      if (vacancyIds.length === 0) throw new Error('Geen vacatures om te beoordelen');
      const { data, error } = await supabase.functions.invoke('rerank-matches', {
        body: { candidate_id: candidateId, vacancy_ids: vacancyIds },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data: any) => {
      const next: Record<string, any> = {};
      for (const r of data?.results ?? []) {
        if (r?.vacancy_id && r.fit_score != null) next[r.vacancy_id] = r;
      }
      setRerankByVacancy((prev) => ({ ...prev, ...next }));
      const parts: string[] = [`${data?.scored ?? 0} beoordeeld`];
      if (data?.cached) parts.push(`${data.cached} uit cache`);
      if (data?.gemini_calls) parts.push(`${data.gemini_calls} nieuwe`);
      if (typeof data?.cost_cents === 'number' && data.cost_cents > 0) parts.push(`€${(data.cost_cents / 100).toFixed(2)}`);
      if (data?.failed) parts.push(`${data.failed} mislukt`);
      toast.success(`AI-herbeoordeling klaar — ${parts.join(', ')}`);
      if (data?.stopped) toast.warning('Niet alle vacatures beoordeeld (saldo of tijd op). Draai nogmaals voor de rest.');
    },
    onError: (e: any) => toast.error(e.message ?? 'AI-herbeoordeling mislukt'),
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
      const match = await createMatch(supabase as any, {
        orgId,
        vacancyId: r.vacancy.id,
        candidateId,
        proposedBy: user?.id ?? null,
        assignedTo: resolveDefaultMatchAssignee({
          currentUserId: user?.id,
          currentUserRole: role,
          vacancyCreatedBy: r.vacancy?.created_by,
        }),
        source: 'eigen_match',
        score: r.breakdown ?? null,
      });
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
      toast.success('Match gemaakt op vacature (AI-score wordt berekend)');
    },
    onError: (e: any) => {
      if (e?.code === '23505') toast.info('Deze match bestaat al');
      else toast.error(e.message);
    },
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op vacaturetitel of locatie..." value={vacancySearch} onChange={(e) => setVacancySearch(e.target.value)} className="pl-9" />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 whitespace-nowrap sm:ml-auto"
          disabled={rerankMutation.isPending || rerankTargets.length === 0}
          title={`Weegt de volledige vacaturetekst tegen het dossier van deze kandidaat met Gemini en herrangschikt de lijst (maximaal ${RERANK_MAX_VACANCIES} vacatures per keer)`}
          onClick={() => rerankMutation.mutate(rerankTargets.map((r: any) => r.vacancy.id))}
        >
          <Sparkles className={cn('h-3.5 w-3.5', rerankMutation.isPending && 'animate-pulse')} />
          {rerankMutation.isPending ? 'AI beoordeelt…' : rerankActive ? 'AI opnieuw' : 'AI-herbeoordeling'}
        </Button>
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <label className="flex items-center gap-2">
            <Checkbox checked={!includeHardBlocks} onCheckedChange={(checked) => setIncludeHardBlocks(!checked)} />
            Zonder harde blokkades
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={requireSkillSignal} onCheckedChange={(checked) => setRequireSkillSignal(checked === true)} />
            Skill/certificaatmatch vereist
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={requireKnownDistance} onCheckedChange={(checked) => setRequireKnownDistance(checked === true)} />
            Alleen met bekende afstand/reistijd
          </label>
        </div>
      </div>

      <CandidateMatchContext candidate={candidate} compact />

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
        {displayed.map((r: any) => {
          const meta = vacancyMeta(r.vacancy);
          const canonicalSkills = (r.vacancy.canonical_required_skills ?? []).filter((s: string) => !(r.vacancy.required_skills ?? []).includes(s));
          const rr = rerankByVacancy[r.vacancy.id];
          return (
          <Card key={r.vacancy.id} className="p-3">
            <div className="flex items-start gap-3">
              <div
                className="min-w-0 flex-1 cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => setDetail(r)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <Link to={`/vacatures/${r.vacancy.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-sm hover:text-stat-blue truncate">{r.vacancy.title}</Link>
                  <Badge className={cn('text-[10px] px-1.5 py-0 flex-shrink-0', scoreBadgeClass[r.label as MatchBreakdown['label']])}>
                    {r.score}% match
                  </Badge>
                  {rr && (
                    <Badge
                      className={cn('text-[10px] px-1.5 py-0 flex-shrink-0 gap-0.5', verdictBadgeClass[rr.verdict] ?? 'bg-muted text-muted-foreground border-0')}
                      title={`AI-oordeel op de volledige vacaturetekst — ${rr.verdict}${rr.cached ? ' (uit cache)' : ''}`}
                    >
                      <Sparkles className="h-2.5 w-2.5" /> AI {rr.fit_score}
                    </Badge>
                  )}
                </div>
                {r.vacancy.company_name && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Briefcase className="h-3 w-3" /> <EntityLink type="company" id={r.vacancy.company_id} fallback={r.vacancy.company_name}>{r.vacancy.company_name}</EntityLink></p>
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
                {rr?.reasoning && (
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{rr.reasoning}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <Button size="sm" variant="outline" onClick={() => proposeMutation.mutate(r)} disabled={proposeMutation.isPending}>
                  <UserPlus className="h-3 w-3 mr-1" /> Match maken
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

      <MatchInspectorDialog
        open={!!detail}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
        title="Waarom deze match?"
        description={detail ? `${detail.vacancy?.title ?? 'Vacature'} — opbouw van de matchscore.` : undefined}
        breakdown={detail?.breakdown ?? null}
        candidateQuality={detail?.breakdown?.candidateQuality ?? null}
        candidate={candidate ?? null}
        rerank={detail?.vacancy?.id ? rerankByVacancy[detail.vacancy.id] ?? null : null}
        vacancyContext={detail ? (() => {
          const meta = vacancyMeta(detail.vacancy ?? {});
          return [
            { label: 'Opdrachtgever', value: detail.vacancy?.company_name },
            { label: 'Locatie', value: detail.vacancy?.location },
            { label: 'Tarief/salaris', value: meta.salary },
            { label: 'Start', value: meta.start },
            { label: 'Bezetting', value: meta.spots },
            { label: 'Urgentie', value: detail.vacancy?.urgency },
          ];
        })() : []}
        action={detail ? (
          <Button onClick={() => { proposeMutation.mutate(detail); setDetail(null); }} disabled={proposeMutation.isPending}>
            <UserPlus className="h-3 w-3 mr-1" /> Match maken
          </Button>
        ) : null}
      />
    </div>
  );
};

export default CandidateVacancyMatchesTab;
