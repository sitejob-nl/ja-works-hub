import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatEUR } from '@/lib/format';

const statusBadge: Record<string, string> = {
  gepland: 'bg-blue-100 text-blue-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  gepland: 'Gepland', actief: 'Actief', afgerond: 'Afgerond', voortijdig_beeindigd: 'Voortijdig beëindigd',
};

const EmployeePlacementsTab = ({ candidateId }: { candidateId: string }) => {
  const navigate = useNavigate();
  const { data: placements = [] } = useQuery({
    queryKey: ['employee-placements', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placements')
        .select('*, companies!placements_company_id_fkey(name)')
        .eq('candidate_id', candidateId)
        .order('status', { ascending: true })
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (placements.length === 0) return <p className="text-center text-muted-foreground py-8">Nog geen plaatsingen</p>;

  return (
    <div className="bg-card rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bedrijf</TableHead>
            <TableHead>Functie</TableHead>
            <TableHead>Startdatum</TableHead>
            <TableHead>Einddatum</TableHead>
            <TableHead>Uurtarief</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {placements.map((p: any) => (
            <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/plaatsingen/${p.id}`)}>
              <TableCell className="font-medium">{p.companies?.name ?? '—'}</TableCell>
              <TableCell>{p.function_name}</TableCell>
              <TableCell>{formatDate(p.start_date)}</TableCell>
              <TableCell>{formatDate(p.end_date)}</TableCell>
              <TableCell>{formatEUR(p.hourly_rate)}</TableCell>
              <TableCell>
                <Badge variant="secondary" className={statusBadge[p.status] ?? ''}>{statusLabel[p.status] ?? p.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default EmployeePlacementsTab;
