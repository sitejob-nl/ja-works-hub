import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, Sparkles, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
  const [scoreFilter, setScoreFilter] = useState<'strong' | '60' | '70' | '80' | 'all'>('strong');
  const [detail, setDetail] = useState<any | null>(null);
  const minScore = scoreFilter === '60' ? 60 : scoreFilter === '70' ? 70 : scoreFilter === '80' ? 80 : 0;

  // Bestaande matches uitsluiten zodat we alleen nieuwe vacatures voorstellen.
  const { data: existing } = useQuery({
    queryKey: ['candidate-existing-match-vacancies', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('matches').select('vacancy_id').eq('candidate_id', candidateId);
      if (error) throw error;
      return (data ?? []).map((m: any) => m.vacancy_id).filter(Boolean);
    },
  });

  const { data: results, isError, isFetching } = useQuery({
    queryKey: ['rank-vacancies', candidateId, scoreFilter, (existing ?? []).length],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('rank-vacancies', {
        body: {
          candidate_id: candidateId,
          exclude_vacancy_ids: existing ?? [],
          include_weak: scoreFilter === 'all',
          limit: 25,
        },
      });
      if (error) throw error;
      return (data?.results ?? []) as any[];
    },
    enabled: !!existing,
  });

  const filtered = (results ?? []).filter((r: any) => (r.score ?? 0) >= minScore);

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
      qc.invalidateQueries({ queryKey: ['candidate-existing-match-vacancies', candidateId] });
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
        <Select value={scoreFilter} onValueChange={(v) => setScoreFilter(v as any)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="strong">Sterke matches</SelectItem>
            <SelectItem value="60">Match ≥ 60%</SelectItem>
            <SelectItem value="70">Match ≥ 70%</SelectItem>
            <SelectItem value="80">Match ≥ 80%</SelectItem>
            <SelectItem value="all">Alles (incl. zwak)</SelectItem>
          </SelectContent>
        </Select>
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
        {filtered.map((r: any) => (
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
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(r.breakdown?.skillMatches ?? []).slice(0, 4).map((s: string) => <Badge key={`skill-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
                  {(r.breakdown?.certificationMatches ?? []).slice(0, 2).map((s: string) => <Badge key={`cert-${s}`} variant="outline" className="text-xs">{s}</Badge>)}
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
        ))}
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
            return (
              <div className="space-y-4 text-sm">
                {bd.reasoning && <p className="text-muted-foreground">{bd.reasoning}</p>}
                {components.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Score-opbouw</p>
                    {components.map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span>{labelNl[key] ?? key}</span>
                        <span className="text-muted-foreground tabular-nums">{typeof val === 'number' ? `${Math.round(val * 100)}%` : String(val)}</span>
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
