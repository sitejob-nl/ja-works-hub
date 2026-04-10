import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { logAudit } from '@/lib/audit';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatEUR } from '@/lib/format';
import { toast } from 'sonner';
import { Zap } from 'lucide-react';

const WEEKS_PER_MONTH = 4.33;

const CostsTab = ({ property }: { property: any }) => {
  const qc = useQueryClient();
  const units = property.units ?? [];
  const allActive = units.flatMap((u: any) =>
    (u.housing_assignments ?? [])
      .filter((a: any) => a.status === 'ingecheckt')
      .map((a: any) => ({ ...a, unitName: u.name }))
  );

  // Get weekly deduction per assignment
  const getWeeklyDeduction = (a: any): number => {
    if (a.deduction_amount != null) {
      return a.payment_frequency === 'wekelijks'
        ? Number(a.deduction_amount)
        : Number(a.deduction_amount) / WEEKS_PER_MONTH;
    }
    return (Number(a.monthly_deduction) || 0) / WEEKS_PER_MONTH;
  };

  const totalWeeklyDeductions = allActive.reduce((s: number, a: any) => s + getWeeklyDeduction(a), 0);
  const unpaidDeposits = allActive.filter((a: any) => !a.deposit_paid).length;

  // Pandkosten zijn maandelijks opgeslagen, omrekenen naar week
  const costItems = useMemo(() => [
    { label: 'Huur', value: property.monthly_rent },
    { label: 'Gas', value: property.cost_gas },
    { label: 'Water', value: property.cost_water },
    { label: 'Elektra', value: property.cost_electra, energy: true },
    { label: 'Gem. belasting', value: property.cost_municipal_tax },
    { label: 'Overig', value: property.cost_other },
  ], [property]);

  const totalPandkostenMaand = useMemo(
    () => costItems.reduce((s, c) => s + (Number(c.value) || 0), 0),
    [costItems]
  );
  const totalPandkostenWeek = totalPandkostenMaand / WEEKS_PER_MONTH;

  const nettoWeek = totalWeeklyDeductions - totalPandkostenWeek;

  const toggleDeposit = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase.from('housing_assignments').update({ deposit_paid: paid }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      logAudit({ action: 'update', tableName: 'housing_assignments', recordId: variables.id, newValues: { deposit_paid: variables.paid } });
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      toast.success('Borg status bijgewerkt');
    },
  });

  const updateRentPaid = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string }) => {
      const { error } = await supabase.from('housing_assignments').update({ rent_paid_until: date || null }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      logAudit({ action: 'update', tableName: 'housing_assignments', recordId: variables.id, newValues: { rent_paid_until: variables.date } });
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      toast.success('Huur betaald tot bijgewerkt');
    },
  });

  return (
    <div className="space-y-6">
      {/* Pandkosten KPI cards — per week */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Pandkosten per week</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {costItems.map((c) => (
            <Card key={c.label} className="p-4">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                {c.energy && property.energy_wizard_linked && (
                  <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                    <Zap className="h-3 w-3" /> EnergyWizard
                  </Badge>
                )}
              </div>
              <p className="text-xl font-semibold mt-1">{formatEUR((Number(c.value) || 0) / WEEKS_PER_MONTH)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{formatEUR(c.value)}/mnd</p>
            </Card>
          ))}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <p className="text-xs text-muted-foreground font-medium">Totaal per week</p>
            <p className="text-xl font-bold mt-1 text-foreground">{formatEUR(totalPandkostenWeek)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{formatEUR(totalPandkostenMaand)}/mnd</p>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Resultaat card — per week */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Resultaat per week</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Inhoudingen bewoners</p>
            <p className="text-lg font-semibold mt-1">{formatEUR(totalWeeklyDeductions)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pandkosten</p>
            <p className="text-lg font-semibold mt-1">- {formatEUR(totalPandkostenWeek)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Netto resultaat</p>
            <p className={`text-lg font-bold mt-1 ${nettoWeek >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatEUR(nettoWeek)}
            </p>
          </div>
        </div>
      </Card>

      <Separator />

      {/* Bewonerskosten */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Bewonerskosten</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Totale inhoudingen /week</p>
            <p className="text-xl font-semibold mt-1">{formatEUR(totalWeeklyDeductions)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Openstaande borg</p>
            <p className="text-xl font-semibold mt-1">{unpaidDeposits}</p>
          </Card>
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
                  <TableHead>Per week</TableHead>
                  <TableHead>Borg</TableHead>
                  <TableHead>Huur betaald tot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allActive.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.candidates?.first_name} {a.candidates?.last_name}
                    </TableCell>
                    <TableCell>{a.unitName}</TableCell>
                    <TableCell>
                      <span className="font-medium">{formatEUR(getWeeklyDeduction(a))}</span>
                      {a.deduction_amount != null && a.payment_frequency === 'maandelijks' && (
                        <span className="text-[10px] text-muted-foreground ml-1">({formatEUR(a.deduction_amount)}/mnd)</span>
                      )}
                    </TableCell>
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
    </div>
  );
};

export default CostsTab;
