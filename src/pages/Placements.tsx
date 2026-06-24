import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Users, CalendarClock, TrendingUp } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { payrollerLabel } from '@/lib/payroller';
import { getPaginationRange } from '@/lib/pagination';
import { EntityLink } from '@/components/ui/entity-link';
import ErrorState from '@/components/shared/ErrorState';

type PlacementStatus = Database['public']['Enums']['placement_status'];
type PayrollerType = Database['public']['Enums']['payroller_type'];

const PAGE_SIZE = 25;

const statusBadge: Record<string, { class: string; label: string }> = {
  gepland: { class: 'bg-blue-100 text-blue-700 border-0', label: 'Gepland' },
  actief: { class: 'bg-stat-green/10 text-stat-green border-0', label: 'Actief' },
  afgerond: { class: 'bg-muted text-muted-foreground border-0', label: 'Afgerond' },
  voortijdig_beeindigd: { class: 'bg-red-100 text-red-600 border-0', label: 'Voortijdig beëindigd' },
};

const asSingle = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const getPlacementCandidate = (placement: any) =>
  asSingle(placement.candidates) ?? asSingle(asSingle(placement.employees)?.candidates);

export default function PlacementsPage() {
  const navigate = useNavigate();
  const orgId = useOrganizationId();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useSearchParamState<PlacementStatus | 'all'>('status', 'all');
  const [payrollerFilter, setPayrollerFilter] = useState<PayrollerType | 'all'>('all');
  const [page, setPage] = useState(0);

  const { data: placements, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['placements-list', orgId, statusFilter, payrollerFilter],
    queryFn: async () => {
      let q = supabase
        .from('placements')
        .select('*, companies!placements_company_id_fkey(id, name), candidates!placements_candidate_id_fkey(id, first_name, last_name), employees!placements_employee_id_fkey(id, candidate_id, candidates!employees_candidate_id_fkey(id, first_name, last_name))')
        .eq('organization_id', orgId)
        .order('start_date', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (payrollerFilter !== 'all') q = q.eq('payroller', payrollerFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const filtered = (placements ?? []).filter((p: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const cand = getPlacementCandidate(p);
    const name = `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`.toLowerCase();
    return name.includes(s) || p.function_name?.toLowerCase().includes(s) || (p.companies as any)?.name?.toLowerCase().includes(s);
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = totalPages > 0 ? Math.min(page, totalPages - 1) : 0;
  const pageStart = currentPage * PAGE_SIZE;
  const visiblePlacements = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const active = (placements ?? []).filter((p: any) => p.status === 'actief').length;
  const endingThisMonth = (placements ?? []).filter((p: any) => {
    if (p.status !== 'actief') return false;
    const ed = p.expected_end_date || p.end_date;
    if (!ed) return false;
    const d = new Date(ed);
    return d <= endOfMonth && d >= now;
  }).length;

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Plaatsingen</h1>
          <p className="text-sm text-muted-foreground">Overzicht van alle plaatsingen</p>
        </div>
      </div>

      {/* KPI's */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Actieve plaatsingen</p></div>
          <p className="text-2xl font-semibold mt-1">{active}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-orange-500" /><p className="text-xs text-muted-foreground">Eindigend deze maand</p></div>
          <p className="text-2xl font-semibold mt-1 text-orange-600">{endingThisMonth}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">Totaal</p></div>
          <p className="text-2xl font-semibold mt-1">{(placements ?? []).length}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam, functie, bedrijf..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as PlacementStatus | 'all'); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            <SelectItem value="gepland">Gepland</SelectItem>
            <SelectItem value="actief">Actief</SelectItem>
            <SelectItem value="afgerond">Afgerond</SelectItem>
            <SelectItem value="voortijdig_beeindigd">Voortijdig beëindigd</SelectItem>
          </SelectContent>
        </Select>
        <Select value={payrollerFilter} onValueChange={(v) => { setPayrollerFilter(v as PayrollerType | 'all'); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle payrollers</SelectItem>
            <SelectItem value="flexpedia">Flexpedia</SelectItem>
            <SelectItem value="brioworks">BrioWorks</SelectItem>
            <SelectItem value="bromida">Bromida</SelectItem>
            <SelectItem value="retiva">Retiva/A1</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="p-6 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kandidaat</TableHead>
                  <TableHead>Opdrachtgever</TableHead>
                  <TableHead>Functie</TableHead>
                  <TableHead>Payroller</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead>Tarief</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Geen plaatsingen gevonden</TableCell></TableRow>
                ) : visiblePlacements.map((p: any) => {
                  const cand = getPlacementCandidate(p);
                  const st = statusBadge[p.status] || statusBadge.gepland;
                  const candidateName = cand
                    ? `${cand.first_name ?? ''} ${cand.last_name ?? ''}`.trim() || 'Onbekende kandidaat'
                    : '—';
                  const company = (p.companies as any);
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/plaatsingen/${p.id}`)}>
                      <TableCell className="font-medium">
                        <EntityLink type="candidate" id={cand?.id}>{candidateName}</EntityLink>
                      </TableCell>
                      <TableCell>
                        <EntityLink type="company" id={company?.id}>{company?.name ?? '—'}</EntityLink>
                      </TableCell>
                      <TableCell>
                        <EntityLink type="vacancy" id={p.vacancy_id ?? null}>
                          {p.function_name || 'Plaatsing'}
                        </EntityLink>
                      </TableCell>
                      <TableCell>{p.payroller ? <Badge variant="outline" className="text-xs">{payrollerLabel[p.payroller] ?? p.payroller}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(p.start_date)} — {formatDate(p.expected_end_date || p.end_date)}</TableCell>
                      <TableCell className="font-mono text-xs">{formatEUR(p.client_hourly_rate || p.hourly_rate)}</TableCell>
                      <TableCell><Badge variant="secondary" className={st.class}>{st.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Toon {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filtered.length)} van {filtered.length} plaatsingen
          </p>
          {totalPages > 1 && (
            <Pagination className="sm:justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage(Math.max(0, currentPage - 1))}
                    className={currentPage === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                {getPaginationRange(currentPage, totalPages).map((item, i) => (
                  <PaginationItem key={`${item}-${i}`}>
                    {typeof item === 'number' ? (
                      <PaginationLink
                        isActive={item === currentPage}
                        onClick={() => setPage(item)}
                        className="cursor-pointer"
                      >
                        {item + 1}
                      </PaginationLink>
                    ) : (
                      <PaginationEllipsis />
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
                    className={currentPage >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
