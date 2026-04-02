import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { FolderHeart, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const POOL_COLORS = [
  { label: 'Blauw', value: '#3b82f6' },
  { label: 'Groen', value: '#22c55e' },
  { label: 'Oranje', value: '#f97316' },
  { label: 'Paars', value: '#a855f7' },
  { label: 'Rood', value: '#ef4444' },
  { label: 'Geel', value: '#eab308' },
  { label: 'Roze', value: '#ec4899' },
  { label: 'Teal', value: '#14b8a6' },
];

const Talentpools = () => {
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#3b82f6' });

  const { data, isLoading } = useQuery({
    queryKey: ['talentpools', orgId, search, page],
    queryFn: async () => {
      let query = supabase
        .from('talentpools' as any)
        .select('*, talentpool_members(count)', { count: 'exact' })
        .eq('organization_id', orgId);

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { pools: data ?? [], total: count ?? 0 };
    },
  });

  const pools = data?.pools ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('talentpools' as any)
        .insert({
          organization_id: orgId,
          name: form.name,
          description: form.description || null,
          color: form.color || null,
          created_by: profile?.id || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      setCreateOpen(false);
      setForm({ name: '', description: '', color: '#3b82f6' });
      toast.success('Talentpool aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Talentpools</h1>
          <p className="text-muted-foreground text-sm mt-1 hidden sm:block">Groepeer kandidaten in herbruikbare lijsten</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nieuwe talentpool
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op naam..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{total} talentpools</span>
      </div>

      {!isLoading && pools.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderHeart className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen talentpools</p>
          <p className="text-sm text-muted-foreground mt-1">Maak een pool aan om kandidaten te groeperen.</p>
          <Button onClick={() => setCreateOpen(true)} variant="outline" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Eerste talentpool aanmaken
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Naam</TableHead>
                  <TableHead>Beschrijving</TableHead>
                  <TableHead>Leden</TableHead>
                  <TableHead>Aangemaakt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pools.map((p: any, i: number) => {
                  const memberCount = p.talentpool_members?.[0]?.count ?? 0;
                  return (
                    <TableRow
                      key={p.id}
                      className={`cursor-pointer ${i % 2 === 1 ? 'bg-background' : ''}`}
                      onClick={() => navigate(`/talentpools/${p.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {p.color && (
                            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                          )}
                          <Link
                            to={`/talentpools/${p.id}`}
                            className="font-medium text-foreground hover:text-primary transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">{p.description ?? '—'}</TableCell>
                      <TableCell>{memberCount}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(p.created_at).toLocaleDateString('nl-NL')}
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

      {/* Create Sheet */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Nieuwe talentpool</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Naam *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="bijv. Lassers regio Utrecht" />
            </div>
            <div className="space-y-1.5">
              <Label>Beschrijving</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Kleur</Label>
              <div className="flex gap-2 flex-wrap">
                {POOL_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${form.color === c.value ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name.trim() || createMutation.isPending} className="w-full mt-4">
              Aanmaken
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Talentpools;
