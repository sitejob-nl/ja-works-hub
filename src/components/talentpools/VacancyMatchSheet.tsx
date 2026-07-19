import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Sparkles, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { createMatch } from '@/lib/match-lifecycle';
import { resolveDefaultMatchAssignee } from '@/lib/match-assignee';

interface MatchResult {
  candidateId: string;
  candidateName: string;
  score: number | null;
  reasoning: string | null;
  status: 'pending' | 'done' | 'error';
}

interface VacancyMatchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: any[];
}

export default function VacancyMatchSheet({ open, onOpenChange, members }: VacancyMatchSheetProps) {
  const orgId = useOrganizationId();
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedVacancy, setSelectedVacancy] = useState<any>(null);
  const [matching, setMatching] = useState(false);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [progress, setProgress] = useState(0);

  const { data: vacancies = [] } = useQuery({
    queryKey: ['open-vacancies', orgId, search],
    queryFn: async () => {
      let query = supabase
        .from('vacancies')
        .select('id, title, function_name, status, companies!vacancies_company_id_fkey(name)')
        .eq('organization_id', orgId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(20);

      if (search) {
        query = query.ilike('title', `%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !selectedVacancy,
  });

  const startMatching = async (vacancy: any) => {
    setSelectedVacancy(vacancy);

    const candidateMembers = members.filter((m) => m.candidates);
    if (candidateMembers.length === 0) {
      toast.error('Geen leden in deze pool');
      return;
    }

    if (candidateMembers.length > 20) {
      const ok = window.confirm(
        `Deze pool heeft ${candidateMembers.length} leden. AI-matching kan even duren. Doorgaan?`
      );
      if (!ok) {
        setSelectedVacancy(null);
        return;
      }
    }

    setMatching(true);
    setProgress(0);
    const matchResults: MatchResult[] = candidateMembers.map((m) => ({
      candidateId: m.candidates.id,
      candidateName: `${m.candidates.first_name ?? ''} ${m.candidates.last_name ?? ''}`.trim(),
      score: null,
      reasoning: null,
      status: 'pending' as const,
    }));
    setResults([...matchResults]);

    // Process in batches of 3
    const batchSize = 3;
    let done = 0;

    for (let i = 0; i < matchResults.length; i += batchSize) {
      const batch = matchResults.slice(i, i + batchSize);

      const promises = batch.map(async (result) => {
        try {
          // Check for existing match
          const { data: existing } = await supabase
            .from('matches')
            .select('id, match_score, match_reasoning')
            .eq('candidate_id', result.candidateId)
            .eq('vacancy_id', vacancy.id)
            .maybeSingle();

          let matchId = existing?.id;

          if (existing?.match_score != null) {
            // Reuse existing score
            result.score = existing.match_score;
            result.reasoning = existing.match_reasoning;
            result.status = 'done';
          } else {
            // Create match if needed
            if (!matchId) {
              const newMatch = await createMatch(supabase as any, {
                orgId,
                vacancyId: vacancy.id,
                candidateId: result.candidateId,
                proposedBy: user?.id ?? null,
                assignedTo: resolveDefaultMatchAssignee({
                  currentUserId: user?.id,
                  currentUserRole: role,
                  vacancyCreatedBy: vacancy?.created_by,
                }),
                source: 'eigen_match',
              });
              matchId = newMatch.id;
            }

            // Calculate score
            const { error: calcError } = await supabase.functions.invoke('calculate-match', {
              body: { match_id: matchId, candidate_id: result.candidateId, vacancy_id: vacancy.id },
            });

            if (calcError) throw calcError;

            // Fetch updated score
            const { data: updated } = await supabase
              .from('matches')
              .select('match_score, match_reasoning')
              .eq('id', matchId)
              .single();

            result.score = updated?.match_score ?? null;
            result.reasoning = updated?.match_reasoning ?? null;
            result.status = 'done';
          }
        } catch {
          result.status = 'error';
        }
      });

      await Promise.allSettled(promises);
      done += batch.length;
      setProgress(Math.round((done / matchResults.length) * 100));
      setResults([...matchResults]);
    }

    setMatching(false);
    qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setSelectedVacancy(null);
      setResults([]);
      setProgress(0);
      setSearch('');
    }
    onOpenChange(open);
  };

  const sortedResults = [...results].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const scoreBadge = (score: number | null) => {
    if (score == null) return <Badge variant="secondary">—</Badge>;
    const pct = Math.round(score * 100);
    if (pct >= 70) return <Badge className="bg-stat-green/10 text-stat-green border-0">{pct}%</Badge>;
    if (pct >= 40) return <Badge className="bg-yellow-100 text-yellow-700 border-0">{pct}%</Badge>;
    return <Badge className="bg-red-100 text-red-600 border-0">{pct}%</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {selectedVacancy ? `Match: ${selectedVacancy.title}` : 'Vacature selecteren'}
          </DialogTitle>
        </DialogHeader>

        {!selectedVacancy ? (
          <div className="space-y-3 flex-1 overflow-y-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Zoek op vacaturetitel..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {vacancies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Geen open vacatures gevonden.
              </p>
            ) : (
              <div className="space-y-1">
                {vacancies.map((v: any) => (
                  <button
                    key={v.id}
                    onClick={() => startMatching(v)}
                    className="w-full text-left px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors border"
                  >
                    <p className="font-medium text-sm">{v.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {v.companies?.name ?? '—'}
                      {v.function_name && ` · ${v.function_name}`}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 flex-1 overflow-y-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedVacancy(null);
                setResults([]);
                setProgress(0);
              }}
              className="gap-1.5 -ml-2"
              disabled={matching}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Andere vacature
            </Button>

            {matching && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Bezig met matchen...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            {results.length > 0 && (
              <div className="bg-card rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kandidaat</TableHead>
                      <TableHead className="w-20">Score</TableHead>
                      <TableHead>Onderbouwing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedResults.map((r) => (
                      <TableRow key={r.candidateId}>
                        <TableCell>
                          <Link
                            to={`/kandidaten/${r.candidateId}`}
                            className="font-medium text-foreground hover:text-stat-blue transition-colors text-sm"
                          >
                            {r.candidateName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {r.status === 'pending' ? (
                            <Badge variant="secondary" className="text-[10px]">Wacht...</Badge>
                          ) : r.status === 'error' ? (
                            <Badge variant="destructive" className="text-[10px]">Fout</Badge>
                          ) : (
                            scoreBadge(r.score)
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {r.reasoning ?? '—'}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
