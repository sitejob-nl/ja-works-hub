import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatEUR } from '@/lib/format';

const statusColors: Record<string, string> = {
  actief: 'bg-stat-green/10 text-stat-green border-0',
  gepland: 'bg-stat-blue/10 text-stat-blue border-0',
  afgerond: '',
  voortijdig_beeindigd: 'bg-destructive/10 text-destructive border-0',
};

const PlacementsTab = ({ companyId }: { companyId: string }) => {
  const { data: placements = [] } = useQuery({
    queryKey: ['company-placements', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select('*, candidates!placements_candidate_id_fkey(id, first_name, last_name), employees!placements_employee_id_fkey(candidate_id, candidates!employees_candidate_id_fkey(first_name, last_name))')
        .eq('company_id', companyId)
        .order('status', { ascending: true })
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Plaatsingen</h3>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medewerker</TableHead>
              <TableHead>Functie</TableHead>
              <TableHead>Startdatum</TableHead>
              <TableHead>Einddatum</TableHead>
              <TableHead>Uurtarief</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {placements.map((p: any) => {
              const candidate = p.candidates ?? p.employees?.candidates;
              const name = candidate ? `${candidate.first_name} ${candidate.last_name}` : '—';
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>{p.function_name}</TableCell>
                  <TableCell>{formatDate(p.start_date)}</TableCell>
                  <TableCell>{formatDate(p.end_date)}</TableCell>
                  <TableCell>{formatEUR(p.hourly_rate)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={statusColors[p.status] ?? ''}>
                      {p.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {placements.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nog geen plaatsingen bij dit bedrijf</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default PlacementsTab;
