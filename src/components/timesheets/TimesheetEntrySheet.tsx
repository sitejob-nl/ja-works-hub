import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatEUR } from '@/lib/format';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TimesheetEntrySheet = ({ open, onOpenChange }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [placementId, setPlacementId] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [hours, setHours] = useState('');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [hourTypeId, setHourTypeId] = useState('');
  const [travelKm, setTravelKm] = useState('');
  const [travelTypeId, setTravelTypeId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) {
      setEmployeeId(''); setPlacementId(''); setWorkDate(''); setHours(''); setOvertimeHours('0');
      setHourTypeId(''); setTravelKm(''); setTravelTypeId(''); setNotes('');
    }
  }, [open]);

  const { data: employees } = useQuery({
    queryKey: ['employees-active-for-timesheet'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, candidates!employees_candidate_id_fkey(first_name, last_name)').eq('status', 'actief' as any).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const { data: placements } = useQuery({
    queryKey: ['placements-for-employee', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placements').select('id, function_name, hourly_rate, companies!placements_company_id_fkey(name)').eq('employee_id', employeeId).eq('status', 'actief' as any);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  const { data: hourTypes = [] } = useQuery({
    queryKey: ['placement-hour-types', placementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placement_hour_types').select('*').eq('placement_id', placementId).order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!placementId,
  });

  const { data: travelTypes = [] } = useQuery({
    queryKey: ['placement-travel-types', placementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placement_travel_types').select('*').eq('placement_id', placementId).order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!placementId,
  });

  const { data: allowances = [] } = useQuery({
    queryKey: ['placement-allowances', placementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('placement_allowances').select('*').eq('placement_id', placementId).order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!placementId,
  });

  const selectedPlacement = (placements ?? []).find((p: any) => p.id === placementId);
  const selectedHourType = hourTypes.find((h: any) => h.id === hourTypeId);
  const selectedTravelType = travelTypes.find((t: any) => t.id === travelTypeId);

  // Auto-calculations
  const surchargeAmount = useMemo(() => {
    if (!selectedHourType || !selectedPlacement) return 0;
    const h = parseFloat(hours) || 0;
    const rate = selectedPlacement.hourly_rate ?? 0;
    const fromMultiplier = h * rate * (selectedHourType.multiplier - 1);
    const fromFixed = h * (selectedHourType.surcharge_amount ?? 0);
    return fromMultiplier + fromFixed;
  }, [hours, selectedHourType, selectedPlacement]);

  const travelAmount = useMemo(() => {
    if (!selectedTravelType) return 0;
    const km = parseFloat(travelKm) || 0;
    if (selectedTravelType.fixed_amount) return selectedTravelType.fixed_amount;
    return km * (selectedTravelType.rate_per_km ?? 0);
  }, [travelKm, selectedTravelType]);

  const allowancesAmount = useMemo(() => {
    // Sum daily allowances (simple: per_uur × hours, per_dag × 1)
    const h = parseFloat(hours) || 0;
    return allowances.reduce((sum: number, a: any) => {
      if (a.frequency === 'per_uur') return sum + a.amount * h;
      if (a.frequency === 'per_dag') return sum + a.amount;
      return sum;
    }, 0);
  }, [allowances, hours]);

  // Auto-select default hour type
  useEffect(() => {
    if (hourTypes.length > 0 && !hourTypeId) {
      const def = hourTypes.find((h: any) => h.is_default);
      if (def) setHourTypeId(def.id);
    }
  }, [hourTypes, hourTypeId]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('timesheets').insert({
        organization_id: orgId,
        employee_id: employeeId,
        placement_id: placementId,
        work_date: workDate,
        hours: parseFloat(hours),
        overtime_hours: parseFloat(overtimeHours) || 0,
        hourly_rate: selectedPlacement?.hourly_rate ?? null,
        hour_type_id: hourTypeId || null,
        travel_km: travelKm ? parseFloat(travelKm) : null,
        travel_type_id: travelTypeId || null,
        travel_amount: travelAmount || null,
        surcharge_amount: surchargeAmount || null,
        allowances_amount: allowancesAmount || null,
        notes: notes || null,
        source: 'handmatig' as any,
        status: 'concept' as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Uren geregistreerd');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>Uren invoeren</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Medewerker *</Label>
            <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setPlacementId(''); setHourTypeId(''); setTravelTypeId(''); }}>
              <SelectTrigger><SelectValue placeholder="Selecteer medewerker" /></SelectTrigger>
              <SelectContent>
                {(employees ?? []).map((e: any) => {
                  const c = e.candidates as any;
                  return <SelectItem key={e.id} value={e.id}>{c?.first_name} {c?.last_name}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>

          {employeeId && (
            <div>
              <Label>Plaatsing *</Label>
              <Select value={placementId} onValueChange={(v) => { setPlacementId(v); setHourTypeId(''); setTravelTypeId(''); }}>
                <SelectTrigger><SelectValue placeholder="Selecteer plaatsing" /></SelectTrigger>
                <SelectContent>
                  {(placements ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{(p.companies as any)?.name} — {p.function_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {placements?.length === 0 && <p className="text-xs text-muted-foreground mt-1">Geen actieve plaatsingen</p>}
            </div>
          )}

          <div><Label>Datum *</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Uren *</Label><Input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            <div><Label>Overwerk</Label><Input type="number" step="0.25" min="0" value={overtimeHours} onChange={(e) => setOvertimeHours(e.target.value)} /></div>
          </div>

          {placementId && hourTypes.length > 0 && (
            <div>
              <Label>Uurtype</Label>
              <Select value={hourTypeId} onValueChange={setHourTypeId}>
                <SelectTrigger><SelectValue placeholder="Selecteer uurtype" /></SelectTrigger>
                <SelectContent>
                  {hourTypes.map((h: any) => (
                    <SelectItem key={h.id} value={h.id}>{h.code} — {h.description} ({h.multiplier}×)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {placementId && travelTypes.length > 0 && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Reistype</Label>
                  <Select value={travelTypeId} onValueChange={setTravelTypeId}>
                    <SelectTrigger><SelectValue placeholder="Selecteer" /></SelectTrigger>
                    <SelectContent>
                      {travelTypes.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.code} — {t.description}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Kilometers</Label><Input type="number" step="0.1" min="0" value={travelKm} onChange={(e) => setTravelKm(e.target.value)} /></div>
              </div>
            </>
          )}

          {/* Auto-calculated summary */}
          {placementId && (surchargeAmount > 0 || travelAmount > 0 || allowancesAmount > 0) && (
            <>
              <Separator />
              <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">Berekende bedragen</p>
                {surchargeAmount > 0 && <div className="flex justify-between"><span>Toeslag</span><span className="font-medium">{formatEUR(surchargeAmount)}</span></div>}
                {travelAmount > 0 && <div className="flex justify-between"><span>Reiskosten</span><span className="font-medium">{formatEUR(travelAmount)}</span></div>}
                {allowancesAmount > 0 && <div className="flex justify-between"><span>Vergoedingen</span><span className="font-medium">{formatEUR(allowancesAmount)}</span></div>}
              </div>
            </>
          )}

          <div><Label>Notities</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!employeeId || !placementId || !workDate || !hours || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default TimesheetEntrySheet;
