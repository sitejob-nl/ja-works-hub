import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useHasRole } from '@/contexts/AuthContext';
import { Plus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityLink } from '@/components/ui/entity-link';
import { resolveEmployeeId } from '@/lib/assignments';
import { roomHasFreeBedOn } from '@/lib/housing-availability';
import { formatDate, formatEUR } from '@/lib/format';
import { toast } from 'sonner';

const EmployeeHousingTab = ({ candidateId }: { candidateId: string }) => {
  const orgId = useOrganizationId();
  const canAssignHousing = useHasRole(['admin', 'intercedent', 'backoffice', 'facility']);
  const qc = useQueryClient();

  const { data: assignments = [] } = useQuery({
    queryKey: qk.employees.housingAssignments(orgId, candidateId),
    queryFn: async () => {
      return unwrapList<any>(supabase.from('housing_assignments')
        .select('*, units!housing_assignments_unit_id_fkey(id, name, properties!units_property_id_fkey(id, name, address_street, address_city))')
        .eq('organization_id', orgId)
        .eq('candidate_id', candidateId)
        .order('check_in_date', { ascending: false }));
    },
  });

  const { data: keys = [] } = useQuery({
    queryKey: qk.employees.keyRegistrations(orgId, candidateId),
    queryFn: async () => {
      return unwrapList<any>(supabase.from('key_registrations')
        .select('*, units!key_registrations_unit_id_fkey(name)')
        .eq('organization_id', orgId)
        .eq('candidate_id', candidateId)
        .order('issued_at', { ascending: false }));
    },
  });

  const [assignOpen, setAssignOpen] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [deductionAmount, setDeductionAmount] = useState('');
  const [paymentFrequency, setPaymentFrequency] = useState<'wekelijks' | 'maandelijks'>('wekelijks');

  const { data: eligibleUnits = [] } = useQuery({
    queryKey: qk.employees.assignableUnits(orgId),
    queryFn: async () => {
      // 'onderhoud'/'geblokkeerd' panden vallen hard af; de rest beoordelen we op datum-bezetting.
      return unwrapList<any>(supabase.from('units')
        .select('id, name, capacity, status, weekly_cost, properties!units_property_id_fkey(id, name, address_street, address_city), housing_assignments!housing_assignments_unit_id_fkey(id, status, check_in_date, check_out_date)')
        .eq('organization_id', orgId)
        .in('status', ['beschikbaar', 'gereserveerd', 'bezet'] as any)
        .order('name'));
    },
    enabled: assignOpen,
  });

  const propertyLabel = (p: any) => p?.name || [p?.address_street, p?.address_city].filter(Boolean).join(', ') || 'Pand';
  // Effectieve datum: de gekozen incheck-datum, of vandaag als die nog leeg is.
  const todayStr = new Date().toISOString().slice(0, 10);
  const effectiveDate = checkInDate || todayStr;
  // Kamers met een vrij bed op de effectieve datum. Bij een toekomstige datum zie je
  // dus de kamers die deze persoon dán krijgt (die tegen die tijd vrijkomen).
  const availableUnits: any[] = (eligibleUnits as any[]).filter((u) => roomHasFreeBedOn(u, effectiveDate));
  // Unieke panden met minstens één beschikbare kamer op die datum.
  const availableProperties = Array.from(
    new Map(availableUnits.map((u) => [u.properties?.id, u.properties] as [string, any]).filter(([id]) => id)).values(),
  );
  const unitsForProperty = availableUnits.filter((u) => u.properties?.id === propertyId);

  const assignRoom = useMutation({
    mutationFn: async () => {
      const candidate = await unwrap(supabase.from('candidates')
        .select('id, employee_number, employee_status')
        .eq('organization_id', orgId)
        .eq('id', candidateId)
        .single());
      const employeeId = await resolveEmployeeId(candidate, orgId, checkInDate);
      const deductionNum = deductionAmount ? Number(deductionAmount) : null;
      await unwrap(supabase.from('housing_assignments').insert({
        organization_id: orgId,
        unit_id: unitId,
        employee_id: employeeId,
        candidate_id: candidateId,
        status: 'gereserveerd' as const,
        check_in_date: checkInDate,
        deduction_amount: deductionNum,
        payment_frequency: paymentFrequency,
        monthly_deduction: paymentFrequency === 'maandelijks' ? deductionNum : (deductionNum ? Math.round(deductionNum * 4.33 * 100) / 100 : null),
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employees.housingAssignments(orgId, candidateId) });
      toast.success('Kamer toegewezen');
      setAssignOpen(false);
      setPropertyId(''); setUnitId(''); setCheckInDate(''); setDeductionAmount('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const active = assignments.find((a: any) => a.status === 'ingecheckt');
  const reserved = assignments.find((a: any) => a.status === 'gereserveerd');
  const hasActiveHousing = !!active || !!reserved;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Huisvesting</h3>
          {canAssignHousing && !hasActiveHousing && (
            <Button size="sm" onClick={() => setAssignOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Wijs kamer toe</Button>
          )}
        </div>
        {active && (
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-xs text-muted-foreground">Pand</p><p className="text-sm"><EntityLink type="property" id={(active as any).units?.properties?.id}>{propertyLabel((active as any).units?.properties)}</EntityLink></p></div>
            <div><p className="text-xs text-muted-foreground">Kamer</p><p className="text-sm">{(active as any).units?.name ?? '—'}</p></div>
            <div><p className="text-xs text-muted-foreground">Check-in</p><p className="text-sm">{formatDate(active.check_in_date)}</p></div>
            <div><p className="text-xs text-muted-foreground">Maandelijkse inhouding</p><p className="text-sm">{formatEUR(active.monthly_deduction)}</p></div>
            <div><p className="text-xs text-muted-foreground">Borg betaald</p><p className="text-sm">{active.deposit_paid ? 'Ja' : 'Nee'}</p></div>
            <div><p className="text-xs text-muted-foreground">Huur betaald tot</p><p className="text-sm">{formatDate(active.rent_paid_until)}</p></div>
          </div>
        )}
        {reserved && (
          <div className={active ? 'mt-4 pt-4 border-t' : ''}>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-0 text-xs">Gereserveerd</Badge>
              <span className="text-xs text-muted-foreground">vanaf {formatDate(reserved.check_in_date)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-muted-foreground">Pand</p><p className="text-sm"><EntityLink type="property" id={reserved.units?.properties?.id}>{propertyLabel(reserved.units?.properties)}</EntityLink></p></div>
              <div><p className="text-xs text-muted-foreground">Kamer</p><p className="text-sm">{reserved.units?.name ?? '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Maandelijkse inhouding</p><p className="text-sm">{formatEUR(reserved.monthly_deduction)}</p></div>
            </div>
          </div>
        )}
        {!active && !reserved && (
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
      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Kamer toewijzen</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Check-in datum *</Label>
              <Input
                type="date"
                value={checkInDate}
                onChange={(e) => { setCheckInDate(e.target.value); setPropertyId(''); setUnitId(''); }}
              />
              <p className="text-xs text-muted-foreground mt-1">Standaard nu beschikbaar. Kies een toekomstige datum om te zien welke kamer deze persoon dán krijgt.</p>
            </div>
            <div>
              <Label>Pand (adres) *</Label>
              <Select value={propertyId} onValueChange={(v) => { setPropertyId(v); setUnitId(''); }}>
                <SelectTrigger><SelectValue placeholder="Selecteer pand" /></SelectTrigger>
                <SelectContent>
                  {availableProperties.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Geen panden met vrije kamers op deze datum</div>
                  )}
                  {availableProperties.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{propertyLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Kamer *</Label>
              <Select value={unitId} onValueChange={setUnitId} disabled={!propertyId}>
                <SelectTrigger><SelectValue placeholder={propertyId ? 'Selecteer kamer' : 'Kies eerst een pand'} /></SelectTrigger>
                <SelectContent>
                  {propertyId && unitsForProperty.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Geen vrije kamers in dit pand op deze datum</div>
                  )}
                  {unitsForProperty.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}{u.weekly_cost ? ` (${formatEUR(u.weekly_cost)}/wk)` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Inhouding</Label>
              <div className="flex gap-2">
                <Input type="number" value={deductionAmount} onChange={(e) => setDeductionAmount(e.target.value)} placeholder="0,00" />
                <Select value={paymentFrequency} onValueChange={(v) => setPaymentFrequency(v as 'wekelijks' | 'maandelijks')}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wekelijks">per week</SelectItem>
                    <SelectItem value="maandelijks">per maand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setAssignOpen(false)}>Annuleren</Button>
              <Button onClick={() => assignRoom.mutate()} disabled={!unitId || !checkInDate || assignRoom.isPending}>
                {assignRoom.isPending ? 'Toewijzen...' : 'Toewijzen'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default EmployeeHousingTab;
