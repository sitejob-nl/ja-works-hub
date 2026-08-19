import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { UserCheck, UserPlus, Search, Check, X, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 10;

const statusBadge: Record<string, string> = {
  onboarding: 'bg-yellow-100 text-yellow-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  ziek: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};

const statusLabel: Record<string, string> = {
  onboarding: 'Onboarding', actief: 'Actief', ziek: 'Ziek', uit_dienst: 'Uit dienst',
};

const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const Employees = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useSearchParamState<string>('status', 'all');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', search, statusFilter, page],
    queryFn: async () => {
      let query = supabase.from('candidates').select(`
        *,
        candidate_employment(*),
        housing_assignments!housing_assignments_candidate_id_fkey(id, status),
        placements!placements_candidate_id_fkey(id, status, company_id, companies!placements_company_id_fkey(name))
      `, { count: 'exact' });

      if (statusFilter === 'all') {
        query = query.in('employee_status', ['onboarding', 'actief', 'ziek'] as any);
      } else {
        query = query.eq('employee_status', statusFilter as any);
      }
      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
      }
      query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;

      return { employees: data ?? [], total: count ?? 0 };
    },
  });

  const employees = data?.employees ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Medewerkers</h1>
          <p className="text-muted-foreground text-sm mt-1">Beheer actieve medewerkers</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Punt 15 — het samenvoegscherm bestond al, maar was alleen bereikbaar vanaf
              de kandidatenlijst. Medewerkers en kandidaten zijn dezelfde tabel. */}
          <Button variant="outline" onClick={() => navigate('/kandidaten/duplicaten')} className="gap-2 hidden md:flex">
            <Copy className="h-4 w-4" /> Duplicaten
          </Button>
          <Button onClick={() => navigate('/medewerkers/new')} className="gap-2 bg-primary text-primary-foreground">
            <UserPlus className="h-4 w-4" /> Kandidaat in dienst nemen
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} medewerkers</span>
      </div>

      {!isLoading && employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <UserCheck className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen medewerkers</p>
          <Button onClick={() => navigate('/medewerkers/new')} variant="outline" className="mt-4 gap-2">
            <UserPlus className="h-4 w-4" /> Neem een kandidaat in dienst
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Naam</TableHead>
                  <TableHead>Medewerkernr.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Compliance</TableHead>
                  <TableHead>Startdatum</TableHead>
                  <TableHead>Huisvesting</TableHead>
                   <TableHead>Portaal</TableHead>
                   <TableHead>Actieve plaatsing</TableHead>
                 </TableRow>
               </TableHeader>
              <TableBody>
                {employees.map((c: any, i: number) => {
                  const hasHousing = (c.housing_assignments ?? []).some((h: any) => h.status === 'ingecheckt');
                  const activePlacement = (c.placements ?? []).find((p: any) => p.status === 'actief');
                  const companyName = activePlacement?.companies?.name;
                  const sortedEmployments = (c.candidate_employment ?? [])
                    .sort((a: any, b: any) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
                  const currentEmployment = sortedEmployments.find((e: any) => e.is_current) ?? sortedEmployments[0];
                  return (
                    <TableRow key={c.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                      <TableCell>
                        <Link to={`/kandidaten/${c.id}`} className="font-medium text-foreground hover:text-stat-blue transition-colors">
                          {c.first_name} {c.last_name}
                        </Link>
                      </TableCell>
                      <TableCell>{c.employee_number ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusBadge[c.employee_status] ?? ''}>{statusLabel[c.employee_status] ?? c.employee_status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={complianceBadge[c.compliance_status] ?? ''}>{c.compliance_status ?? '—'}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(currentEmployment?.start_date)}</TableCell>
                      <TableCell>
                        {hasHousing
                          ? <Check className="h-4 w-4 text-stat-green" />
                          : <X className="h-4 w-4 text-red-500" />}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.portal_enabled ? 'bg-stat-green' : 'bg-muted-foreground/30'}`} />
                      </TableCell>
                      <TableCell>{companyName ?? '—'}</TableCell>
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

export default Employees;
