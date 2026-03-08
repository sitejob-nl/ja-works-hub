import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatEUR } from '@/lib/format';

const statusColors: Record<string, string> = {
  gepland: 'bg-yellow-100 text-yellow-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};

const CandidatePlacementsTab = ({ candidateId }: { candidateId: string }) => {
  const { data: placements = [] } = useQuery({
    queryKey: ['candidate-placements', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select('*, companies!placements_company_id_fkey(name)')
        .eq('employee_id', candidateId)
        .order('start_date', { ascending: false });
      if (error) throw error;

      // Also try via employees table
      if (data && data.length === 0) {
        const { data: empData } = await supabase
          .from('employees')
          .select('id')
          .eq('candidate_id', candidateId)
          .maybeSingle();
        if (empData) {
          const { data: placementData, error: pErr } = await supabase
            .from('placements')
            .select('*, companies!placements_company_id_fkey(name)')
            .eq('employee_id', empData.id)
            .order('start_date', { ascending: false });
          if (pErr) throw pErr;
          return placementData ?? [];
        }
      }
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Plaatsingen</h3>
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
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.companies?.name ?? '—'}</TableCell>
                <TableCell>{p.function_name}</TableCell>
                <TableCell>{formatDate(p.start_date)}</TableCell>
                <TableCell>{formatDate(p.end_date)}</TableCell>
                <TableCell>{formatEUR(p.hourly_rate)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={statusColors[p.status] ?? ''}>{p.status.replace('_', ' ')}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {placements.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nog geen plaatsingen</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CandidatePlacementsTab;
