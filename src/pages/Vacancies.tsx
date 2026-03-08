import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Briefcase, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import VacancySlideOver from '@/components/vacancies/VacancySlideOver';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 10;

const statusBadge: Record<string, string> = {
  open: 'bg-stat-green/10 text-stat-green border-0',
  on_hold: 'bg-yellow-100 text-yellow-700 border-0',
  vervuld: 'bg-blue-100 text-blue-700 border-0',
  gesloten: 'bg-muted text-muted-foreground border-0',
};

const statusLabel: Record<string, string> = {
  open: 'Open',
  on_hold: 'On hold',
  vervuld: 'Vervuld',
  gesloten: 'Gesloten',
};

const urgencyBadge = (u: number | null) => {
  if (!u) return 'bg-muted text-muted-foreground border-0';
  if (u <= 2) return 'bg-stat-green/10 text-stat-green border-0';
  if (u === 3) return 'bg-yellow-100 text-yellow-700 border-0';
  return 'bg-red-100 text-red-600 border-0';
};

const Vacancies = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['vacancies', search, statusFilter, urgencyFilter, page],
    queryFn: async () => {
      let query = supabase.from('vacancies').select(`
        *,
        companies!vacancies_company_id_fkey(name)
      `, { count: 'exact' });

      if (search) {
        query = query.or(`title.ilike.%${search}%,location.ilike.%${search}%`);
      }
      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);
      if (urgencyFilter !== 'all') query = query.eq('urgency', parseInt(urgencyFilter));

      query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { vacancies: data ?? [], total: count ?? 0 };
    },
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
        <Button onClick={() => setSlideOverOpen(true)} className="gap-2">
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
            <SelectItem value="1">1 — Laag</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3 — Normaal</SelectItem>
            <SelectItem value="4">4</SelectItem>
            <SelectItem value="5">5 — Kritiek</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} vacatures</span>
      </div>

      {!isLoading && vacancies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen vacatures</p>
          <Button onClick={() => setSlideOverOpen(true)} variant="outline" className="mt-4 gap-2">
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
                  <TableHead>Urgentie</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aangemaakt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vacancies.map((v: any, i: number) => (
                  <TableRow key={v.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                    <TableCell>
                      <Link to={`/vacatures/${v.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                        {v.title}
                      </Link>
                    </TableCell>
                    <TableCell>{(v.companies as any)?.name ?? '—'}</TableCell>
                    <TableCell>{v.location ?? '—'}</TableCell>
                    <TableCell>{v.filled_count}/{v.required_count}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={urgencyBadge(v.urgency)}>{v.urgency ?? '—'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusBadge[v.status] ?? ''}>{statusLabel[v.status] ?? v.status}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(v.created_at)}</TableCell>
                  </TableRow>
                ))}
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

      <VacancySlideOver open={slideOverOpen} onOpenChange={setSlideOverOpen} />
    </div>
  );
};

export default Vacancies;
