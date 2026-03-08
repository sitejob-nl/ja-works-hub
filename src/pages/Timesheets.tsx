import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format, getISOWeek } from 'date-fns';
import { nl } from 'date-fns/locale';
import { Clock, Plus, Upload, ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { formatDate } from '@/lib/format';
import TimesheetEntrySheet from '@/components/timesheets/TimesheetEntrySheet';
import TimesheetCsvImport from '@/components/timesheets/TimesheetCsvImport';

const PAGE_SIZE = 25;

const statusBadge: Record<string, string> = {
  concept: 'bg-muted text-muted-foreground border-0',
  ingediend: 'bg-blue-100 text-blue-700 border-0',
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-orange-100 text-orange-600 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
  goedgekeurd: 'bg-stat-green/10 text-stat-green border-0',
  afgekeurd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  concept: 'Concept', ingediend: 'Ingediend', groen: 'Groen', oranje: 'Oranje', rood: 'Rood', goedgekeurd: 'Goedgekeurd', afgekeurd: 'Afgekeurd',
};
const sourceBadge: Record<string, string> = {
  handmatig: 'bg-muted text-muted-foreground border-0',
  klantportaal: 'bg-blue-100 text-blue-700 border-0',
  csv_import: 'bg-purple-100 text-purple-700 border-0',
  kloksysteem: 'bg-orange-100 text-orange-600 border-0',
};
const sourceLabel: Record<string, string> = {
  handmatig: 'Handmatig', klantportaal: 'Klantportaal', csv_import: 'CSV Import', kloksysteem: 'Kloksysteem',
};

const Timesheets = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekRef, setWeekRef] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [entryOpen, setEntryOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const weekStart = format(startOfWeek(weekRef, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(weekRef, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekNum = getISOWeek(weekRef);
  const weekLabel = `Week ${weekNum} (${format(startOfWeek(weekRef, { weekStartsOn: 1 }), 'dd-MM', { locale: nl })} t/m ${format(endOfWeek(weekRef, { weekStartsOn: 1 }), 'dd-MM', { locale: nl })})`;

  const { data: employees } = useQuery({
    queryKey: ['employees-active-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, candidates!employees_candidate_id_fkey(first_name, last_name)').eq('status', 'actief' as any);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['timesheets', weekStart, weekEnd, statusFilter, employeeFilter, page],
    queryFn: async () => {
      let query = supabase.from('timesheets').select(`
        *,
        employees!timesheets_employee_id_fkey(
          id,
          candidates!employees_candidate_id_fkey(first_name, last_name)
        ),
        placements!timesheets_placement_id_fkey(
          id,
          companies!placements_company_id_fkey(name)
        )
      `, { count: 'exact' })
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd);

      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);
      if (employeeFilter !== 'all') query = query.eq('employee_id', employeeFilter);

      query = query.order('work_date', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { timesheets: data ?? [], total: count ?? 0 };
    },
  });

  const timesheets = data?.timesheets ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Stats
  const stats = useMemo(() => {
    const ts = timesheets;
    return {
      totalHours: ts.reduce((s, t: any) => s + (t.hours ?? 0), 0),
      totalOvertime: ts.reduce((s, t: any) => s + (t.overtime_hours ?? 0), 0),
      approved: ts.filter((t: any) => t.status === 'goedgekeurd').length,
      attention: ts.filter((t: any) => ['oranje', 'rood'].includes(t.status)).length,
    };
  }, [timesheets]);

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

  const statusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const updates: any = { status };
      if (status === 'goedgekeurd') {
        updates.approved_by = user?.id;
        updates.approved_at = new Date().toISOString();
      }
      const { error } = await supabase.from('timesheets').update(updates).in('id', ids);
      if (error) throw error;
    },
    onSuccess: (_, { ids, status }) => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      setSelected(new Set());
      for (const id of ids) {
        logAudit({ action: 'status_change', tableName: 'timesheets', recordId: id, newValues: { status } });
      }
      toast.success(`${ids.length} uren ${status === 'goedgekeurd' ? 'goedgekeurd' : status === 'afgekeurd' ? 'afgekeurd' : 'bijgewerkt'}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleAction = (id: string, status: string) => statusMutation.mutate({ ids: [id], status });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Uren</h1>
          <p className="text-muted-foreground text-sm mt-1">Urenregistratie en goedkeuring</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> CSV importeren
          </Button>
          <Button onClick={() => setEntryOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Uren invoeren
          </Button>
        </div>
      </div>

      {/* Week selector + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => { setWeekRef(subWeeks(weekRef, 1)); setPage(0); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[200px] text-center">{weekLabel}</span>
          <Button variant="ghost" size="icon" onClick={() => { setWeekRef(addWeeks(weekRef, 1)); setPage(0); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={employeeFilter} onValueChange={(v) => { setEmployeeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Medewerker" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle medewerkers</SelectItem>
            {(employees ?? []).map((e: any) => {
              const c = e.candidates as any;
              return <SelectItem key={e.id} value={e.id}>{c?.first_name} {c?.last_name}</SelectItem>;
            })}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} registraties</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Totaal uren', value: stats.totalHours.toFixed(2) },
          { label: 'Overwerk', value: stats.totalOvertime.toFixed(2) },
          { label: 'Goedgekeurd', value: stats.approved },
          { label: 'Aandacht vereist', value: stats.attention },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selected.size} geselecteerd</span>
          <Button size="sm" onClick={() => statusMutation.mutate({ ids: Array.from(selected), status: 'goedgekeurd' })} className="bg-stat-green hover:bg-stat-green/90 text-white">
            Alles goedkeuren
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => statusMutation.mutate({ ids: Array.from(selected), status: 'afgekeurd' })}>
            Alles afkeuren
          </Button>
        </div>
      )}

      {!isLoading && timesheets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Clock className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen uren geregistreerd</p>
          <Button onClick={() => setEntryOpen(true)} variant="outline" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Voer je eerste uren in
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={selected.size === timesheets.length && timesheets.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Medewerker</TableHead>
                  <TableHead>Opdrachtgever</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Uren</TableHead>
                  <TableHead className="text-right">Overwerk</TableHead>
                  <TableHead>Bron</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acties</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timesheets.map((t: any, i: number) => {
                  const emp = t.employees as any;
                  const cand = emp?.candidates as any;
                  const pl = t.placements as any;
                  const companyName = (pl?.companies as any)?.name ?? '—';
                  const name = cand ? `${cand.first_name} ${cand.last_name}` : '—';
                  return (
                    <TableRow key={t.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                      <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} /></TableCell>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>{companyName}</TableCell>
                      <TableCell>{formatDate(t.work_date)}</TableCell>
                      <TableCell className="text-right">{Number(t.hours).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{Number(t.overtime_hours ?? 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={sourceBadge[t.source] ?? ''}>{sourceLabel[t.source] ?? t.source}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`${statusBadge[t.status] ?? ''} gap-1`}>
                          {t.status === 'goedgekeurd' && <CheckCircle2 className="h-3 w-3" />}
                          {t.status === 'afgekeurd' && <XCircle className="h-3 w-3" />}
                          {t.status === 'oranje' && <AlertTriangle className="h-3 w-3" />}
                          {t.status === 'rood' && <XCircle className="h-3 w-3" />}
                          {statusLabel[t.status] ?? t.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {t.status === 'concept' && <Button size="sm" variant="outline" onClick={() => handleAction(t.id, 'ingediend')}>Indienen</Button>}
                          {['ingediend', 'groen', 'oranje'].includes(t.status) && (
                            <>
                              <Button size="sm" variant="outline" className="text-stat-green" onClick={() => handleAction(t.id, 'goedgekeurd')}>Goedkeuren</Button>
                              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleAction(t.id, 'afgekeurd')}>Afkeuren</Button>
                            </>
                          )}
                          {t.status === 'rood' && (
                            <>
                              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleAction(t.id, 'afgekeurd')}>Afkeuren</Button>
                              <Button size="sm" variant="ghost" className="text-stat-green" onClick={() => handleAction(t.id, 'goedgekeurd')}>Goedkeuren</Button>
                            </>
                          )}
                          {t.status === 'afgekeurd' && <Button size="sm" variant="outline" onClick={() => handleAction(t.id, 'concept')}>Heropen</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {timesheets.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-bold">Totaal</TableCell>
                    <TableCell className="text-right font-bold">{stats.totalHours.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold">{stats.totalOvertime.toFixed(2)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => setPage(Math.max(0, page - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => (
                  <PaginationItem key={i}>
                    <PaginationLink isActive={i === page} onClick={() => setPage(i)} className="cursor-pointer">{i + 1}</PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext onClick={() => setPage(Math.min(totalPages - 1, page + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}

      <TimesheetEntrySheet open={entryOpen} onOpenChange={setEntryOpen} />
      <TimesheetCsvImport open={csvOpen} onOpenChange={setCsvOpen} />
    </div>
  );
};

export default Timesheets;
