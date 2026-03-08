import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const CostsTab = ({ property }: { property: any }) => {
  const qc = useQueryClient();
  const units = property.units ?? [];
  const allActive = units.flatMap((u: any) =>
    (u.housing_assignments ?? [])
      .filter((a: any) => a.status === 'ingecheckt')
      .map((a: any) => ({ ...a, unitName: u.name }))
  );

  const totalDeductions = allActive.reduce((s: number, a: any) => s + (Number(a.monthly_deduction) || 0), 0);
  const unpaidDeposits = allActive.filter((a: any) => !a.deposit_paid).length;

  const toggleDeposit = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase.from('housing_assignments').update({ deposit_paid: paid }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      toast.success('Borg status bijgewerkt');
    },
  });

  const updateRentPaid = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string }) => {
      const { error } = await supabase.from('housing_assignments').update({ rent_paid_until: date || null }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      toast.success('Huur betaald tot bijgewerkt');
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Maandelijkse huur</p>
          <p className="text-xl font-semibold mt-1">{formatEUR(property.monthly_rent)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Kostprijs</p>
          <p className="text-xl font-semibold mt-1">{formatEUR(property.cost_price)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Totale inhoudingen</p>
          <p className="text-xl font-semibold mt-1">{formatEUR(totalDeductions)}</p>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Openstaande borg</p>
          <p className="text-xl font-semibold mt-1">{unpaidDeposits}</p>
        </div>
      </div>

      {allActive.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Geen actieve bewoners</p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Kamer</TableHead>
                <TableHead>Maandelijkse inhouding</TableHead>
                <TableHead>Borg</TableHead>
                <TableHead>Huur betaald tot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allActive.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.employees?.candidates?.first_name} {a.employees?.candidates?.last_name}
                  </TableCell>
                  <TableCell>{a.unitName}</TableCell>
                  <TableCell>{formatEUR(a.monthly_deduction)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleDeposit.mutate({ id: a.id, paid: !a.deposit_paid })}
                    >
                      <Badge variant="secondary" className={`text-xs cursor-pointer ${a.deposit_paid ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-red-100 text-red-600 border-0'}`}>
                        {a.deposit_paid ? 'Betaald' : 'Niet betaald'}
                      </Badge>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      defaultValue={a.rent_paid_until ?? ''}
                      onBlur={(e) => updateRentPaid.mutate({ id: a.id, date: e.target.value })}
                      className="w-40 h-8 text-xs"
                    />
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

export default CostsTab;
