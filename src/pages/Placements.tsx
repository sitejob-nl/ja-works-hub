import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Users, CalendarClock, TrendingUp } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { payrollerLabel } from '@/lib/payroller';

type PlacementStatus = Database['public']['Enums']['placement_status'];
type PayrollerType = Database['public']['Enums']['payroller_type'];

const statusBadge: Record<string, { class: string; label: string }> = {
  gepland: { class: 'bg-blue-100 text-blue-700 border-0', label: 'Gepland' },
  actief: { class: 'bg-stat-green/10 text-stat-green border-0', label: 'Actief' },
  afgerond: { class: 'bg-muted text-muted-foreground border-0', label: 'Afgerond' },
  voortijdig_beeindigd: { class: 'bg-red-100 text-red-600 border-0', label: 'Voortijdig beëindigd' },
};

export default function PlacementsPage() {
  const orgId = useOrganizationId();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PlacementStatus | 'all'>('all');
  const [payrollerFilter, setPayrollerFilter] = useState<PayrollerType | 'all'>('all');

  const { data: placements, isLoading } = useQuery({
    queryKey: ['placements-list', orgId, statusFilter, payrollerFilter],
    queryFn: async () => {
      let q = supabase
        .from('placements')
        .select('*, companies!placements_company_id_fkey(name), candidates!placements_candidate_id_fkey(id, first_name, last_name), employees!placements_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))')
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
    const cand = (p.candidates as any) ?? (p.employees as any)?.candidates;
    const name = `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`.toLowerCase();
    return name.includes(s) || p.function_name?.toLowerCase().includes(s) || (p.companies as any)?.name?.toLowerCase().includes(s);
  });

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
          <Input placeholder="Zoek op naam, functie, bedrijf..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
        <Select value={payrollerFilter} onValueChange={(v) => setPayrollerFilter(v as PayrollerType | 'all')}>
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
          {isLoading ? (
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
                ) : filtered.map((p: any) => {
                  const cand = (p.candidates as any) ?? (p.employees as any)?.candidates;
                  const st = statusBadge[p.status] || statusBadge.gepland;
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => window.location.href = `/plaatsingen/${p.id}`}>
                      <TableCell className="font-medium">{cand?.first_name} {cand?.last_name}</TableCell>
                      <TableCell>{(p.companies as any)?.name ?? '—'}</TableCell>
                      <TableCell>{p.function_name}</TableCell>
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
    </div>
  );
}
