import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { logAudit } from '@/lib/audit';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EntityLink } from '@/components/ui/entity-link';
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
  const units = useMemo(() => property.units ?? [], [property.units]);
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
    { label: 'Afval', value: property.cost_waste },
    { label: 'Internet', value: property.cost_internet },
    { label: 'Overig', value: property.cost_other },
  ], [property]);

  const totalPandkostenMaand = useMemo(
    () => costItems.reduce((s, c) => s + (Number(c.value) || 0), 0),
    [costItems]
  );
  const totalPandkostenWeek = totalPandkostenMaand / WEEKS_PER_MONTH;

  const nettoWeek = totalWeeklyDeductions - totalPandkostenWeek;

  // Verdeel pand-kosten over kamers naar rato van capaciteit én als gelijke kamerprijs.
  const perUnitRows = useMemo(() => {
    if (units.length === 0) return [];
    const totalCapacity = units.reduce((s: number, u) => s + (Number(u.capacity) || 0), 0);
    const rentMonth = Number(property.monthly_rent) || 0;
    const gwlMonth = (Number(property.cost_gas) || 0) + (Number(property.cost_water) || 0) + (Number(property.cost_electra) || 0);
    const taxMonth = Number(property.cost_municipal_tax) || 0;
    const otherMonth = (Number(property.cost_other) || 0)
      + (Number(property.cost_waste) || 0)
      + (Number(property.cost_internet) || 0);

    return [...units]
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true }))
      .map((u) => {
        const share = totalCapacity > 0
          ? (Number(u.capacity) || 0) / totalCapacity
          : 1 / units.length;
        const rentWeek = (rentMonth * share) / WEEKS_PER_MONTH;
        const gwlWeek = (gwlMonth * share) / WEEKS_PER_MONTH;
        const taxWeek = (taxMonth * share) / WEEKS_PER_MONTH;
        const otherWeek = (otherMonth * share) / WEEKS_PER_MONTH;
        const totalCostWeek = rentWeek + gwlWeek + taxWeek + otherWeek;
        const roomShare = units.length > 0 ? 1 / units.length : 0;
        const totalCostByRoomWeek = ((rentMonth + gwlMonth + taxMonth + otherMonth) * roomShare) / WEEKS_PER_MONTH;
        const active = (u.housing_assignments ?? []).filter((a) => a.status === 'ingecheckt');
        const deductionWeek = active.reduce((s: number, a) => s + getWeeklyDeduction(a), 0);
        const margin = deductionWeek - totalCostWeek;
        const marginByRoom = deductionWeek - totalCostByRoomWeek;
        return {
          id: u.id,
          name: u.name ?? '—',
          capacity: Number(u.capacity) || 0,
          occupied: active.length,
          rentWeek,
          gwlWeek,
          taxWeek,
          otherWeek,
          totalCostWeek,
          totalCostByRoomWeek,
          deductionWeek,
          margin,
          marginByRoom,
        };
      });
  }, [units, property.monthly_rent, property.cost_gas, property.cost_water, property.cost_electra,
    property.cost_municipal_tax, property.cost_waste, property.cost_internet, property.cost_other]);

  const perUnitTotals = useMemo(() => perUnitRows.reduce(
    (acc, r) => ({
      capacity: acc.capacity + r.capacity,
      occupied: acc.occupied + r.occupied,
      rentWeek: acc.rentWeek + r.rentWeek,
      gwlWeek: acc.gwlWeek + r.gwlWeek,
      taxWeek: acc.taxWeek + r.taxWeek,
      otherWeek: acc.otherWeek + r.otherWeek,
      totalCostWeek: acc.totalCostWeek + r.totalCostWeek,
      totalCostByRoomWeek: acc.totalCostByRoomWeek + r.totalCostByRoomWeek,
      deductionWeek: acc.deductionWeek + r.deductionWeek,
      margin: acc.margin + r.margin,
      marginByRoom: acc.marginByRoom + r.marginByRoom,
    }),
    { capacity: 0, occupied: 0, rentWeek: 0, gwlWeek: 0, taxWeek: 0, otherWeek: 0, totalCostWeek: 0, totalCostByRoomWeek: 0, deductionWeek: 0, margin: 0, marginByRoom: 0 }
  ), [perUnitRows]);

  const toggleDeposit = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      await unwrap(supabase.from('housing_assignments').update({ deposit_paid: paid }).eq('id', id));
    },
    onSuccess: (_data, variables) => {
      logAudit({ action: 'update', tableName: 'housing_assignments', recordId: variables.id, newValues: { deposit_paid: variables.paid } });
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      toast.success('Borg status bijgewerkt');
    },
  });

  // Punt 20 — naast het ja/nee-vinkje ook het daadwerkelijk betaalde bedrag.
  const updateDepositAmount = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: string }) => {
      const value = amount.trim() === '' ? null : Number(amount);
      await unwrap(supabase.from('housing_assignments').update({ deposit_amount: value }).eq('id', id));
    },
    onSuccess: (_data, variables) => {
      logAudit({ action: 'update', tableName: 'housing_assignments', recordId: variables.id, newValues: { deposit_amount: variables.amount } });
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      toast.success('Borgbedrag bijgewerkt');
    },
  });

  const updateRentPaid = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string }) => {
      await unwrap(supabase.from('housing_assignments').update({ rent_paid_until: date || null }).eq('id', id));
    },
    onSuccess: (_data, variables) => {
      logAudit({ action: 'update', tableName: 'housing_assignments', recordId: variables.id, newValues: { rent_paid_until: variables.date } });
      qc.invalidateQueries({ queryKey: qk.housing.property(property.id) });
      toast.success('Huur betaald tot bijgewerkt');
    },
  });

  return (
    <div className="space-y-6">
      {/* Punt 19 — de kosten worden per maand ingevoerd en opgeslagen, dus tonen we ze
          ook per maand. De omrekening naar week staat in één balk eronder. */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Pandkosten per maand</h3>
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
              <p className="text-xl font-semibold mt-1">{formatEUR(c.value)}</p>
            </Card>
          ))}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <p className="text-xs text-muted-foreground font-medium">Totaal per maand</p>
            <p className="text-xl font-bold mt-1 text-foreground">{formatEUR(totalPandkostenMaand)}</p>
          </Card>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/50 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">Omgerekend per week</span>
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-foreground">{formatEUR(totalPandkostenWeek)}</span>
            <span className="text-xs text-muted-foreground">({WEEKS_PER_MONTH} weken per maand)</span>
          </span>
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

      {/* Per kamer — verdeling van pand-kosten naar rato van capaciteit en gelijk per kamer */}
      {perUnitRows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Per kamer</h3>
          <p className="text-xs text-muted-foreground mb-3">Toont zowel de theoretische verdeling op capaciteit als de praktische verdeling per kamer.</p>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kamer</TableHead>
                  <TableHead>Capaciteit</TableHead>
                  <TableHead>Bezet</TableHead>
                  <TableHead>Huur/wk</TableHead>
                  <TableHead>GWL/wk</TableHead>
                  <TableHead>Belasting/wk</TableHead>
                  <TableHead>Overig/wk</TableHead>
                  <TableHead>Kosten/wk capaciteit</TableHead>
                  <TableHead>Kosten/wk kamer</TableHead>
                  <TableHead>Inhouding/wk</TableHead>
                  <TableHead>Marge capaciteit</TableHead>
                  <TableHead>Marge kamer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perUnitRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.capacity}</TableCell>
                    <TableCell>{r.occupied}</TableCell>
                    <TableCell>{formatEUR(r.rentWeek)}</TableCell>
                    <TableCell>{formatEUR(r.gwlWeek)}</TableCell>
                    <TableCell>{formatEUR(r.taxWeek)}</TableCell>
                    <TableCell>{formatEUR(r.otherWeek)}</TableCell>
                    <TableCell className="font-medium">{formatEUR(r.totalCostWeek)}</TableCell>
                    <TableCell className="font-medium">{formatEUR(r.totalCostByRoomWeek)}</TableCell>
                    <TableCell>{formatEUR(r.deductionWeek)}</TableCell>
                    <TableCell className={`font-semibold ${r.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatEUR(r.margin)}
                    </TableCell>
                    <TableCell className={`font-semibold ${r.marginByRoom >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatEUR(r.marginByRoom)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Totaal</TableCell>
                  <TableCell>{perUnitTotals.capacity}</TableCell>
                  <TableCell>{perUnitTotals.occupied}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.rentWeek)}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.gwlWeek)}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.taxWeek)}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.otherWeek)}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.totalCostWeek)}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.totalCostByRoomWeek)}</TableCell>
                  <TableCell>{formatEUR(perUnitTotals.deductionWeek)}</TableCell>
                  <TableCell className={perUnitTotals.margin >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatEUR(perUnitTotals.margin)}
                  </TableCell>
                  <TableCell className={perUnitTotals.marginByRoom >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatEUR(perUnitTotals.marginByRoom)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}

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
                  <TableHead>Borgbedrag</TableHead>
                  <TableHead>Huur betaald tot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allActive.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <EntityLink type="candidate" id={a.candidates?.id}>{a.candidates?.first_name} {a.candidates?.last_name}</EntityLink>
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
                        type="number"
                        step="0.01"
                        className="h-8 w-28"
                        placeholder="—"
                        defaultValue={a.deposit_amount ?? ''}
                        onBlur={(e) => {
                          const next = e.target.value;
                          const current = a.deposit_amount == null ? '' : String(a.deposit_amount);
                          if (next !== current) updateDepositAmount.mutate({ id: a.id, amount: next });
                        }}
                      />
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
