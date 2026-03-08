import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/format';

const statusBadge: Record<string, string> = {
  voorgesteld: 'bg-muted text-muted-foreground border-0',
  in_gesprek: 'bg-blue-100 text-blue-700 border-0',
  geaccepteerd: 'bg-stat-green/10 text-stat-green border-0',
  afgewezen: 'bg-red-100 text-red-600 border-0',
  geplaatst: 'bg-stat-purple/10 text-stat-purple border-0',
};

const CandidateMatchesTab = ({ candidateId }: { candidateId: string }) => {
  const { data: matches = [] } = useQuery({
    queryKey: ['candidate-matches', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, vacancies!matches_vacancy_id_fkey(title, companies!vacancies_company_id_fkey(name))')
        .eq('candidate_id', candidateId)
        .order('proposed_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Matches</h3>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vacature</TableHead>
              <TableHead>Bedrijf</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Voorgesteld</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.vacancies?.title ?? '—'}</TableCell>
                <TableCell>{m.vacancies?.companies?.name ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={(m.match_score ?? 0) * 100} className="h-2 w-16" />
                    <span className="text-xs text-muted-foreground">{m.match_score ? `${Math.round(m.match_score * 100)}%` : '—'}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={statusBadge[m.status] ?? ''}>{m.status.replace('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{formatDate(m.proposed_at)}</TableCell>
              </TableRow>
            ))}
            {matches.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nog geen matches voor deze kandidaat</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CandidateMatchesTab;
