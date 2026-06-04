import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Plus, Search, Upload, CheckCircle2, XCircle, FolderHeart, SlidersHorizontal, UserPlus, Check, X, KeyRound, ArrowUpDown, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ImportWizard from '@/components/import/ImportWizard';
import AddToPoolSheet from '@/components/talentpools/AddToPoolSheet';
import PortalActivateSheet from '@/components/employees/PortalActivateSheet';
import LeadFunnelBoard from '@/components/candidates/LeadFunnelBoard';
import { PhoneLink } from '@/components/ui/contact-links';
import { MailButton } from '@/components/ui/mail-button';
import { formatDate } from '@/lib/format';
import { getPaginationRange } from '@/lib/pagination';

const PAGE_SIZE = 10;

const statusBadge: Record<string, string> = {
  lead: 'bg-sky-100 text-sky-700 border-0',
  nieuw: 'bg-muted text-muted-foreground border-0',
  in_behandeling: 'bg-amber-100 text-amber-700 border-0',
  beschikbaar: 'bg-stat-green/10 text-stat-green border-0',
  werkzoekend: 'bg-stat-green/10 text-stat-green border-0',
  in_screening: 'bg-yellow-100 text-yellow-700 border-0',
  geplaatst: 'bg-blue-100 text-blue-700 border-0',
  inactief: 'bg-muted text-muted-foreground border-0',
  afgewezen: 'bg-red-100 text-red-600 border-0',
  niet_beschikbaar: 'bg-orange-100 text-orange-600 border-0',
  uitgeschreven: 'bg-red-100 text-red-600 border-0',
};

const complianceBadge: Record<string, string> = {
  compleet: 'bg-stat-green/10 text-stat-green border-0',
  incompleet: 'bg-yellow-100 text-yellow-700 border-0',
  verlopen: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  lead: 'Lead', nieuw: 'Nieuw', in_behandeling: 'In behandeling', beschikbaar: 'Beschikbaar',
  werkzoekend: 'Werkzoekend', in_screening: 'In screening', geplaatst: 'Geplaatst',
  inactief: 'Inactief', afgewezen: 'Afgewezen', niet_beschikbaar: 'Niet beschikbaar',
  uitgeschreven: 'Uitgeschreven',
};

const employeeStatusBadge: Record<string, string> = {
  onboarding: 'bg-yellow-100 text-yellow-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  ziek: 'bg-orange-100 text-orange-600 border-0',
  uit_dienst: 'bg-muted text-muted-foreground border-0',
};

const employeeStatusLabel: Record<string, string> = {
  onboarding: 'Onboarding', actief: 'Actief', ziek: 'Ziek', uit_dienst: 'Uit dienst',
};

const placementDrivenStatuses = ['actief', 'ziek', 'onboarding'];

const getPlacementDrivenEmployeeStatus = (candidate: any) => {
  if (placementDrivenStatuses.includes(candidate.employee_status)) return candidate.employee_status;
  return 'actief';
};

const toInServiceCandidates = (placements: any[]) => {
  const byCandidate = new Map<string, any>();

  for (const placement of placements) {
    const candidate = placement.candidates;
    if (!candidate?.id) continue;

    const activePlacement = {
      id: placement.id,
      company_id: placement.company_id,
      companies: placement.companies,
      function_name: placement.function_name,
      start_date: placement.start_date,
      status: placement.status,
    };
    const existing = byCandidate.get(candidate.id);

    if (!existing) {
      byCandidate.set(candidate.id, {
        ...candidate,
        employee_status: getPlacementDrivenEmployeeStatus(candidate),
        activePlacement,
        activePlacements: [activePlacement],
      });
      continue;
    }

    existing.activePlacements.push(activePlacement);
    if (new Date(activePlacement.start_date).getTime() > new Date(existing.activePlacement?.start_date ?? 0).getTime()) {
      existing.activePlacement = activePlacement;
    }
  }

  return Array.from(byCandidate.values()).sort((a, b) => {
    const aDate = new Date(a.activePlacement?.start_date ?? 0).getTime();
    const bDate = new Date(b.activePlacement?.start_date ?? 0).getTime();
    return bDate - aDate;
  });
};

const getProfileLinkStatus = (candidate: any, tokens: any[]) => {
  const token = tokens.find((t) => t.candidate_id === candidate.id);
  if (!token) return { label: 'Niet verstuurd', className: 'bg-muted text-muted-foreground border-0' };
  if (token.used_at) return { label: 'Profiel compleet', className: 'bg-stat-green/10 text-stat-green border-0' };
  if (token.last_accessed_at) return { label: 'Bezig met invullen', className: 'bg-orange-100 text-orange-700 border-0' };
  return { label: 'Link verstuurd', className: 'bg-yellow-100 text-yellow-700 border-0' };
};

