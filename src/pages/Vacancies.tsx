import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Plus, Search, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { toast } from 'sonner';

const PAGE_SIZE = 10;

const statusBadge: Record<string, string> = {
  open: 'bg-stat-green/10 text-stat-green border-0',
  on_hold: 'bg-yellow-100 text-yellow-700 border-0',
  vervuld: 'bg-blue-100 text-blue-700 border-0',
  gesloten: 'bg-muted text-muted-foreground border-0',
};

const statusLabel: Record<string, string> = {
  open: 'Open', on_hold: 'On hold', vervuld: 'Vervuld', gesloten: 'Gesloten',
};

const urgencyMeta: Record<number, { label: string; className: string }> = {
  1: { label: '1 — Laag', className: 'bg-stat-green/10 text-stat-green border-0' },
  2: { label: '2 — Normaal', className: 'bg-yellow-100 text-yellow-700 border-0' },
  3: { label: '3 — Hoog', className: 'bg-red-100 text-red-600 border-0' },
};

const isOverdue = (startDate: string | null, status: string) =>
  status === 'open' && !!startDate && new Date(startDate) < new Date(new Date().toDateString());

const renderSalary = (v: any): string => {
  if (v.salary_min != null && v.salary_max != null) return `${formatEUR(v.salary_min)} – ${formatEUR(v.salary_max)}`;
  if (v.salary_min != null) return `vanaf ${formatEUR(v.salary_min)}`;
  if (v.salary_max != null) return `tot ${formatEUR(v.salary_max)}`;
  if (v.hourly_rate != null) return formatEUR(v.hourly_rate);
  return '—';
};

const Vacancies = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['vacancies', search, statusFilter, urgencyFilter, page],
    queryFn: async () => {
      let query = supabase.from('vacancies').select(`*, companies!vacancies_company_id_fkey(name)`, { count: 'exact' });
      if (search) query = query.or(`title.ilike.%${search}%,location.ilike.%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);
      if (urgencyFilter !== 'all') query = query.eq('urgency', parseInt(urgencyFilter));
      query = query
        .order('urgency', { ascending: false, nullsFirst: false })
        .order('start_date', { ascending: true, nullsFirst: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { vacancies: data ?? [], total: count ?? 0 };
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, oldStatus }: { id: string; status: string; oldStatus: string }) => {
      const { error } = await supabase.from('vacancies').update({ status: status as any }).eq('id', id);
      if (error) throw error;
      logAudit({ action: 'status_change', tableName: 'vacancies', recordId: id, oldValues: { status: oldStatus }, newValues: { status } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacancies'] });
      toast.success('Status bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const vacancies = data?.vacancies ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vacatures</h1>
          <p className="text-muted-foreground text-sm mt-1">Openstaande en vervulde vacatures</p>
        </div>
        <Button onClick={() => navigate('/vacatures/new')} className="gap-2">
          <Plus className="h-4 w-4" /> Nieuwe vacature
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op titel of locatie..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={urgencyFilter} onValueChange={(v) => { setUrgencyFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Urgentie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle urgentie</SelectItem>
            <SelectItem value="3">3 — Hoog</SelectItem>
            <SelectItem value="2">2 — Normaal</SelectItem>
            <SelectItem value="1">1 — Laag</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} vacatures</span>
      </div>

      {!isLoading && vacancies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen vacatures</p>
          <Button onClick={() => navigate('/vacatures/new')} variant="outline" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Voeg je eerste vacature toe
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titel</TableHead>
                  <TableHead>Opdrachtgever</TableHead>
                  <TableHead>Locatie</TableHead>
                  <TableHead>Aantal</TableHead>
                  <TableHead>Salaris</TableHead>
                  <TableHead>Urgentie</TableHead>
                  <TableHead>Startdatum</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vacancies.map((v: any, i: number) => {
                  const overdue = isOverdue(v.start_date, v.status);
                  const meta = v.urgency ? urgencyMeta[v.urgency] : null;
                  return (
                    <TableRow key={v.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                      <TableCell>
                        <Link to={`/vacatures/${v.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                          {v.title}
                        </Link>
                      </TableCell>
                      <TableCell>{(v.companies as any)?.name ?? '—'}</TableCell>
                      <TableCell>{v.location ?? '—'}</TableCell>
                      <TableCell>{v.filled_count}/{v.required_count}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{renderSalary(v)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={meta?.className ?? 'bg-muted text-muted-foreground border-0'}>
                          {meta?.label ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {v.start_date_text ? (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-0">{v.start_date_text}</Badge>
                        ) : v.start_date ? (
                          <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                            {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                            {formatDate(v.start_date)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={v.status}
                          onValueChange={(newStatus) => updateStatus.mutate({ id: v.id, status: newStatus, oldStatus: v.status })}
                        >
                          <SelectTrigger className={`h-7 px-2 text-xs border-0 w-32 ${statusBadge[v.status] ?? ''}`}>
                            <SelectValue>{statusLabel[v.status] ?? v.status}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(statusLabel).map(([k, label]) => (
                              <SelectItem key={k} value={k}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
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
    </div>
  );
};

export default Vacancies;
