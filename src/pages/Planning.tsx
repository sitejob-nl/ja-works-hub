import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, format, getISOWeek, isWithinInterval, parseISO } from 'date-fns';
import { nl } from 'date-fns/locale';
import { Calendar, Plus, ChevronLeft, ChevronRight, Users, Briefcase, DollarSign, LayoutList, LayoutGrid, Search, Home, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { useNavigate } from 'react-router-dom';
import NewPlacementSheet from '@/components/placement/NewPlacementSheet';

const PAGE_SIZE = 20;

const statusBadge: Record<string, string> = {
  gepland: 'bg-blue-100 text-blue-700 border-0',
  actief: 'bg-emerald-100 text-emerald-700 border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  beeindigd: 'bg-red-100 text-red-600 border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  gepland: 'Gepland', actief: 'Actief', afgerond: 'Afgerond', beeindigd: 'Beëindigd',
  voortijdig_beeindigd: 'Voortijdig beëindigd',
};

const Planning = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [weekRef, setWeekRef] = useState(new Date());
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  const ws = startOfWeek(weekRef, { weekStartsOn: 1 });
  const we = endOfWeek(weekRef, { weekStartsOn: 1 });
  const weekStart = format(ws, 'yyyy-MM-dd');
  const weekEnd = format(we, 'yyyy-MM-dd');
  const weekNum = getISOWeek(weekRef);
  const weekLabel = `Week ${weekNum} (${format(ws, 'dd-MM', { locale: nl })} t/m ${format(we, 'dd-MM', { locale: nl })})`;

  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));

  // Placements for the week
  const { data: placements, isLoading } = useQuery({
    queryKey: ['planning-placements', weekStart, weekEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select(`
          *,
          employees!placements_employee_id_fkey(
            id,
            status,
            candidate_id,
            candidates!employees_candidate_id_fkey(id, first_name, last_name)
          ),
          candidates!placements_candidate_id_fkey(id, first_name, last_name),
          companies!placements_company_id_fkey(id, name)
        `)
        .in('status', ['actief', 'gepland'] as any[])
        .or(`and(start_date.lte.${weekEnd},end_date.gte.${weekStart}),and(start_date.lte.${weekEnd},end_date.is.null)`);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Companies for filter
  const { data: companies } = useQuery({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Active employees count (for "niet ingepland" stat)
  const { data: activeEmployees } = useQuery({
    queryKey: ['active-employees-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'actief' as any);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Contracturen per medewerker (huidige dienstverband) — voor de over-/onderbezetting-check.
  // Maar weinig medewerkers hebben dit ingevuld; waar het ontbreekt valt de check terug op 40u.
  const { data: contractHoursByCand } = useQuery({
    queryKey: ['employment-contract-hours', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_employment')
        .select('candidate_id, contract_hours')
        .eq('is_current', true)
        .not('contract_hours', 'is', null);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) if (r.candidate_id) map[r.candidate_id] = Number(r.contract_hours);
      return map;
    },
  });

  // Open vacancies count
  const { data: openVacancies } = useQuery({
    queryKey: ['open-vacancies-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('vacancies').select('id', { count: 'exact', head: true }).eq('status', 'open' as any);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Filter placements
  const filtered = useMemo(() => {
    if (!placements) return [];
    let result = placements;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((p: any) => {
        const emp = p.candidates ?? p.employees?.candidates;
        const empName = `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.toLowerCase();
        const compName = (p.companies?.name ?? '').toLowerCase();
        return empName.includes(s) || compName.includes(s);
      });
    }
    if (statusFilter !== 'all') result = result.filter((p: any) => p.status === statusFilter);
    if (companyFilter !== 'all') result = result.filter((p: any) => p.company_id === companyFilter);
    return result;
  }, [placements, search, statusFilter, companyFilter]);

  // Stats
  const stats = useMemo(() => {
    if (!placements) return { scheduled: 0, unscheduled: 0, openVac: 0, avgRate: 0 };
    const uniqueEmployees = new Set(placements.map((p: any) => p.candidate_id ?? p.employee_id));
    const avgRate = placements.length > 0
      ? placements.reduce((sum: number, p: any) => sum + (p.hourly_rate ?? 0), 0) / placements.length
      : 0;
    return {
      scheduled: uniqueEmployees.size,
      unscheduled: Math.max(0, (activeEmployees ?? 0) - uniqueEmployees.size),
      openVac: openVacancies ?? 0,
      avgRate,
    };
  }, [placements, activeEmployees, openVacancies]);

  // Group by employee for calendar view + bereken geplande uren (som van cao_hours over de
  // plaatsingen die deze week dekken) vs contracturen-baseline (of 40u als die ontbreekt).
  const employeeRows = useMemo(() => {
    const map = new Map<string, { employee: any; placements: any[] }>();
    for (const p of filtered) {
      const empId = p.candidate_id ?? p.employee_id ?? p.id;
      if (!map.has(empId)) {
        map.set(empId, {
          employee: (p as any).employees ?? { id: p.candidate_id, candidates: (p as any).candidates },
          placements: [],
        });
      }
      map.get(empId)!.placements.push(p);
    }
    return Array.from(map.values())
      .map(({ employee, placements: empPlacements }) => {
        const candId = empPlacements[0]?.candidate_id ?? employee?.id ?? null;
        const plannedHours = empPlacements.reduce((sum: number, p: any) => sum + (Number(p.cao_hours) || 0), 0);
        const contractHours = candId ? (contractHoursByCand?.[candId] ?? null) : null;
        const baseline = contractHours ?? 40;
        const over = plannedHours > 0 && plannedHours > baseline + 0.01;
        return { employee, placements: empPlacements, candId, plannedHours, contractHours, over };
      })
      .sort((a, b) => {
        const an = `${a.employee?.candidates?.first_name} ${a.employee?.candidates?.last_name}`;
        const bn = `${b.employee?.candidates?.first_name} ${b.employee?.candidates?.last_name}`;
        return an.localeCompare(bn);
      });
  }, [filtered, contractHoursByCand]);

  const overbookedCount = employeeRows.filter((r) => r.over).length;

  // Check if placement covers a day
  const coversDay = (p: any, day: Date) => {
    const start = parseISO(p.start_date);
    const end = p.end_date ? parseISO(p.end_date) : new Date(2099, 0, 1);
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return d >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) &&
           d <= new Date(end.getFullYear(), end.getMonth(), end.getDate());
  };

  const totalListPages = Math.ceil(filtered.length / PAGE_SIZE);
  const listData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Planning</h1>
          <p className="text-muted-foreground text-sm">Plan en beheer de inzet van medewerkers</p>
        </div>
        <Button onClick={() => setSheetOpen(true)}><Plus className="h-4 w-4 mr-2" />Nieuwe plaatsing</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Ingepland deze week', value: stats.scheduled, icon: Users, color: 'text-stat-blue' },
          { label: 'Niet ingepland', value: stats.unscheduled, icon: Users, color: 'text-orange-500' },
          { label: 'Openstaande vacatures', value: stats.openVac, icon: Briefcase, color: 'text-blue-500' },
          { label: 'Gem. uurtarief', value: formatEUR(stats.avgRate), icon: DollarSign, color: 'text-emerald-500' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted ${s.color}`}><s.icon className="h-5 w-5" /></div>
              <div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Week nav + filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => { setWeekRef(subWeeks(weekRef, 1)); setPage(0); }}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm font-medium min-w-[200px] text-center">{weekLabel}</span>
            <Button variant="outline" size="icon" onClick={() => { setWeekRef(addWeeks(weekRef, 1)); setPage(0); }}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setWeekRef(new Date()); setPage(0); }}>Vandaag</Button>
          <div className="flex gap-1 ml-auto">
            <Button variant={view === 'calendar' ? 'default' : 'outline'} size="sm" onClick={() => setView('calendar')}><LayoutGrid className="h-4 w-4 mr-1" />Kalender</Button>
            <Button variant={view === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setView('list')}><LayoutList className="h-4 w-4 mr-1" />Lijst</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Zoek medewerker of bedrijf..." className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statussen</SelectItem>
              <SelectItem value="gepland">Gepland</SelectItem>
              <SelectItem value="actief">Actief</SelectItem>
              <SelectItem value="afgerond">Afgerond</SelectItem>
            </SelectContent>
          </Select>
          <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Opdrachtgever" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle opdrachtgevers</SelectItem>
              {companies?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Overbezetting-waarschuwing voor de week */}
      {overbookedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {overbookedCount} medewerker{overbookedCount === 1 ? '' : 's'} overbezet deze week — geplande uren liggen boven de contracturen (of 40u waar contracturen ontbreken).
          </span>
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {employeeRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground font-medium">Geen plaatsingen deze week</p>
                <Button variant="outline" className="mt-3" onClick={() => setSheetOpen(true)}>Plan een medewerker in</Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px] sticky left-0 bg-card z-10">Medewerker</TableHead>
                    {days.map((d) => (
                      <TableHead key={d.toISOString()} className="text-center min-w-[120px]">
                        {format(d, 'EEE dd/MM', { locale: nl })}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeRows.map(({ employee, placements: empPlacements, plannedHours, contractHours, over }) => {
                    const cand = employee?.candidates;
                    const empName = `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`;
                    const hoursLabel = contractHours != null ? `${plannedHours}/${contractHours} u` : `${plannedHours} u gepland`;
                    return (
                      <TableRow key={employee?.id}>
                        <TableCell className="font-medium sticky left-0 bg-card z-10">
                          <button className="text-left hover:text-stat-blue transition-colors block" onClick={() => navigate(`/kandidaten/${empPlacements[0]?.candidate_id ?? employee?.id}`)}>
                            {empName}
                          </button>
                          {plannedHours > 0 && (
                            <Badge
                              variant="secondary"
                              className={`mt-1 text-[10px] border-0 gap-0.5 ${over ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground'}`}
                              title={contractHours != null
                                ? `Geplande uren deze week (${plannedHours}u) versus contracturen (${contractHours}u)`
                                : `Geplande uren deze week (${plannedHours}u) — geen contracturen ingevuld, drempel 40u`}
                            >
                              {over && <AlertTriangle className="h-2.5 w-2.5" />}
                              {hoursLabel}
                            </Badge>
                          )}
                        </TableCell>
                        {days.map((day) => {
                          const active = empPlacements.find((p: any) => coversDay(p, day));
                          return (
                            <TableCell key={day.toISOString()} className="p-1">
                              {active ? (
                                <PlacementCell placement={active} navigate={navigate} />
                              ) : (
                                <div className="h-10 rounded bg-muted/50" />
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* List view */}
      {view === 'list' && (
        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground font-medium">Geen plaatsingen deze week</p>
                <Button variant="outline" className="mt-3" onClick={() => setSheetOpen(true)}>Plan een medewerker in</Button>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medewerker</TableHead>
                      <TableHead>Opdrachtgever</TableHead>
                      <TableHead>Functie</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>Eind</TableHead>
                      <TableHead>Uurtarief</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listData.map((p: any) => {
                      const cand = p.candidates ?? p.employees?.candidates;
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <button className="font-medium hover:text-stat-blue transition-colors" onClick={() => navigate(`/kandidaten/${p.candidate_id}`)}>
                              {cand?.first_name} {cand?.last_name}
                            </button>
                          </TableCell>
                          <TableCell>
                            <button className="hover:text-stat-blue transition-colors" onClick={() => navigate(`/opdrachtgevers/${p.company_id}`)}>
                              {p.companies?.name}
                            </button>
                          </TableCell>
                          <TableCell>{p.function_name}</TableCell>
                          <TableCell>{formatDate(p.start_date)}</TableCell>
                          <TableCell>{p.end_date ? formatDate(p.end_date) : 'Lopend'}</TableCell>
                          <TableCell>{formatEUR(p.hourly_rate)}</TableCell>
                          <TableCell><Badge className={statusBadge[p.status] ?? ''}>{statusLabel[p.status] ?? p.status}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {totalListPages > 1 && (
                  <div className="p-4 flex justify-center">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem><PaginationPrevious onClick={() => setPage(Math.max(0, page - 1))} /></PaginationItem>
                        {Array.from({ length: Math.min(totalListPages, 5) }, (_, i) => (
                          <PaginationItem key={i}><PaginationLink isActive={page === i} onClick={() => setPage(i)}>{i + 1}</PaginationLink></PaginationItem>
                        ))}
                        <PaginationItem><PaginationNext onClick={() => setPage(Math.min(totalListPages - 1, page + 1))} /></PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <NewPlacementSheet open={sheetOpen} onClose={() => setSheetOpen(false)} orgId={orgId} userId={user?.id} />
    </div>
  );
};

/* Placement cell with popover */
const PlacementCell = ({ placement, navigate }: { placement: any; navigate: any }) => {
  const comp = placement.companies;
  const cand = placement.candidates ?? placement.employees?.candidates;
  const candidateId = placement.candidate_id ?? placement.employees?.candidate_id ?? cand?.id;
  const companyId = placement.company_id ?? comp?.id;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="w-full h-10 rounded text-xs font-medium px-2 text-left truncate border-l-[3px] border-primary bg-primary/10 hover:bg-primary/20 transition-colors flex items-center gap-1">
          <span className="truncate">{comp?.name}</span>
          {!placement.housing_assignment_id && (
            <Home className="h-3 w-3 text-orange-500 shrink-0" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-sm">
        <div className="font-semibold">{cand?.first_name} {cand?.last_name}</div>
        <div className="space-y-1 text-muted-foreground">
          <div><span className="font-medium text-foreground">Bedrijf:</span> {comp?.name}</div>
          <div><span className="font-medium text-foreground">Functie:</span> {placement.function_name}</div>
          <div><span className="font-medium text-foreground">Periode:</span> {formatDate(placement.start_date)} — {placement.end_date ? formatDate(placement.end_date) : 'Lopend'}</div>
          <div><span className="font-medium text-foreground">Uurtarief:</span> {formatEUR(placement.hourly_rate)}</div>
          <div><span className="font-medium text-foreground">Status:</span> <Badge className={`ml-1 ${statusBadge[placement.status] ?? ''}`}>{statusLabel[placement.status] ?? placement.status}</Badge></div>
          <div>
            <span className="font-medium text-foreground">Huisvesting:</span>{' '}
            {placement.housing_assignment_id ? (
              <Badge variant="secondary" className="ml-1 text-[10px] bg-stat-green/10 text-stat-green border-0">Toegewezen</Badge>
            ) : (
              <Badge variant="secondary" className="ml-1 text-[10px] bg-orange-100 text-orange-600 border-0 gap-0.5"><Home className="h-2.5 w-2.5" />Niet toegewezen</Badge>
            )}
          </div>
          <div><span className="font-medium text-foreground">Compliance:</span> <Badge variant={placement.compliance_check_passed ? 'default' : 'destructive'} className="ml-1">{placement.compliance_check_passed ? 'OK' : 'Niet voldaan'}</Badge></div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {candidateId && <Button size="sm" variant="outline" onClick={() => navigate(`/kandidaten/${candidateId}`)}>Medewerker</Button>}
          {companyId && <Button size="sm" variant="outline" onClick={() => navigate(`/opdrachtgevers/${companyId}`)}>Opdrachtgever</Button>}
          <Button size="sm" variant="outline" onClick={() => navigate(`/plaatsingen/${placement.id}`)}>Plaatsing</Button>
          {placement.vacancy_id && <Button size="sm" variant="outline" onClick={() => navigate(`/vacatures/${placement.vacancy_id}`)}>Vacature</Button>}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default Planning;
