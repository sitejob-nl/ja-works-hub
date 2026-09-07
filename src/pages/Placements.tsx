import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/ui/sortable-table-head';
import TablePagination from '@/components/ui/table-pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Users, CalendarClock, TrendingUp, Plus, Trash2 } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { payrollerBadgeClass } from '@/lib/payroller';
import { usePayrollers } from '@/hooks/usePayrollers';
import { useTableControls } from '@/hooks/useTableControls';
import type { SortableColumn, SortState } from '@/lib/table-sort';
import { EntityLink } from '@/components/ui/entity-link';
import ErrorState from '@/components/shared/ErrorState';
import PlacementWizard from '@/components/placement/PlacementWizard';
import DeletePlacementDialog, { type DeletePlacementTarget } from '@/components/placements/DeletePlacementDialog';

type PlacementStatus = Database['public']['Enums']['placement_status'];

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

// Deze lijst haalt alle plaatsingen in één keer op en filtert op zoekterm in de browser;
// sorteren gebeurt daarom óók client-side, over de héle gefilterde set en pas daarna de
// pagina eruit. De kandidaat komt uit `candidates` of via de legacy `employees`-koppeling
// (zie getPlacementCandidate) — server-side ordenen op één van die twee joins zou de rijen
// uit de andere tak op de verkeerde plek zetten. 'Periode' sorteert op de startdatum.
const SORT_COLUMNS: readonly SortableColumn[] = [
  {
    key: 'candidate',
    value: (p: any) => {
      const cand = getPlacementCandidate(p);
      return cand ? `${cand.last_name ?? ''} ${cand.first_name ?? ''}`.trim() : '';
    },
  },
  { key: 'company', value: (p: any) => p.companies?.name },
  { key: 'function_name' },
  { key: 'payroller', value: (p: any) => p.payrollers?.name },
  { key: 'start_date', defaultDirection: 'desc' },
  { key: 'rate', value: (p: any) => p.client_hourly_rate || p.hourly_rate, defaultDirection: 'desc' },
  { key: 'status' },
];
// Laatst gestarte plaatsing bovenaan — de volgorde waarmee de lijst altijd al opende,
// nu zichtbaar en omkeerbaar via de kop 'Periode'.
const DEFAULT_SORT: SortState = { column: 'start_date', direction: 'desc' };

