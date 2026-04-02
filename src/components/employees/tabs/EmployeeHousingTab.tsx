import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatEUR } from '@/lib/format';

const EmployeeHousingTab = ({ candidateId }: { candidateId: string }) => {
  const { data: assignments = [] } = useQuery({
    queryKey: ['housing-assignments', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('housing_assignments')
        .select('*, units!housing_assignments_unit_id_fkey(name, properties!units_property_id_fkey(name))')
        .eq('candidate_id', candidateId)
        .order('check_in_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: keys = [] } = useQuery({
    queryKey: ['key-registrations', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('key_registrations')
        .select('*, units!key_registrations_unit_id_fkey(name)')
        .eq('candidate_id', candidateId)
        .order('issued_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const active = assignments.find((a: any) => a.status === 'ingecheckt');

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Huidige huisvesting</h3>
        {active ? (
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-xs text-muted-foreground">Pand</p><p className="text-sm">{(active as any).units?.properties?.name ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Kamer</p><p className="text-sm">{(active as any).units?.name ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Check-in</p><p className="text-sm">{formatDate(active.check_in_date)}</p></div>
            <div><p className="text-xs text-muted-foreground">Maandelijkse inhouding</p><p className="text-sm">{formatEUR(active.monthly_deduction)}</p></div>
            <div><p className="text-xs text-muted-foreground">Borg betaald</p><p className="text-sm">{active.deposit_paid ? 'Ja' : 'Nee'}</p></div>
            <div><p className="text-xs text-muted-foreground">Huur betaald tot</p><p className="text-sm">{formatDate(active.rent_paid_until)}</p></div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Geen huisvesting toegewezen</p>
        )}
      </div>

      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Sleutelregistratie</h3>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen sleutels geregistreerd</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sleutelnr.</TableHead>
                <TableHead>Kamer</TableHead>
                <TableHead>Uitgiftedatum</TableHead>
                <TableHead>Inleverdatum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k: any) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.key_number}</TableCell>
                  <TableCell>{k.units?.name ?? '—'}</TableCell>
                  <TableCell>{formatDate(k.issued_at)}</TableCell>
                  <TableCell>{k.returned_at ? formatDate(k.returned_at) : <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0 text-xs">Actief</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default EmployeeHousingTab;
