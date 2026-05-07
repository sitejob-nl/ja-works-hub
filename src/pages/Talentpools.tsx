import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { FolderHeart, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
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
  const [genFnOpen, setGenFnOpen] = useState(false);
  const [genForm, setGenForm] = useState({ company_id: '', function_id: '' });
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    is_dynamic: false,
    refresh_frequency: 'manual' as 'manual' | 'daily' | 'weekly',
  });

  const { data: genCompanies = [] } = useQuery({
    queryKey: ['gen-companies', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: genFnOpen,
  });

  const { data: genFunctions = [] } = useQuery({
    queryKey: ['gen-functions', genForm.company_id],
    queryFn: async () => {
      if (!genForm.company_id) return [];
      const { data, error } = await supabase
        .from('company_functions')
        .select('id, name, required_skills')
        .eq('company_id', genForm.company_id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: genFnOpen && !!genForm.company_id,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const fn = genFunctions.find((f: any) => f.id === genForm.function_id) as any;
      const company = genCompanies.find((c: any) => c.id === genForm.company_id) as any;
      if (!fn || !company) throw new Error('Selecteer opdrachtgever en functie');
      const skills: string[] = Array.isArray(fn.required_skills) ? fn.required_skills : [];
      if (skills.length === 0) throw new Error('Functie heeft geen standaard-vaardigheden — voeg eerst skills toe op de functie');

      const { data, error } = await supabase
        .from('talentpools' as any)
        .insert({
          organization_id: orgId,
          name: `${fn.name} — ${company.name}`,
          description: `Auto-gegenereerd uit functie "${fn.name}" van ${company.name}. Vult zichzelf op basis van vaardigheden.`,
          color: '#a855f7',
          created_by: profile?.id || null,
          is_dynamic: true,
          refresh_frequency: 'manual',
          filter_criteria: { skills },
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      setGenFnOpen(false);
      setGenForm({ company_id: '', function_id: '' });
      toast.success('Pool gegenereerd uit functie — open en klik "Ververs nu" om te vullen');
      if (data?.id) navigate(`/talentpools/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

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
      const { data, error } = await supabase
        .from('talentpools' as any)
        .insert({
          organization_id: orgId,
          name: form.name,
          description: form.description || null,
          color: form.color || null,
          created_by: profile?.id || null,
          is_dynamic: form.is_dynamic,
          refresh_frequency: form.is_dynamic ? form.refresh_frequency : 'manual',
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['talentpools'] });
      setCreateOpen(false);
      setForm({ name: '', description: '', color: '#3b82f6', is_dynamic: false, refresh_frequency: 'manual' });
      toast.success(form.is_dynamic ? 'Dynamische pool aangemaakt — stel filters in om te vullen' : 'Talentpool aangemaakt');
      if (form.is_dynamic && data?.id) navigate(`/talentpools/${data.id}`);
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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setGenFnOpen(true)} className="gap-1.5">
            <Wand2 className="h-4 w-4" /> Genereer uit functie
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nieuwe talentpool
          </Button>
        </div>
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
                  <TableHead>Type</TableHead>
                  <TableHead>Beschrijving</TableHead>
                  <TableHead>Leden</TableHead>
                  <TableHead>Laatst ververst</TableHead>
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
                      <TableCell>
                        {p.is_dynamic ? (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-0 gap-1">
                            <Sparkles className="h-3 w-3" /> Dynamisch
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Statisch</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">{p.description ?? '—'}</TableCell>
                      <TableCell>{memberCount}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {p.last_refreshed_at
                          ? new Date(p.last_refreshed_at).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
                          : p.is_dynamic ? 'Nog niet ververst' : `Aangemaakt ${new Date(p.created_at).toLocaleDateString('nl-NL')}`}
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

      {/* Genereer uit functie Sheet */}
      <Sheet open={genFnOpen} onOpenChange={setGenFnOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Genereer pool uit functie</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <p className="text-sm text-muted-foreground">
              Maakt een dynamische pool die zich vult op basis van de vaardigheden die op de functie staan.
              Pas vaardigheden aan op de functie en de pool past zich automatisch aan bij de volgende refresh.
            </p>
            <div className="space-y-1.5">
              <Label>Opdrachtgever *</Label>
              <Select value={genForm.company_id} onValueChange={(v) => setGenForm({ company_id: v, function_id: '' })}>
                <SelectTrigger><SelectValue placeholder="Selecteer opdrachtgever" /></SelectTrigger>
                <SelectContent>
                  {genCompanies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {genForm.company_id && (
              <div className="space-y-1.5">
                <Label>Functie *</Label>
                <Select value={genForm.function_id} onValueChange={(v) => setGenForm((g) => ({ ...g, function_id: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={genFunctions.length ? 'Selecteer functie' : 'Geen functies — voeg eerst toe op opdrachtgever'} />
                  </SelectTrigger>
                  <SelectContent>
                    {genFunctions.map((fn: any) => {
                      const skills: string[] = Array.isArray(fn.required_skills) ? fn.required_skills : [];
                      return (
                        <SelectItem key={fn.id} value={fn.id}>
                          {fn.name} {skills.length > 0 ? `(${skills.length} skills)` : '(geen skills)'}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {genForm.function_id && (() => {
                  const fn = genFunctions.find((f: any) => f.id === genForm.function_id) as any;
                  const skills: string[] = Array.isArray(fn?.required_skills) ? fn.required_skills : [];
                  return skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-2">
                      {skills.map((s) => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600 pt-1">Deze functie heeft geen standaard-vaardigheden. Voeg eerst skills toe op de functie.</p>
                  );
                })()}
              </div>
            )}
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={!genForm.function_id || generateMutation.isPending}
              className="w-full mt-4"
            >
              {generateMutation.isPending ? 'Aanmaken...' : 'Pool aanmaken'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

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

            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-purple-600" /> Dynamische pool
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Vult zichzelf op basis van filters (skills, status, plaats). Handmatig toegevoegde leden blijven behouden.
                  </p>
                </div>
                <Switch
                  checked={form.is_dynamic}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_dynamic: v }))}
                />
              </div>
              {form.is_dynamic && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Refresh-frequentie</Label>
                  <Select
                    value={form.refresh_frequency}
                    onValueChange={(v: 'manual' | 'daily' | 'weekly') => setForm((f) => ({ ...f, refresh_frequency: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Alleen handmatig</SelectItem>
                      <SelectItem value="daily">Dagelijks (s'nachts)</SelectItem>
                      <SelectItem value="weekly">Wekelijks (zondagnacht)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
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