export default function PlacementsPage() {
  const navigate = useNavigate();
  const orgId = useOrganizationId();
  const { user, role } = useAuth();
  // Definitief verwijderen is admin-only, gelijk aan de RLS-policy tenant_delete op placements.
  const canDelete = role === 'admin';
  const [search, setSearch] = useState('');
  const [payrollerFilter, setPayrollerFilter] = useState<string>('all');
  const { data: payrollerOptions } = usePayrollers();
  const table = useTableControls({
    columns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    // Deze lijst stond op 25 rijen, een maat die de gedeelde keuzelijst (10/20/50/100) niet
    // kent. Default wordt de dichtstbijzijnde optie; wie meer wil ziet er nu 50 naast staan.
    defaultPageSize: 20,
  });
  const { page, pageSize, resetPage } = table;
  // Statusfilter staat in de URL. Via de tabelbesturing, niet via useSearchParamState: het
  // filter zetten én de paginateller resetten moet één URL-update zijn.
  const [statusFilter, setStatusFilter] = table.filterParam<PlacementStatus | 'all'>('status', 'all');
  const [newPlacementOpen, setNewPlacementOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeletePlacementTarget | null>(null);

  const { data: placements, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['placements-list', orgId, statusFilter, payrollerFilter],
    queryFn: async () => {
      let q = supabase
        .from('placements')
        .select('*, companies!placements_company_id_fkey(id, name), candidates!placements_candidate_id_fkey(id, first_name, last_name), employees!placements_employee_id_fkey(id, candidate_id, candidates!employees_candidate_id_fkey(id, first_name, last_name)), payrollers(id, name, legacy_key)')
        .eq('organization_id', orgId)
        // Vaste basisvolgorde: zonder id-tiebreak mag Postgres plaatsingen met dezelfde
        // startdatum bij elke fetch anders teruggeven, en dan verspringen ze tussen pagina's.
        .order('start_date', { ascending: false })
        .order('id', { ascending: true });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (payrollerFilter !== 'all') q = q.eq('payroller_id', payrollerFilter);
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
  // Eerst de volledige gefilterde set sorteren, dan pas de pagina eruit snijden.
  const sorted = useMemo(() => table.sortRows(filtered), [filtered, table.sortRows]);
  const totalPages = Math.ceil(sorted.length / pageSize);
  const currentPage = totalPages > 0 ? Math.min(page, totalPages - 1) : 0;
  const pageStart = currentPage * pageSize;
  const visiblePlacements = sorted.slice(pageStart, pageStart + pageSize);

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
        <Button onClick={() => setNewPlacementOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nieuwe plaatsing
        </Button>
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
          <Input placeholder="Zoek op naam, functie, bedrijf..." value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PlacementStatus | 'all')}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            <SelectItem value="gepland">Gepland</SelectItem>
            <SelectItem value="actief">Actief</SelectItem>
            <SelectItem value="afgerond">Afgerond</SelectItem>
            <SelectItem value="voortijdig_beeindigd">Voortijdig beëindigd</SelectItem>
          </SelectContent>
        </Select>
        <Select value={payrollerFilter} onValueChange={(v) => { setPayrollerFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle payrollers</SelectItem>
            {(payrollerOptions ?? []).map((pr) => (
              <SelectItem key={pr.id} value={pr.id}>{pr.name}</SelectItem>
            ))}
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
                  <SortableTableHead column="candidate" sort={table.sort} onSort={table.toggleSort}>Kandidaat</SortableTableHead>
                  <SortableTableHead column="company" sort={table.sort} onSort={table.toggleSort}>Opdrachtgever</SortableTableHead>
                  <SortableTableHead column="function_name" sort={table.sort} onSort={table.toggleSort}>Functie</SortableTableHead>
                  <SortableTableHead column="payroller" sort={table.sort} onSort={table.toggleSort}>Payroller</SortableTableHead>
                  <SortableTableHead column="start_date" sort={table.sort} onSort={table.toggleSort}>Periode</SortableTableHead>
                  <SortableTableHead column="rate" sort={table.sort} onSort={table.toggleSort}>Tarief</SortableTableHead>
                  <SortableTableHead column="status" sort={table.sort} onSort={table.toggleSort}>Status</SortableTableHead>
                  {canDelete && <TableHead className="w-10"><span className="sr-only">Acties</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={canDelete ? 8 : 7} className="text-center text-muted-foreground py-8">Geen plaatsingen gevonden</TableCell></TableRow>
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
                      <TableCell>{p.payrollers ? <Badge variant="secondary" className={`text-xs ${payrollerBadgeClass(p.payrollers)}`}>{p.payrollers.name}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(p.start_date)} — {formatDate(p.expected_end_date || p.end_date)}</TableCell>
                      <TableCell className="font-mono text-xs">{formatEUR(p.client_hourly_rate || p.hourly_rate)}</TableCell>
                      <TableCell><Badge variant="secondary" className={st.class}>{st.label}</Badge></TableCell>
                      {canDelete && (
                        <TableCell className="w-10 py-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Plaatsing van ${candidateName} verwijderen`}
                            title="Plaatsing verwijderen"
                            onClick={() => setDeleteTarget({
                              id: p.id,
                              function_name: p.function_name,
                              start_date: p.start_date,
                              end_date: p.end_date,
                              expected_end_date: p.expected_end_date,
                              candidateName: cand ? candidateName : null,
                              companyName: company?.name,
                              row: p,
                            })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!isLoading && sorted.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Toon {pageStart + 1}-{Math.min(pageStart + pageSize, sorted.length)} van {sorted.length} plaatsingen
          </p>
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={table.setPage}
            pageSize={pageSize}
            onPageSizeChange={table.setPageSize}
          />
        </div>
      )}

      <PlacementWizard open={newPlacementOpen} onClose={() => setNewPlacementOpen(false)} />

      {canDelete && (
        <DeletePlacementDialog
          open={!!deleteTarget}
          onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
          placement={deleteTarget}
        />
      )}
    </div>
  );
}
