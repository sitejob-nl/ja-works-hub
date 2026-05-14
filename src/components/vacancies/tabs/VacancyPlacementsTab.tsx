import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Briefcase } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';

const placementStatusBadge: Record<string, string> = {
  gepland: 'bg-muted text-muted-foreground border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  beeindigd: 'bg-red-100 text-red-600 border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};
const placementStatusLabel: Record<string, string> = {
  gepland: 'Gepland',
  actief: 'Actief',
  afgerond: 'Afgerond',
  beeindigd: 'Beëindigd',
  voortijdig_beeindigd: 'Voortijdig beëindigd',
};

const VacancyPlacementsTab = ({ vacancyId }: { vacancyId: string }) => {
  const { data: placements } = useQuery({
    queryKey: ['vacancy-placements', vacancyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select(`*, candidates!placements_candidate_id_fkey(id, first_name, last_name), employees!placements_employee_id_fkey(id, candidate_id, candidates!employees_candidate_id_fkey(id, first_name, last_name))`)
        .eq('vacancy_id', vacancyId)
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!placements?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center mt-4">
        <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground">Nog geen plaatsingen vanuit deze vacature</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border mt-4">
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
            const emp = p.employees as any;
            const cand = ((p.candidates as any) ?? emp?.candidates) as any;
            const name = cand ? `${cand.first_name} ${cand.last_name}` : '—';
            const candidateId = p.candidate_id ?? emp?.candidate_id ?? cand?.id;
            return (
              <TableRow key={p.id}>
                <TableCell>
                  {candidateId ? <Link to={`/kandidaten/${candidateId}`} className="font-medium hover:text-primary transition-colors">{name}</Link> : name}
                </TableCell>
                <TableCell>
                  <Link to={`/plaatsingen/${p.id}`} className="hover:text-primary transition-colors">
                    {p.function_name || 'Plaatsing'}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(p.start_date)}</TableCell>
                <TableCell>{formatDate(p.end_date)}</TableCell>
                <TableCell>{formatEUR(p.hourly_rate)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={placementStatusBadge[p.status] ?? ''}>{placementStatusLabel[p.status] ?? p.status}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default VacancyPlacementsTab;
