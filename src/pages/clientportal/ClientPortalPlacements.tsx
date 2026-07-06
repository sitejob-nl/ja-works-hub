import { useClientPortal } from '@/contexts/ClientPortalContext';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

const statusBadge: Record<string, string> = {
  gepland: 'bg-blue-100 text-blue-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  gepland: 'Gepland', actief: 'Actief', afgerond: 'Afgerond', voortijdig_beeindigd: 'Beëindigd',
};

const ClientPortalPlacements = () => {
  const { company } = useClientPortal();

  const { data: placements = [], isLoading } = useQuery({
    queryKey: ['client-portal-placements', company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select('id, status, start_date, end_date, function_name, candidates!placements_candidate_id_fkey(first_name, last_name)')
        .eq('company_id', company!.id)
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company?.id,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Plaatsingen</h1>

      {isLoading ? (
        <p className="text-muted-foreground text-center py-8">Laden...</p>
      ) : placements.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">Geen plaatsingen gevonden</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medewerker</TableHead>
                <TableHead>Functie</TableHead>
                <TableHead>Startdatum</TableHead>
                <TableHead>Einddatum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Acties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {placements.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.candidates?.first_name} {p.candidates?.last_name}
                  </TableCell>
                  <TableCell>{p.function_name ?? '-'}</TableCell>
                  <TableCell>{formatDate(p.start_date)}</TableCell>
                  <TableCell>{p.end_date ? formatDate(p.end_date) : '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs ${statusBadge[p.status] ?? ''}`}>
                      {statusLabel[p.status] ?? p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/klantportaal/uren?placement_id=${p.id}`}>Uren</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default ClientPortalPlacements;
