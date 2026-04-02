import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { Users, Plus, Search, Upload, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import ImportWizard from '@/components/import/ImportWizard';

const PAGE_SIZE = 10;

const statusBadge: Record<string, string> = {
  nieuw: 'bg-muted text-muted-foreground border-0',
  in_behandeling: 'bg-yellow-100 text-yellow-700 border-0',
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  geplaatst: 'bg-blue-100 text-blue-700 border-0',
  inactief: 'bg-orange-100 text-orange-600 border-0',
  afgewezen: 'bg-red-100 text-red-600 border-0',
};

const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  nieuw: 'Nieuw', in_behandeling: 'In behandeling', beschikbaar: 'Beschikbaar',
  geplaatst: 'Geplaatst', inactief: 'Inactief', afgewezen: 'Afgewezen',
};

const getProfileLinkStatus = (candidate: any, tokens: any[]) => {
  const token = tokens.find((t) => t.candidate_id === candidate.id);
  if (!token) return { label: 'Niet verstuurd', className: 'bg-muted text-muted-foreground border-0' };
  if (token.used_at) return { label: 'Profiel compleet', className: 'bg-stat-green/10 text-stat-green border-0' };
  if (token.last_accessed_at) return { label: 'Bezig met invullen', className: 'bg-orange-100 text-orange-700 border-0' };
  return { label: 'Link verstuurd', className: 'bg-yellow-100 text-yellow-700 border-0' };
};

const Candidates = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [complianceFilter, setComplianceFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreset, setImportPreset] = useState<'carerix' | 'buddy' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['candidates', search, statusFilter, complianceFilter, page],
    queryFn: async () => {
      let query = supabase.from('candidates').select('*', { count: 'exact' });
      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,address_city.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);
      if (complianceFilter !== 'all') query = query.eq('compliance_status', complianceFilter as any);
      query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { candidates: data ?? [], total: count ?? 0 };
    },
  });

  const candidates = data?.candidates ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const candidateIds = candidates.map((c: any) => c.id);

  // Fetch latest profile tokens for visible candidates
  const { data: tokens } = useQuery({
    queryKey: ['candidate-profile-tokens-list', candidateIds],
    queryFn: async () => {
      if (candidateIds.length === 0) return [];
      const { data, error } = await supabase
        .from('candidate_profile_tokens')
        .select('candidate_id, used_at, last_accessed_at, expires_at')
        .in('candidate_id', candidateIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Deduplicate: keep only latest per candidate
      const seen = new Set<string>();
      return (data ?? []).filter((t) => {
        if (seen.has(t.candidate_id)) return false;
        seen.add(t.candidate_id);
        return true;
      });
    },
    enabled: candidateIds.length > 0,
  });

  const tokensList = tokens ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Kandidaten</h1>
          <p className="text-muted-foreground text-sm mt-1 hidden sm:block">Overzicht van alle kandidaten</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => { setImportPreset(null); setImportOpen(true); }} className="gap-1.5">
            <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Importeren</span><span className="sm:hidden">Import</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setImportPreset('buddy'); setImportOpen(true); }} className="gap-1.5 hidden md:flex">
            <Upload className="h-4 w-4" /> Buddy import
          </Button>
          <Button size="sm" onClick={() => navigate('/kandidaten/new')} className="gap-1.5">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nieuwe kandidaat</span><span className="sm:hidden">Nieuw</span>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op naam, stad of email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={complianceFilter} onValueChange={(v) => { setComplianceFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Compliance" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle compliance</SelectItem>
            <SelectItem value="compleet">Compleet</SelectItem>
            <SelectItem value="incompleet">Incompleet</SelectItem>
            <SelectItem value="verlopen">Verlopen</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} kandidaten</span>
      </div>

      {!isLoading && candidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Nog geen kandidaten</p>
          <Button onClick={() => navigate('/kandidaten/new')} variant="outline" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Voeg je eerste kandidaat toe
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Naam</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Profiel</TableHead>
                  <TableHead>Telefoon</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Vaardigheden</TableHead>
                  <TableHead>Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c: any, i: number) => {
                  const skills = c.skills ?? [];
                  const profileStatus = getProfileLinkStatus(c, tokensList);
                  return (
                    <TableRow key={c.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {c.screened_at && (c.screening_data as any)?.result && (c.screening_data as any)?.result !== 'niet_gescreend' ? (
                            (c.screening_data as any)?.result === 'goedgekeurd' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-stat-green flex-shrink-0" />
                            ) : (c.screening_data as any)?.result === 'afgekeurd' ? (
                              <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                            ) : (
                              <span className="h-2 w-2 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                            )
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-muted-foreground/20 flex-shrink-0" />
                          )}
                          <Link to={`/kandidaten/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                            {c.first_name} {c.last_name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusBadge[c.status] ?? ''}>
                          {statusLabel[c.status] ?? c.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={profileStatus.className}>
                          {profileStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell>{c.phone ?? '—'}</TableCell>
                      <TableCell>{c.email ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {skills.slice(0, 3).map((s: string) => (
                            <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                          {skills.length > 3 && <Badge variant="outline" className="text-xs">+{skills.length - 3}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={complianceBadge[c.compliance_status] ?? ''}>
                          {c.compliance_status}
                        </Badge>
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

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} target="candidates" preset={importPreset} />
    </div>
  );
};

export default Candidates;
