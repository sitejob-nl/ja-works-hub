import { useState, useMemo } from 'react';
import { useClientPortal } from '@/contexts/ClientPortalContext';
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
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
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
    queryKey: ['client-portal-timesheets', company?.id, weekOffset, tab],
    queryFn: async () => {
      let query = supabase
        .from('timesheets')
        .select('id, work_date, hours_worked, overtime_hours, status, client_approved, client_approved_at, client_rejection_notes, candidates!timesheets_candidate_id_fkey(first_name, last_name), placements!timesheets_placement_id_fkey(function_name)')
        .gte('work_date', weekStart.toISOString().split('T')[0])
        .lte('work_date', weekEnd.toISOString().split('T')[0])
        .order('work_date');

      if (tab === 'pending') {
        query = query.in('status', ['groen', 'oranje', 'rood'] as any).is('client_approved', null);
      } else {
        query = query.not('client_approved', 'is', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company?.id,
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

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
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
        <h1 className="text-xl font-semibold">Uren</h1>
        <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setSelected(new Set()); }}>
          <TabsList>
            <TabsTrigger value="pending">Te beoordelen</TabsTrigger>
            <TabsTrigger value="reviewed">Beoordeeld</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-card rounded-lg border p-3">
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-medium">{weekLabel}</p>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline">Deze week</button>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Bulk actions */}
      {isPending && selected.size > 0 && (
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
          {isPending ? 'Geen uren te beoordelen deze week' : 'Geen beoordeelde uren deze week'}
        </p>
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {isPending && (
                  <TableHead className="w-10">
                    <Checkbox checked={selected.size === timesheets.length && timesheets.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                )}
                <TableHead>Medewerker</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Uren</TableHead>
                <TableHead>Overuren</TableHead>
                <TableHead>AI Status</TableHead>
                {isPending ? <TableHead className="text-right">Acties</TableHead> : <TableHead>Beoordeling</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheets.map((t: any) => (
                <TableRow key={t.id}>
                  {isPending && (
                    <TableCell>
                      <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    {t.candidates?.first_name} {t.candidates?.last_name}
                  </TableCell>
                  <TableCell>{formatDate(t.work_date)}</TableCell>
                  <TableCell>{t.hours_worked}</TableCell>
                  <TableCell>{t.overtime_hours || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs ${aiStatusBadge[t.status] ?? ''}`}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  {isPending ? (
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
    </div>
  );
};

export default ClientPortalTimesheets;
