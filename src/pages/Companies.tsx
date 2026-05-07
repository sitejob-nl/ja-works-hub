import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, Search, Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import ImportWizard from '@/components/import/ImportWizard';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';

const PAGE_SIZE = 10;

const Companies = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);

  const { data: kvkCount } = useQuery({
    queryKey: ['companies-kvk-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .not('kvk_number', 'is', null)
        .neq('kvk_number', '');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: role === 'admin',
  });

  const bulkResync = useMutation({
    mutationFn: async () => {
      const { data: companies, error } = await supabase
        .from('companies')
        .select('id, kvk_number, name, sbi_codes, legal_form, visit_address_street, visit_address_postal, visit_address_city, visit_address_country, address_street, address_postal, address_city, address_country')
        .not('kvk_number', 'is', null)
        .neq('kvk_number', '');
      if (error) throw error;

      const list = companies ?? [];
      const total = list.length;
      const toastId = toast.loading(`Bulk-update gestart: 0/${total}`);

      let updated = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < total; i++) {
        const c = list[i];
        toast.loading(`Bulk-update bezig: ${i + 1}/${total}`, { id: toastId });
        try {
          const { data: kvk, error: kvkErr } = await supabase.functions.invoke('kvk-lookup', {
            body: { kvk_number: c.kvk_number },
          });
          if (kvkErr || !kvk) {
            failed++;
          } else {
            const payload: any = {};
            if (kvk.name && kvk.name !== c.name) payload.name = kvk.name;
            if (kvk.sbi_codes?.length) payload.sbi_codes = kvk.sbi_codes;
            if (kvk.visit_address?.street) {
              payload.visit_address_street = kvk.visit_address.street;
              payload.address_street = kvk.visit_address.street;
            }
            if (kvk.visit_address?.postal) {
              payload.visit_address_postal = kvk.visit_address.postal;
              payload.address_postal = kvk.visit_address.postal;
            }
            if (kvk.visit_address?.city) {
              payload.visit_address_city = kvk.visit_address.city;
              payload.address_city = kvk.visit_address.city;
            }
            if (kvk.visit_address?.country) {
              payload.visit_address_country = kvk.visit_address.country;
              payload.address_country = kvk.visit_address.country;
            }

            if (Object.keys(payload).length === 0) {
              skipped++;
            } else {
              const { error: updErr } = await supabase.from('companies').update(payload).eq('id', c.id);
              if (updErr) {
                failed++;
              } else {
                updated++;
                await logAudit({
                  action: 'update',
                  tableName: 'companies',
                  recordId: c.id,
                  newValues: { source: 'bulk_kvk_resync', kvk_number: c.kvk_number, fields: Object.keys(payload) },
                  reason: 'bulk-kvk-resync',
                });
              }
            }
          }
        } catch {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      toast.dismiss(toastId);
      return { total, updated, failed, skipped };
    },
    onSuccess: (res) => {
      toast.success(`Bulk-update klaar: ${res.updated} bijgewerkt, ${res.skipped} ongewijzigd, ${res.failed} gefaald (van ${res.total})`);
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['companies-kvk-count'] });
    },
    onError: (e: any) => toast.error(`Bulk-update mislukt: ${e?.message ?? 'onbekende fout'}`),
  });

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Opdrachtgevers</h1>
          <p className="text-muted-foreground text-sm mt-1">Beheer je opdrachtgevers en contactpersonen</p>
        </div>
        <div className="flex gap-2">
          {role === 'admin' && (
            <Button variant="outline" onClick={() => setResyncOpen(true)} disabled={bulkResync.isPending} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${bulkResync.isPending ? 'animate-spin' : ''}`} /> Bulk KVK-resync
            </Button>
          )}
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> Importeren
          </Button>
          <Button onClick={() => navigate('/opdrachtgevers/new')} className="gap-2">
            <Plus className="h-4 w-4" /> Nieuwe opdrachtgever
          </Button>
        </div>
      </div>

      <AlertDialog open={resyncOpen} onOpenChange={setResyncOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle opdrachtgevers bijwerken via KVK</AlertDialogTitle>
            <AlertDialogDescription>
              Dit ververst de KVK-gegevens (naam, adres, SBI-codes) voor alle opdrachtgevers met een KVK-nummer.
              Verwacht ~{kvkCount ?? 0} updates, duur ~{Math.ceil((kvkCount ?? 0) * 0.6)}s.
              Wijzigingen worden gelogd in de audit-trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleer</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkResync.mutate()} disabled={!kvkCount || bulkResync.isPending}>
              Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam of stad..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="actief">Actief</SelectItem>
            <SelectItem value="inactief">Inactief</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} opdrachtgevers</span>
      </div>

      {!isLoading && companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen opdrachtgevers</p>
          <Button onClick={() => navigate('/opdrachtgevers/new')} variant="outline" className="mt-4 gap-2">
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

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} target="companies" />
    </div>
  );
};

export default Companies;
