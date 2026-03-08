import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Search, UserPlus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import PlacementSheet from '@/components/vacancies/PlacementSheet';

const matchStatusLabel: Record<string, string> = {
  voorgesteld: 'Voorgesteld', in_gesprek: 'In gesprek', geaccepteerd: 'Geaccepteerd', afgewezen: 'Afgewezen', geplaatst: 'Geplaatst',
};
const matchStatusBadge: Record<string, string> = {
  voorgesteld: 'bg-muted text-muted-foreground border-0',
  in_gesprek: 'bg-blue-100 text-blue-700 border-0',
  geaccepteerd: 'bg-stat-green/10 text-stat-green border-0',
  afgewezen: 'bg-red-100 text-red-600 border-0',
  geplaatst: 'bg-purple-100 text-purple-700 border-0',
};

const VacancyMatchesTab = ({ vacancy }: { vacancy: any }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [candidateSearch, setCandidateSearch] = useState('');
  const [placementMatch, setPlacementMatch] = useState<any>(null);

  const { data: matches } = useQuery({
    queryKey: ['vacancy-matches', vacancy.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(`*, candidates!matches_candidate_id_fkey(id, first_name, last_name, compliance_status)`)
        .eq('vacancy_id', vacancy.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: availableCandidates } = useQuery({
    queryKey: ['available-candidates-for-vacancy', vacancy.id, candidateSearch],
    queryFn: async () => {
      const matchedIds = (matches ?? []).map((m: any) => m.candidate_id);
      let query = supabase.from('candidates').select('id, first_name, last_name, skills, compliance_status')
        .in('status', ['beschikbaar', 'nieuw'] as any);
      if (candidateSearch) {
        query = query.or(`first_name.ilike.%${candidateSearch}%,last_name.ilike.%${candidateSearch}%`);
      }
      const { data, error } = await query.order('first_name').limit(20);
      if (error) throw error;
      return (data ?? []).filter((c: any) => !matchedIds.includes(c.id));
    },
    enabled: !!matches,
  });

  const proposeMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase.from('matches').insert({
        organization_id: orgId,
        vacancy_id: vacancy.id,
        candidate_id: candidateId,
        proposed_by: user?.id ?? null,
        status: 'voorgesteld' as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      qc.invalidateQueries({ queryKey: ['available-candidates-for-vacancy'] });
      toast.success('Kandidaat voorgedragen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ matchId, status }: { matchId: string; status: string }) => {
      const { error } = await supabase.from('matches').update({ status, status_changed_at: new Date().toISOString() } as any).eq('id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancy-matches', vacancy.id] });
      toast.success('Match status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const grouped = {
    voorgesteld: (matches ?? []).filter((m: any) => m.status === 'voorgesteld'),
    in_gesprek: (matches ?? []).filter((m: any) => m.status === 'in_gesprek'),
    geaccepteerd: (matches ?? []).filter((m: any) => m.status === 'geaccepteerd'),
    afgewezen: (matches ?? []).filter((m: any) => m.status === 'afgewezen'),
    geplaatst: (matches ?? []).filter((m: any) => m.status === 'geplaatst'),
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
      <div className="lg:col-span-2 space-y-4">
        <h3 className="font-semibold">Match pipeline</h3>
        {Object.entries(grouped).map(([status, items]) => (
          <Card key={status}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={matchStatusBadge[status] ?? ''}>{matchStatusLabel[status]}</Badge>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
            </CardHeader>
            {items.length > 0 && (
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {items.map((m: any) => {
                      const c = m.candidates as any;
                      return (
                        <TableRow key={m.id}>
                          <TableCell>
                            <Link to={`/kandidaten/${c.id}`} className="font-medium hover:text-primary">{c.first_name} {c.last_name}</Link>
                          </TableCell>
                          <TableCell>
                            {m.match_score != null && <Badge variant="outline" className="text-xs">{m.match_score}%</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(m.proposed_at)}</TableCell>
                          <TableCell className="text-right">
                            {status === 'voorgesteld' && (
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ matchId: m.id, status: 'in_gesprek' })}>In gesprek</Button>
                                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => statusMutation.mutate({ matchId: m.id, status: 'afgewezen' })}>Afwijzen</Button>
                              </div>
                            )}
                            {status === 'in_gesprek' && (
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ matchId: m.id, status: 'geaccepteerd' })}>Accepteren</Button>
                                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => statusMutation.mutate({ matchId: m.id, status: 'afgewezen' })}>Afwijzen</Button>
                              </div>
                            )}
                            {status === 'geaccepteerd' && (
                              <Button size="sm" onClick={() => setPlacementMatch(m)}>Plaatsen</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold">Kandidaten zoeken</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek kandidaat..." value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="space-y-2">
          {(availableCandidates ?? []).map((c: any) => (
            <Card key={c.id} className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Link to={`/kandidaten/${c.id}`} className="font-medium text-sm hover:text-primary">{c.first_name} {c.last_name}</Link>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {(c.skills ?? []).slice(0, 3).map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => proposeMutation.mutate(c.id)} disabled={proposeMutation.isPending}>
                  <UserPlus className="h-3 w-3 mr-1" /> Voordragen
                </Button>
              </div>
            </Card>
          ))}
          {(availableCandidates ?? []).length === 0 && <p className="text-sm text-muted-foreground">Geen beschikbare kandidaten gevonden</p>}
        </div>
      </div>

      <PlacementSheet match={placementMatch} vacancy={vacancy} onClose={() => setPlacementMatch(null)} />
    </div>
  );
};

export default VacancyMatchesTab;