const candidateName = (candidate: any) => `${candidate.last_name ?? ''} ${candidate.first_name ?? ''}`.trim().toLowerCase();
type CandidateTab = 'alle' | 'instroom' | 'in-dienst';

const Candidates = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab: CandidateTab = searchParams.get('tab') === 'in-dienst'
    ? 'in-dienst'
    : searchParams.get('tab') === 'instroom'
      ? 'instroom'
      : 'alle';
  const [activeTab, setActiveTab] = useState<CandidateTab>(initialTab);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState('all');
  const [complianceFilter, setComplianceFilter] = useState('all');
  const [nameSort, setNameSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreset, setImportPreset] = useState<'carerix' | 'buddy' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [poolSheetOpen, setPoolSheetOpen] = useState(false);
  const [portalCandidate, setPortalCandidate] = useState<any | null>(null);
  const [cvSearch, setCvSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as CandidateTab);
    setPage(0);
    setSearch('');
    setStatusFilter('all');
    setEmployeeStatusFilter('all');
    setSelected(new Set());
    if (tab === 'instroom') {
      setSearchParams({ tab: 'instroom' });
    } else if (tab === 'in-dienst') {
      setSearchParams({ tab: 'in-dienst' });
    } else {
      setSearchParams({});
    }
  };

  const toggleNameSort = () => {
    setNameSort((current) => current === 'asc' ? 'desc' : 'asc');
    setPage(0);
  };

  // Query for "Alle" tab
  const { data, isLoading } = useQuery({
    queryKey: ['candidates', search, statusFilter, complianceFilter, cvSearch, nameSort, page],
    queryFn: async () => {
      let query = supabase.from('candidates').select('*', { count: 'exact' });
      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,address_city.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (cvSearch.trim()) {
        query = query.textSearch('cv_raw_text', cvSearch.trim(), { config: 'dutch' });
      }
      if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);
      if (complianceFilter !== 'all') query = query.eq('compliance_status', complianceFilter as any);
      if (nameSort === 'none') {
        query = query.order('created_at', { ascending: false });
      } else {
        query = query
          .order('last_name', { ascending: nameSort === 'asc', nullsFirst: false })
          .order('first_name', { ascending: nameSort === 'asc', nullsFirst: false });
      }
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { candidates: data ?? [], total: count ?? 0 };
    },
    enabled: activeTab === 'alle',
    placeholderData: keepPreviousData,
  });

  // Query for "In dienst" tab
  const { data: employeeData, isLoading: employeesLoading } = useQuery({
    queryKey: ['candidates-in-dienst', search, employeeStatusFilter, nameSort, page],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select(`
          id,
          company_id,
          function_name,
          start_date,
          status,
          companies!placements_company_id_fkey(name),
          candidates!placements_candidate_id_fkey(
            id,
            first_name,
            last_name,
            employee_number,
            employee_status,
            email,
            compliance_status,
            portal_enabled,
            housing_assignments!housing_assignments_candidate_id_fkey(id, status)
          )
        `)
        .eq('status', 'actief' as any)
        .not('candidate_id', 'is', null)
        .order('start_date', { ascending: false });
      if (error) throw error;

      const activeCandidates = toInServiceCandidates(data ?? []);
      const searchValue = search.trim().toLowerCase();
      const filtered = activeCandidates.filter((candidate: any) => {
        if (employeeStatusFilter !== 'all' && candidate.employee_status !== employeeStatusFilter) return false;
        if (!searchValue) return true;

        const activePlacement = candidate.activePlacement;
        const haystack = [
          candidate.first_name,
          candidate.last_name,
          candidate.employee_number,
          activePlacement?.companies?.name,
          activePlacement?.function_name,
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.includes(searchValue);
      });
      if (nameSort !== 'none') {
        filtered.sort((a: any, b: any) => {
          const result = candidateName(a).localeCompare(candidateName(b), 'nl', { sensitivity: 'base' });
          return nameSort === 'asc' ? result : -result;
        });
      }

      const start = page * PAGE_SIZE;

      return { employees: filtered.slice(start, start + PAGE_SIZE), total: filtered.length };
    },
    enabled: activeTab === 'in-dienst',
    placeholderData: keepPreviousData,
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

  const toggleCandidate = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (candidates.every((c: any) => selected.has(c.id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        candidates.forEach((c: any) => next.delete(c.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        candidates.forEach((c: any) => next.add(c.id));
        return next;
      });
    }
  };

  const allOnPageSelected = candidates.length > 0 && candidates.every((c: any) => selected.has(c.id));

  const employees = employeeData?.employees ?? [];
  const employeeTotal = employeeData?.total ?? 0;
  const employeeTotalPages = Math.ceil(employeeTotal / PAGE_SIZE);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Kandidaten</h1>
          <p className="text-muted-foreground text-sm mt-1 hidden sm:block">Overzicht van alle kandidaten</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeTab === 'alle' && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setImportPreset(null); setImportOpen(true); }} className="gap-1.5">
                <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Importeren</span><span className="sm:hidden">Import</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setImportPreset('buddy'); setImportOpen(true); }} className="gap-1.5 hidden md:flex">
                <Upload className="h-4 w-4" /> Buddy import
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/kandidaten/duplicaten')} className="gap-1.5 hidden md:flex">
                <Copy className="h-4 w-4" /> Duplicaten
              </Button>
              <Button size="sm" onClick={() => navigate('/kandidaten/new')} className="gap-1.5">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nieuwe kandidaat</span><span className="sm:hidden">Nieuw</span>
              </Button>
            </>
          )}
          {activeTab === 'in-dienst' && (
            <Button size="sm" onClick={() => navigate('/medewerkers/new')} className="gap-1.5">
              <UserPlus className="h-4 w-4" /> In dienst nemen
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="alle">Alle kandidaten</TabsTrigger>
          <TabsTrigger value="instroom">Instroomfunnel</TabsTrigger>
          <TabsTrigger value="in-dienst">In dienst</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'alle' && (
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
          <Button
            variant={showAdvanced ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="gap-1.5"
          >
            <SlidersHorizontal className="h-4 w-4" /> CV zoeken
          </Button>
          <span className="text-sm text-muted-foreground">{total} kandidaten</span>
        </div>
      )}

      {activeTab === 'in-dienst' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Zoek op naam..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
          </div>
          <Select value={employeeStatusFilter} onValueChange={(v) => { setEmployeeStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statussen</SelectItem>
              {Object.entries(employeeStatusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{employeeTotal} in dienst</span>
        </div>
      )}

      {/* Advanced: CV full-text search */}
      {activeTab === 'alle' && showAdvanced && (
        <div className="bg-card rounded-lg border p-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Zoek in CV-tekst</label>
            <div className="flex gap-2">
              <Input
                placeholder="bijv. lassen MIG TIG ervaring"
                value={cvSearch}
                onChange={(e) => { setCvSearch(e.target.value); setPage(0); }}
                className="flex-1"
              />
              {cvSearch && (
                <Button variant="ghost" size="sm" onClick={() => { setCvSearch(''); setPage(0); }}>
                  Wissen
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Zoekt met Nederlandse taalondersteuning in de volledige CV-tekst</p>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {activeTab === 'alle' && selected.size > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{selected.size} geselecteerd</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPoolSheetOpen(true)} className="gap-1.5">
              <FolderHeart className="h-4 w-4" /> Toevoegen aan talentpool
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Deselecteren
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'instroom' && <LeadFunnelBoard />}

      {/* ===== ALLE KANDIDATEN TAB ===== */}
      {activeTab === 'alle' && (
        <>
          {isLoading ? (
            <div className="bg-card rounded-lg border p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : candidates.length === 0 ? (
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
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAll} />
                      </TableHead>
                      <TableHead>
                        <Button type="button" variant="ghost" size="sm" className="-ml-3 gap-1.5" onClick={toggleNameSort}>
                          Naam
                          <ArrowUpDown className="h-3.5 w-3.5" />
                          {nameSort !== 'none' && <span className="text-xs text-muted-foreground">{nameSort === 'asc' ? 'A-Z' : 'Z-A'}</span>}
                        </Button>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Profiel</TableHead>
                      <TableHead>Telefoon</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Vaardigheden</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead className="text-right">Acties</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c: any, i: number) => {
                      const skills = c.skills ?? [];
                      const profileStatus = getProfileLinkStatus(c, tokensList);
                      return (
                        <TableRow key={c.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleCandidate(c.id)} />
                          </TableCell>
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
                          <TableCell><PhoneLink phone={c.phone} /></TableCell>
                          <TableCell><MailButton email={c.email} asText /></TableCell>
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
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              disabled={!c.email}
                              onClick={() => setPortalCandidate(c)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              Portaal
                            </Button>
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
                    {getPaginationRange(page, totalPages).map((item, i) => (
                      <PaginationItem key={`${item}-${i}`}>
                        {typeof item === 'number' ? (
                          <PaginationLink isActive={item === page} onClick={() => setPage(item)} className="cursor-pointer">{item + 1}</PaginationLink>
                        ) : (
                          <PaginationEllipsis />
                        )}
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
        </>
      )}

      {/* ===== IN DIENST TAB ===== */}
      {activeTab === 'in-dienst' && (
        <>
          {employeesLoading ? (
            <div className="bg-card rounded-lg border p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">Nog geen kandidaten in dienst</p>
              <Button onClick={() => navigate('/medewerkers/new')} variant="outline" className="mt-4 gap-2">
                <UserPlus className="h-4 w-4" /> Kandidaat in dienst nemen
              </Button>
            </div>
          ) : (
            <>
              <div className="bg-card rounded-lg border overflow-x-auto">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Button type="button" variant="ghost" size="sm" className="-ml-3 gap-1.5" onClick={toggleNameSort}>
                          Naam
                          <ArrowUpDown className="h-3.5 w-3.5" />
                          {nameSort !== 'none' && <span className="text-xs text-muted-foreground">{nameSort === 'asc' ? 'A-Z' : 'Z-A'}</span>}
                        </Button>
                      </TableHead>
                      <TableHead>Medewerkernr.</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead>Startdatum</TableHead>
                      <TableHead>Huisvesting</TableHead>
                      <TableHead>Portaal</TableHead>
                      <TableHead>Actieve plaatsing</TableHead>
                      <TableHead className="text-right">Acties</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employees.map((c: any, i: number) => {
                      const hasHousing = (c.housing_assignments ?? []).some((h: any) => h.status === 'ingecheckt');
                      const activePlacement = c.activePlacement;
                      const companyName = activePlacement?.companies?.name;
                      const extraPlacements = Math.max(0, (c.activePlacements?.length ?? 1) - 1);
                      return (
                        <TableRow key={c.id} className={i % 2 === 1 ? 'bg-background' : ''}>
                          <TableCell>
                            <Link to={`/kandidaten/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                              {c.first_name} {c.last_name}
                            </Link>
                          </TableCell>
                          <TableCell>{c.employee_number ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={employeeStatusBadge[c.employee_status] ?? ''}>
                              {employeeStatusLabel[c.employee_status] ?? c.employee_status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={complianceBadge[c.compliance_status] ?? ''}>
                              {c.compliance_status ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(activePlacement?.start_date)}</TableCell>
                          <TableCell>
                            {hasHousing
                              ? <Check className="h-4 w-4 text-stat-green" />
                              : <X className="h-4 w-4 text-red-500" />}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.portal_enabled ? 'bg-stat-green' : 'bg-muted-foreground/30'}`} />
                          </TableCell>
                          <TableCell>
                            {activePlacement ? (
                              <div className="flex items-center gap-1.5">
                                <Link to={`/plaatsingen/${activePlacement.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                                  {companyName ?? activePlacement.function_name ?? 'Plaatsing'}
                                </Link>
                                {extraPlacements > 0 && <Badge variant="outline" className="text-xs">+{extraPlacements}</Badge>}
                              </div>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              disabled={!c.email}
                              onClick={() => setPortalCandidate(c)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              {c.portal_enabled ? 'Opnieuw' : 'Uitnodigen'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {employeeTotalPages > 1 && (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious onClick={() => setPage(Math.max(0, page - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                    </PaginationItem>
                    {getPaginationRange(page, employeeTotalPages).map((item, i) => (
                      <PaginationItem key={`${item}-${i}`}>
                        {typeof item === 'number' ? (
                          <PaginationLink isActive={item === page} onClick={() => setPage(item)} className="cursor-pointer">{item + 1}</PaginationLink>
                        ) : (
                          <PaginationEllipsis />
                        )}
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext onClick={() => setPage(Math.min(employeeTotalPages - 1, page + 1))} className={page >= employeeTotalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </>
          )}
        </>
      )}

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} target="candidates" preset={importPreset} />
      <AddToPoolSheet
        open={poolSheetOpen}
        onOpenChange={setPoolSheetOpen}
        candidateIds={Array.from(selected)}
        onDone={() => setSelected(new Set())}
      />
      {portalCandidate && (
        <PortalActivateSheet
          open={!!portalCandidate}
          onOpenChange={(open) => { if (!open) setPortalCandidate(null); }}
          candidateId={portalCandidate.id}
          candidateEmail={portalCandidate.email}
        />
      )}
    </div>
  );
};

export default Candidates;
