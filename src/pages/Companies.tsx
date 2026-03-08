import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Building2, Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import CompanySlideOver from '@/components/companies/CompanySlideOver';
import ImportWizard from '@/components/import/ImportWizard';

const PAGE_SIZE = 10;

const Companies = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['companies', search, statusFilter, page],
    queryFn: async () => {
      let query = supabase
        .from('companies')
        .select(`
          *,
          company_contacts!company_contacts_company_id_fkey(full_name, is_primary),
          placements!placements_company_id_fkey(id, status)
        `, { count: 'exact' });

      if (search) {
        query = query.or(`name.ilike.%${search}%,address_city.ilike.%${search}%`);
      }
      if (statusFilter === 'actief') query = query.eq('is_active', true);
      if (statusFilter === 'inactief') query = query.eq('is_active', false);

      query = query.order('name').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { companies: data ?? [], total: count ?? 0 };
    },
  });

  const companies = data?.companies ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Opdrachtgevers</h1>
          <p className="text-muted-foreground text-sm mt-1">Beheer je opdrachtgevers en contactpersonen</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> Importeren
          </Button>
          <Button onClick={() => setSlideOverOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nieuwe opdrachtgever
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op naam of stad..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="actief">Actief</SelectItem>
            <SelectItem value="inactief">Inactief</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} opdrachtgevers</span>
      </div>

      {/* Table or empty state */}
      {!isLoading && companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen opdrachtgevers</p>
          <Button onClick={() => setSlideOverOpen(true)} variant="outline" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Voeg je eerste opdrachtgever toe
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bedrijfsnaam</TableHead>
                  <TableHead>Stad</TableHead>
                  <TableHead>Primair contact</TableHead>
                  <TableHead>Telefoon</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actieve plaatsingen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c: any, i: number) => {
                  const primaryContact = c.company_contacts?.find((cc: any) => cc.is_primary);
                  const activePlacements = c.placements?.filter((p: any) => p.status === 'actief').length ?? 0;
                  return (
                    <TableRow key={c.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                      <TableCell>
                        <Link to={`/opdrachtgevers/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell>{c.address_city ?? '—'}</TableCell>
                      <TableCell>{primaryContact?.full_name ?? '—'}</TableCell>
                      <TableCell>{c.phone ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={c.is_active ? 'default' : 'secondary'} className={c.is_active ? 'bg-stat-green/10 text-stat-green border-0' : ''}>
                          {c.is_active ? 'Actief' : 'Inactief'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{activePlacements}</TableCell>
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

      <CompanySlideOver open={slideOverOpen} onOpenChange={setSlideOverOpen} />
      <ImportWizard open={importOpen} onOpenChange={setImportOpen} target="companies" />
    </div>
  );
};

export default Companies;
