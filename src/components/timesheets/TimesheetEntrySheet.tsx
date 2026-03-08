import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [rateCode, setRateCode] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) {
      setEmployeeId(''); setPlacementId(''); setWorkDate(''); setHours(''); setOvertimeHours('0'); setRateCode(''); setNotes('');
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

  const selectedPlacement = (placements ?? []).find((p: any) => p.id === placementId);

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
        rate_code: rateCode || null,
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
            <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setPlacementId(''); }}>
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
              <Select value={placementId} onValueChange={setPlacementId}>
                <SelectTrigger><SelectValue placeholder="Selecteer plaatsing" /></SelectTrigger>
                <SelectContent>
                  {(placements ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{(p.companies as any)?.name} — {p.function_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {placements?.length === 0 && <p className="text-xs text-muted-foreground mt-1">Geen actieve plaatsingen voor deze medewerker</p>}
            </div>
          )}

          <div><Label>Datum *</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Uren *</Label><Input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            <div><Label>Overwerk</Label><Input type="number" step="0.25" min="0" value={overtimeHours} onChange={(e) => setOvertimeHours(e.target.value)} /></div>
          </div>
          <div><Label>Tariefcode</Label><Input value={rateCode} onChange={(e) => setRateCode(e.target.value)} /></div>
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
