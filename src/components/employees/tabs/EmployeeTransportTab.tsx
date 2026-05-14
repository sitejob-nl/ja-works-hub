import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatEUR } from '@/lib/format';

const EmployeeTransportTab = ({ candidateId }: { candidateId: string }) => {
  const { data: assignment } = useQuery({
    queryKey: ['vehicle-assignment', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_assignments')
        .select('*, vehicles!vehicle_assignments_vehicle_id_fkey(license_plate, brand, model)')
        .eq('candidate_id', candidateId)
        .is('returned_date', null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: mileage = [] } = useQuery({
    queryKey: ['mileage', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('mileage_entries')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('entry_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const { data: fines = [] } = useQuery({
    queryKey: ['vehicle-fines', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_fines')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('fine_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      {/* Current vehicle */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Huidig voertuig</h3>
        {assignment ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><p className="text-xs text-muted-foreground">Kenteken</p><p className="text-sm font-medium">{assignment.vehicles?.license_plate}</p></div>
            <div><p className="text-xs text-muted-foreground">Merk</p><p className="text-sm">{assignment.vehicles?.brand ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Model</p><p className="text-sm">{assignment.vehicles?.model ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Toewijsdatum</p><p className="text-sm">{formatDate(assignment.assigned_date)}</p></div>
            <div><p className="text-xs text-muted-foreground">Begin km</p><p className="text-sm">{assignment.start_mileage ?? '—'}</p></div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Geen voertuig toegewezen</p>
        )}
      </div>

      {/* Mileage */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Kilometerregistraties</h3>
        {mileage.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen registraties</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Begin km</TableHead>
                <TableHead className="text-right">Eind km</TableHead>
                <TableHead className="text-right">Totaal km</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mileage.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDate(m.entry_date)}</TableCell>
                  <TableCell className="text-right">{m.start_km}</TableCell>
                  <TableCell className="text-right">{m.end_km}</TableCell>
                  <TableCell className="text-right font-medium">{m.end_km - m.start_km}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={m.is_private ? 'bg-orange-100 text-orange-600 border-0' : 'bg-blue-100 text-blue-700 border-0'}>
                      {m.is_private ? 'Privé' : 'Zakelijk'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Fines */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-medium mb-4">Boetes</h3>
        {fines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen boetes</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Uiterste betaaldatum</TableHead>
                <TableHead>Bedrag</TableHead>
                <TableHead>Beschrijving</TableHead>
                <TableHead>Betaald</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell>{formatDate(f.fine_date)}</TableCell>
                  <TableCell>{formatDate(f.due_date)}</TableCell>
                  <TableCell className="font-medium">{formatEUR(f.amount)}</TableCell>
                  <TableCell>{f.description ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={f.paid ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}>
                      {f.paid ? 'Ja' : 'Nee'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default EmployeeTransportTab;
