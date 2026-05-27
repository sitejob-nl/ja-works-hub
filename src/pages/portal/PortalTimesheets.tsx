import { useState } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Check, ChevronLeft, ChevronRight, Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, addWeeks, eachDayOfInterval, isSameDay, getISOWeek } from 'date-fns';
import { nl } from 'date-fns/locale';

const resolveEmployeeRecordId = async (candidateId: string) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Geen medewerkerrecord gevonden voor deze kandidaat');
  return data.id;
};

const statusBadge: Record<string, string> = {
  concept: 'bg-muted text-muted-foreground border-0',
  ingediend: 'bg-yellow-100 text-yellow-700 border-0',
  goedgekeurd: 'bg-stat-green/10 text-stat-green border-0',
  afgekeurd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  concept: 'Concept',
  ingediend: 'Ingediend',
  goedgekeurd: 'Goedgekeurd',
  afgekeurd: 'Afgekeurd',
};

const PortalTimesheets = () => {
  const { employee } = usePortal();
  const qc = useQueryClient();
  const employeeId = employee?.id;
  const orgId = employee?.organization_id;

  const [weekOffset, setWeekOffset] = useState(0);
  const [editDay, setEditDay] = useState<Date | null>(null);
  const [hours, setHours] = useState(8);
  const [overtimeHours, setOvertimeHours] = useState(0);
  const [notes, setNotes] = useState('');

  const currentDate = addWeeks(new Date(), weekOffset);
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const weekNum = getISOWeek(weekStart);
  const year = weekStart.getFullYear();

  const wsStr = format(weekStart, 'yyyy-MM-dd');
  const weStr = format(weekEnd, 'yyyy-MM-dd');

  // Fetch active placement
  const { data: placement } = useQuery({
    queryKey: ['portal-active-placement', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('id, company_id, employee_id')
        .eq('candidate_id', employeeId!)
        .eq('status', 'actief' as any)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Fetch timesheets for this week
  const { data: timesheets } = useQuery({
    queryKey: ['portal-timesheets', employeeId, wsStr, weStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('timesheets')
        .select('*')
        .eq('candidate_id', employeeId!)
        .gte('work_date', wsStr)
        .lte('work_date', weStr)
        .order('work_date');
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  const totalHours = timesheets?.reduce((sum, t) => sum + (Number(t.hours) || 0) + (Number(t.overtime_hours) || 0), 0) ?? 0;
  const conceptEntries = timesheets?.filter((t) => t.status === 'concept' && t.employee_confirmed === true) ?? [];
  const hasConceptEntries = conceptEntries.length > 0;

  const getEntryForDay = (day: Date) => {
    const dayStr = format(day, 'yyyy-MM-dd');
    return timesheets?.find((t) => t.work_date === dayStr);
  };

  // Save timesheet entry
  const saveEntry = useMutation({
    mutationFn: async () => {
      if (!editDay || !placement || !employeeId || !orgId) throw new Error('Geen actieve plaatsing');
      const workDate = format(editDay, 'yyyy-MM-dd');
      const employeeRecordId = placement.employee_id ?? await resolveEmployeeRecordId(employeeId);
      const { error } = await supabase.from('timesheets').insert({
        candidate_id: employeeId,
        employee_id: employeeRecordId,
        organization_id: orgId,
        placement_id: placement.id,
        work_date: workDate,
        hours,
        overtime_hours: overtimeHours || null,
        notes: notes || null,
        status: 'concept' as any,
        source: 'handmatig' as any,
        employee_confirmed: true,
        employee_confirmed_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-timesheets'] });
      qc.invalidateQueries({ queryKey: ['portal-hours'] });
      setEditDay(null);
      resetForm();
      toast.success('Uren opgeslagen');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Opslaan mislukt');
    },
  });

  // Submit week
  const submitWeek = useMutation({
    mutationFn: async () => {
      const ids = conceptEntries.map((t) => t.id);
      if (ids.length === 0) return;
      const { error } = await supabase
        .from('timesheets')
        .update({ status: 'ingediend' as any })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-timesheets'] });
      toast.success('Uren ingediend');
    },
  });

  const confirmEmployerEntry = useMutation({
    mutationFn: async (timesheetId: string) => {
      const { error } = await supabase
        .from('timesheets')
        .update({
          employee_confirmed: true,
          employee_confirmed_at: new Date().toISOString(),
          status: 'ingediend' as any,
        })
        .eq('id', timesheetId)
        .eq('candidate_id', employeeId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-timesheets'] });
      qc.invalidateQueries({ queryKey: ['portal-hours'] });
      toast.success('Uren bevestigd');
    },
    onError: (err: any) => toast.error(err.message || 'Bevestigen mislukt'),
  });

  const resetForm = () => {
    setHours(8);
    setOvertimeHours(0);
    setNotes('');
  };

  const openDayEntry = (day: Date) => {
    const entry = getEntryForDay(day);
    // Can edit if no entry, or if entry is afgekeurd
    if (entry && entry.status !== 'afgekeurd') return;
    if (!placement) {
      toast.error('Je hebt geen actieve plaatsing om uren op te schrijven');
      return;
    }
    resetForm();
    setEditDay(day);
  };

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset(weekOffset - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <p className="font-semibold">Week {weekNum}, {year}</p>
            <p className="text-xs text-muted-foreground">
              {format(weekStart, 'd MMM', { locale: nl })} – {format(weekEnd, 'd MMM yyyy', { locale: nl })}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset(weekOffset + 1)} disabled={weekOffset >= 0}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Day rows */}
      <div className="bg-card rounded-xl border divide-y">
        {days.map((day) => {
          const entry = getEntryForDay(day);
          const isToday = isSameDay(day, new Date());
          const canAdd = !entry || entry.status === 'afgekeurd';
          const isRejected = entry?.status === 'afgekeurd';
          const needsEmployeeConfirmation = entry && ['klantportaal', 'kloksysteem'].includes(entry.source) && entry.employee_confirmed !== true;

          return (
            <div
              key={day.toISOString()}
              onClick={() => canAdd && openDayEntry(day)}
              className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                canAdd ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default'
              } ${isToday ? 'bg-primary/5' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="text-center w-10">
                  <p className="text-[10px] uppercase text-muted-foreground font-medium">
                    {format(day, 'EEE', { locale: nl })}
                  </p>
                  <p className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>
                    {format(day, 'd')}
                  </p>
                </div>
                <div>
                  {entry ? (
                    <div>
                      <span className="text-sm font-medium">
                        {entry.hours}u
                        {entry.overtime_hours ? ` + ${entry.overtime_hours}u overwerk` : ''}
                      </span>
                      {isRejected && entry.notes && (
                        <p className="text-xs text-destructive mt-0.5">{entry.notes}</p>
                      )}
                      {needsEmployeeConfirmation && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Door opdrachtgever doorgegeven{entry.notes ? `: ${entry.notes}` : ''}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {entry && (
                  <Badge variant="secondary" className={`text-[10px] ${statusBadge[entry.status] ?? ''}`}>
                    {needsEmployeeConfirmation ? 'Te bevestigen' : statusLabel[entry.status] ?? entry.status}
                  </Badge>
                )}
                {needsEmployeeConfirmation && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmEmployerEntry.mutate(entry.id);
                    }}
                    disabled={confirmEmployerEntry.isPending}
                  >
                    <Check className="h-3 w-3" /> Bevestig
                  </Button>
                )}
                {canAdd && (
                  <Plus className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total + submit */}
      <div className="bg-card rounded-xl border p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Totaal deze week</p>
          <p className="text-xl font-bold">{totalHours} uur</p>
        </div>
        {hasConceptEntries && (
          <Button
            onClick={() => submitWeek.mutate()}
            disabled={submitWeek.isPending}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            Week indienen ({conceptEntries.length})
          </Button>
        )}
      </div>

      {/* Entry Sheet */}
      <Sheet open={!!editDay} onOpenChange={(open) => !open && setEditDay(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editDay && format(editDay, 'EEEE d MMMM', { locale: nl })}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Uren</Label>
              <Input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Overwerk uren (optioneel)</Label>
              <Input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={overtimeHours}
                onChange={(e) => setOvertimeHours(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Opmerkingen (optioneel)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Bijv. overwerk op verzoek van opdrachtgever"
                rows={3}
              />
            </div>
            <Button
              onClick={() => saveEntry.mutate()}
              disabled={saveEntry.isPending || hours <= 0}
              className="w-full"
            >
              {saveEntry.isPending ? 'Opslaan...' : 'Uren opslaan'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default PortalTimesheets;
