import { useState, useMemo } from 'react';
import { useClientPortal } from '@/contexts/ClientPortalContext';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Check, Plus, X } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';

const aiStatusBadge: Record<string, string> = {
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-orange-100 text-orange-600 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
};

const ClientPortalTimesheets = () => {
  const { session, company } = useClientPortal();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({ placement_id: '', work_date: '', hours: '8', overtime_hours: '0', notes: '' });
  const [placementFilter, setPlacementFilter] = useSearchParamState<string>('placement_id', 'all');

  const entryFlow = company?.timesheet_entry_flow ?? 'medewerker';
  const canClientEnter = entryFlow === 'opdrachtgever' || entryFlow === 'kloksysteem';
  const sourceForFlow = entryFlow === 'kloksysteem' ? 'kloksysteem' : 'klantportaal';

  // Week navigation
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1 + weekOffset * 7); // Monday
    d.setHours(0, 0, 0, 0);
    return d;
  }, [weekOffset]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const weekLabel = `${weekStart.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const { data: timesheets = [], isLoading } = useQuery({
    queryKey: ['client-portal-timesheets', company?.id, weekOffset, tab, entryFlow, placementFilter],
    queryFn: async () => {
      let query = supabase
        .from('timesheets')
        .select('id, work_date, hours, overtime_hours, status, source, employee_confirmed, employee_confirmed_at, client_approved, client_approved_at, client_rejection_notes, candidates!timesheets_candidate_id_fkey(first_name, last_name), placements!inner(company_id, function_name)')
        .eq('placements.company_id', company!.id)
        .gte('work_date', weekStart.toISOString().split('T')[0])
        .lte('work_date', weekEnd.toISOString().split('T')[0])
        .order('work_date');

      if (canClientEnter) {
        query = query.eq('source', sourceForFlow as any).eq('client_approved', true);
        if (tab === 'pending') {
          query = query.eq('employee_confirmed', false);
        } else {
          query = query.eq('employee_confirmed', true);
        }
      } else if (tab === 'pending') {
        query = query.in('status', ['groen', 'oranje', 'rood'] as any).is('client_approved', null);
      } else {
        query = query.not('client_approved', 'is', null);
      }
      if (placementFilter !== 'all') query = query.eq('placement_id', placementFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company?.id,
  });

  const { data: activePlacements = [] } = useQuery({
    queryKey: ['client-portal-active-placements-for-timesheet-entry', company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select('id, employee_id, candidate_id, function_name, hourly_rate, candidates!placements_candidate_id_fkey(first_name, last_name)')
        .eq('company_id', company!.id)
        .eq('status', 'actief' as any)
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company?.id && canClientEnter,
  });

  const approveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('timesheets')
        .update({
          client_approved: true,
          client_approved_at: new Date().toISOString(),
          client_approved_by: session?.user?.id,
        })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-portal-timesheets'] });
      qc.invalidateQueries({ queryKey: ['client-portal-stats'] });
      setSelected(new Set());
      toast.success('Uren goedgekeurd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from('timesheets')
        .update({
          client_approved: false,
          client_approved_at: new Date().toISOString(),
          client_approved_by: session?.user?.id,
          client_rejection_notes: notes || null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-portal-timesheets'] });
      qc.invalidateQueries({ queryKey: ['client-portal-stats'] });
      setRejectId(null);
      setRejectNotes('');
      toast.success('Uren afgekeurd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createTimesheetMutation = useMutation({
    mutationFn: async () => {
      const placement = activePlacements.find((p: any) => p.id === entryForm.placement_id) as any;
      if (!placement) throw new Error('Selecteer een plaatsing');
      const hours = Number(entryForm.hours);
      const overtime = Number(entryForm.overtime_hours || 0);
      if (!entryForm.work_date) throw new Error('Kies een datum');
      if (!hours || hours <= 0 || hours > 24) throw new Error('Uren moeten tussen 0 en 24 liggen');
      if (overtime < 0 || overtime > 24) throw new Error('Overuren moeten tussen 0 en 24 liggen');

      const { error } = await supabase.from('timesheets').insert({
        organization_id: company!.organization_id,
        placement_id: placement.id,
        employee_id: placement.employee_id,
        candidate_id: placement.candidate_id,
        work_date: entryForm.work_date,
        hours,
        overtime_hours: overtime || null,
        hourly_rate: placement.hourly_rate ?? null,
        notes: entryForm.notes || null,
        source: sourceForFlow as any,
        status: 'concept' as any,
        client_approved: true,
        client_approved_at: new Date().toISOString(),
        client_approved_by: session?.user?.id,
        employee_confirmed: false,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-portal-timesheets'] });
      qc.invalidateQueries({ queryKey: ['client-portal-stats'] });
      setEntryOpen(false);
      setEntryForm({ placement_id: '', work_date: '', hours: '8', overtime_hours: '0', notes: '' });
      toast.success('Uren doorgegeven aan medewerker');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === timesheets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(timesheets.map((t: any) => t.id)));
    }
  };

  const isPending = tab === 'pending';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Uren</h1>
          {canClientEnter && (
            <p className="text-xs text-muted-foreground mt-1">
              {entryFlow === 'kloksysteem' ? 'Kloksysteemuren worden door de medewerker bevestigd.' : 'Doorgegeven uren worden door de medewerker bevestigd.'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canClientEnter && (
            <Button size="sm" onClick={() => setEntryOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Uren doorgeven
            </Button>
          )}
          <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setSelected(new Set()); }}>
            <TabsList>
              <TabsTrigger value="pending">{canClientEnter ? 'Wacht op medewerker' : 'Te beoordelen'}</TabsTrigger>
              <TabsTrigger value="reviewed">{canClientEnter ? 'Bevestigd' : 'Beoordeeld'}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-card rounded-lg border p-3">
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-medium">{weekLabel}</p>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs hover:underline">Deze week</button>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {placementFilter !== 'all' && (
        <Badge variant="secondary" className="w-fit gap-2 py-1.5">
          Gefilterd op plaatsing
          <button
            type="button"
            className="rounded-sm px-1 hover:bg-background/80"
            onClick={() => setPlacementFilter('all')}
            aria-label="Plaatsingfilter wissen"
          >
            ×
          </button>
        </Badge>
      )}

      {/* Bulk actions */}
      {!canClientEnter && isPending && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 rounded-lg border border-primary/20 p-3">
          <span className="text-sm font-medium">{selected.size} geselecteerd</span>
          <Button size="sm" onClick={() => approveMutation.mutate(Array.from(selected))} disabled={approveMutation.isPending} className="gap-1">
            <Check className="h-3.5 w-3.5" /> Goedkeuren
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="ml-auto">Deselecteren</Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-center py-8">Laden...</p>
      ) : timesheets.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          {canClientEnter
            ? (isPending ? 'Geen doorgegeven uren die nog wachten op medewerkerbevestiging' : 'Geen bevestigde uren deze week')
            : (isPending ? 'Geen uren te beoordelen deze week' : 'Geen beoordeelde uren deze week')}
        </p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {isPending && !canClientEnter && (
                  <TableHead className="w-10">
                    <Checkbox checked={selected.size === timesheets.length && timesheets.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                )}
                <TableHead>Medewerker</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Uren</TableHead>
                <TableHead>Overuren</TableHead>
                <TableHead>{canClientEnter ? 'Status' : 'AI Status'}</TableHead>
                {canClientEnter ? <TableHead>Medewerker</TableHead> : isPending ? <TableHead className="text-right">Acties</TableHead> : <TableHead>Beoordeling</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheets.map((t: any) => (
                <TableRow key={t.id}>
                  {isPending && !canClientEnter && (
                    <TableCell>
                      <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    {t.candidates?.first_name} {t.candidates?.last_name}
                  </TableCell>
                  <TableCell>{formatDate(t.work_date)}</TableCell>
                  <TableCell>{t.hours}</TableCell>
                  <TableCell>{t.overtime_hours || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs ${aiStatusBadge[t.status] ?? ''}`}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  {canClientEnter ? (
                    <TableCell>
                      {t.employee_confirmed ? (
                        <Badge variant="secondary" className="text-xs bg-stat-green/10 text-stat-green border-0">Bevestigd</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700 border-0">Wacht op bevestiging</Badge>
                      )}
                    </TableCell>
                  ) : isPending ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => approveMutation.mutate([t.id])} disabled={approveMutation.isPending} className="gap-1 h-7 text-xs">
                          <Check className="h-3 w-3" /> Goed
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setRejectId(t.id); setRejectNotes(''); }} className="gap-1 h-7 text-xs text-destructive">
                          <X className="h-3 w-3" /> Afkeuren
                        </Button>
                      </div>
                    </TableCell>
                  ) : (
                    <TableCell>
                      {t.client_approved ? (
                        <Badge variant="secondary" className="text-xs bg-stat-green/10 text-stat-green border-0">Goedgekeurd</Badge>
                      ) : (
                        <div>
                          <Badge variant="secondary" className="text-xs bg-red-100 text-red-600 border-0">Afgekeurd</Badge>
                          {t.client_rejection_notes && (
                            <p className="text-xs text-muted-foreground mt-1">{t.client_rejection_notes}</p>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={(open) => { if (!open) { setRejectId(null); setRejectNotes(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uren afkeuren</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reden (optioneel)</Label>
              <Textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} placeholder="Bijv. verkeerde uren, niet gewerkt op deze dag..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectId(null)}>Annuleren</Button>
            <Button variant="destructive" onClick={() => rejectId && rejectMutation.mutate({ id: rejectId, notes: rejectNotes })} disabled={rejectMutation.isPending}>
              Afkeuren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uren doorgeven</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plaatsing *</Label>
              <Select value={entryForm.placement_id} onValueChange={(value) => setEntryForm((f) => ({ ...f, placement_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer medewerker en functie" /></SelectTrigger>
                <SelectContent>
                  {activePlacements.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.candidates?.first_name} {p.candidates?.last_name} — {p.function_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Datum *</Label>
                <Input type="date" value={entryForm.work_date} onChange={(e) => setEntryForm((f) => ({ ...f, work_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Uren *</Label>
                <Input type="number" min="0" max="24" step="0.25" value={entryForm.hours} onChange={(e) => setEntryForm((f) => ({ ...f, hours: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Overuren</Label>
                <Input type="number" min="0" max="24" step="0.25" value={entryForm.overtime_hours} onChange={(e) => setEntryForm((f) => ({ ...f, overtime_hours: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Opmerking</Label>
              <Textarea value={entryForm.notes} onChange={(e) => setEntryForm((f) => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEntryOpen(false)}>Annuleren</Button>
            <Button onClick={() => createTimesheetMutation.mutate()} disabled={createTimesheetMutation.isPending}>
              {createTimesheetMutation.isPending ? 'Opslaan...' : 'Doorgeven'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClientPortalTimesheets;
