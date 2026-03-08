import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import TagInput from '@/components/ui/tag-input';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Download, ExternalLink, Globe, Building2, Briefcase, MapPin, Loader2, Plus, ChevronDown, X, DollarSign, Clock, Users, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { nl } from 'date-fns/locale';

const ATS_OPTIONS = [
  'greenhouse', 'workday', 'lever.co', 'icims', 'smartrecruiters', 'ashby',
  'successfactors', 'taleo', 'oraclecloud', 'bamboohr', 'rippling', 'personio',
  'workable', 'jobvite', 'recruitee', 'teamtailor', 'jazzhr', 'breezy',
];

const TAXONOMY_OPTIONS = [
  'Technology', 'Healthcare', 'Finance & Accounting', 'Sales', 'Marketing',
  'Engineering', 'Human Resources', 'Customer Service & Support', 'Logistics',
  'Manufacturing', 'Consulting', 'Education', 'Legal', 'Retail',
  'Hospitality', 'Construction', 'Creative & Media', 'Data & Analytics',
];

const WORK_ARRANGEMENTS = ['On-site', 'Hybrid', 'Remote OK', 'Remote Solely'];

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];

const EXPERIENCE_LEVELS = ['Internship', 'Entry level', 'Associate', 'Mid-Senior level', 'Director', 'Executive'];

const PAGE_SIZE = 25;

const Vacaturebank = () => {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Import sheet state
  const [importOpen, setImportOpen] = useState(false);
  const [importTimeRange, setImportTimeRange] = useState('7d');
  const [importLimit, setImportLimit] = useState('100');

  // Search filters
  const [importTitleSearch, setImportTitleSearch] = useState<string[]>([]);
  const [importTitleExclusion, setImportTitleExclusion] = useState<string[]>([]);
  const [importLocationSearch, setImportLocationSearch] = useState<string[]>([]);
  const [importLocationExclusion, setImportLocationExclusion] = useState<string[]>([]);
  const [importDescriptionSearch, setImportDescriptionSearch] = useState<string[]>([]);
  const [importDescriptionExclusion, setImportDescriptionExclusion] = useState<string[]>([]);
  const [importOrgSearch, setImportOrgSearch] = useState<string[]>([]);
  const [importOrgExclusion, setImportOrgExclusion] = useState<string[]>([]);
  const [importDomainFilter, setImportDomainFilter] = useState<string[]>([]);
  const [importDomainExclusion, setImportDomainExclusion] = useState<string[]>([]);

  // ATS
  const [importAts, setImportAts] = useState<string[]>([]);
  const [importAtsExclusion, setImportAtsExclusion] = useState<string[]>([]);

  // AI filters
  const [importTaxonomy, setImportTaxonomy] = useState<string[]>([]);
  const [importTaxonomyPrimary, setImportTaxonomyPrimary] = useState<string[]>([]);
  const [importTaxonomyExclusion, setImportTaxonomyExclusion] = useState<string[]>([]);
  const [importWorkArr, setImportWorkArr] = useState<string[]>([]);
  const [importEmploymentType, setImportEmploymentType] = useState<string[]>([]);
  const [importExperienceLevel, setImportExperienceLevel] = useState<string[]>([]);
  const [importHasSalary, setImportHasSalary] = useState(false);
  const [importVisaSponsorship, setImportVisaSponsorship] = useState(false);

  // LinkedIn filters
  const [importLinkedInIndustry, setImportLinkedInIndustry] = useState<string[]>([]);
  const [importMinEmployees, setImportMinEmployees] = useState('');
  const [importMaxEmployees, setImportMaxEmployees] = useState('');

  // Other
  const [importRemoveAgency, setImportRemoveAgency] = useState(false);

  // Advanced sections
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Filter state
  const [search, setSearch] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterWorkArr, setFilterWorkArr] = useState('');
  const [filterTaxonomy, setFilterTaxonomy] = useState('');
  const [page, setPage] = useState(0);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertCompanyId, setConvertCompanyId] = useState('');

  // Detail slide-over
  const [detailJob, setDetailJob] = useState<any | null>(null);

  // Fetch jobs
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['job-listings', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('job_listings')
        .select('*')
        .order('date_posted', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!organizationId,
  });

  // Fetch companies for convert dialog
  const { data: companies } = useQuery({
    queryKey: ['companies-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Derived filter options
  const countries = useMemo(() => [...new Set(jobs.map(j => j.country).filter(Boolean))].sort(), [jobs]);
  const sources = useMemo(() => [...new Set(jobs.map(j => j.source).filter(Boolean))].sort(), [jobs]);
  const taxonomies = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => j.ai_taxonomies?.forEach((t: string) => set.add(t)));
    return [...set].sort();
  }, [jobs]);

  // Filtered jobs
  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (search) {
        const s = search.toLowerCase();
        if (
          !j.title?.toLowerCase().includes(s) &&
          !j.organization_name?.toLowerCase().includes(s) &&
          !j.city?.toLowerCase().includes(s)
        ) return false;
      }
      if (filterCountry && j.country !== filterCountry) return false;
      if (filterSource && j.source !== filterSource) return false;
      if (filterWorkArr && j.work_arrangement !== filterWorkArr) return false;
      if (filterTaxonomy && !j.ai_taxonomies?.includes(filterTaxonomy)) return false;
      return true;
    });
  }, [jobs, search, filterCountry, filterSource, filterWorkArr, filterTaxonomy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Selection helpers
  const allPageSelected = paged.length > 0 && paged.every(j => selectedIds.has(j.id));
  const someSelected = selectedIds.size > 0;

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) {
        paged.forEach(j => next.delete(j.id));
      } else {
        paged.forEach(j => next.add(j.id));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map(j => j.id)));
  };

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        timeRange: importTimeRange,
        limit: parseInt(importLimit) || 100,
      };

      // Search arrays
      if (importTitleSearch.length) body.titleSearch = importTitleSearch;
      if (importTitleExclusion.length) body.titleExclusionSearch = importTitleExclusion;
      if (importLocationSearch.length) body.locationSearch = importLocationSearch;
      if (importLocationExclusion.length) body.locationExclusionSearch = importLocationExclusion;
      if (importDescriptionSearch.length) body.descriptionSearch = importDescriptionSearch;
      if (importDescriptionExclusion.length) body.descriptionExclusionSearch = importDescriptionExclusion;
      if (importOrgSearch.length) body.organizationSearch = importOrgSearch;
      if (importOrgExclusion.length) body.organizationExclusionSearch = importOrgExclusion;
      if (importDomainFilter.length) body.domainFilter = importDomainFilter;
      if (importDomainExclusion.length) body.domainExclusionFilter = importDomainExclusion;

      // ATS
      if (importAts.length) body.ats = importAts;
      if (importAtsExclusion.length) body.atsExclusionFilter = importAtsExclusion;

      // AI filters
      if (importTaxonomy.length) body.aiTaxonomiesFilter = importTaxonomy;
      if (importTaxonomyPrimary.length) body.aiTaxonomiesPrimaryFilter = importTaxonomyPrimary;
      if (importTaxonomyExclusion.length) body.aiTaxonomiesExclusionFilter = importTaxonomyExclusion;
      if (importWorkArr.length) body.aiWorkArrangementFilter = importWorkArr;
      if (importEmploymentType.length) body.aiEmploymentTypeFilter = importEmploymentType;
      if (importExperienceLevel.length) body.aiExperienceLevelFilter = importExperienceLevel;
      if (importHasSalary) body.aiHasSalary = true;
      if (importVisaSponsorship) body.aiVisaSponsorshipFilter = true;

      // LinkedIn
      if (importLinkedInIndustry.length) body.liIndustryFilter = importLinkedInIndustry;
      if (importMinEmployees) body.liOrganizationEmployeesGte = parseInt(importMinEmployees);
      if (importMaxEmployees) body.liOrganizationEmployeesLte = parseInt(importMaxEmployees);

      // Other
      if (importRemoveAgency) body.removeAgency = true;

      const { data, error } = await supabase.functions.invoke('apify-job-import', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.total} vacatures opgehaald, ${data.new_count} verwerkt`);
      queryClient.invalidateQueries({ queryKey: ['job-listings'] });
      setImportOpen(false);
    },
    onError: (e: any) => toast.error(e.message || 'Import mislukt'),
  });

  // Convert to vacancies mutation — auto-match company by organization_name
  const convertMutation = useMutation({
    mutationFn: async () => {
      const selectedJobs = jobs.filter(j => selectedIds.has(j.id));

      // Group by organization_name, match to existing companies or use fallback
      const companyNameToId: Record<string, string> = {};
      for (const c of companies ?? []) {
        companyNameToId[c.name.toLowerCase()] = c.id;
      }

      const payloads = selectedJobs.map(job => {
        const orgName = (job.organization_name || '').toLowerCase();
        const matchedCompanyId = companyNameToId[orgName] || convertCompanyId;
        if (!matchedCompanyId) throw new Error(`Geen opdrachtgever gevonden voor "${job.organization_name}". Selecteer een standaard opdrachtgever.`);

        return {
          organization_id: organizationId,
          company_id: matchedCompanyId,
          title: job.title,
          description: job.description_text || null,
          location: [job.city, job.country].filter(Boolean).join(', ') || null,
          required_skills: job.ai_key_skills?.length ? job.ai_key_skills : null,
          required_count: 1,
          urgency: 3,
          notes: [
            job.organization_name && `Bron bedrijf: ${job.organization_name}`,
            job.url && `Originele vacature: ${job.url}`,
            job.source && `ATS: ${job.source}`,
            job.work_arrangement && `Werkmodel: ${job.work_arrangement}`,
          ].filter(Boolean).join('\n'),
          created_by: user?.id ?? null,
        };
      });

      const { error } = await supabase.from('vacancies').insert(payloads);
      if (error) throw error;
      return payloads.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} vacature${count !== 1 ? 's' : ''} aangemaakt`);
      queryClient.invalidateQueries({ queryKey: ['vacancies'] });
      setSelectedIds(new Set());
      setConvertOpen(false);
      setConvertCompanyId('');
    },
    onError: (e: any) => toast.error(e.message || 'Fout bij aanmaken'),
  });

  // Check how many selected jobs have a matching company
  const selectedJobsList = useMemo(() => jobs.filter(j => selectedIds.has(j.id)), [jobs, selectedIds]);
  const unmatchedJobs = useMemo(() => {
    if (!companies) return selectedJobsList;
    const companyNames = new Set((companies ?? []).map(c => c.name.toLowerCase()));
    return selectedJobsList.filter(j => !j.organization_name || !companyNames.has(j.organization_name.toLowerCase()));
  }, [selectedJobsList, companies]);

  const toggleArray = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vacaturebank</h1>
          <p className="text-muted-foreground text-sm">Externe vacatures van career sites</p>
        </div>
        <Sheet open={importOpen} onOpenChange={setImportOpen}>
          <SheetTrigger asChild>
            <Button><Download className="h-4 w-4 mr-2" /> Importeren</Button>
          </SheetTrigger>
          <SheetContent className="overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>Vacatures importeren</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-5">
              {/* Basic settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tijdsperiode</Label>
                  <Select value={importTimeRange} onValueChange={setImportTimeRange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Laatste uur</SelectItem>
                      <SelectItem value="24h">Laatste 24 uur</SelectItem>
                      <SelectItem value="7d">Laatste 7 dagen</SelectItem>
                      <SelectItem value="6m">Backfill (6 maanden)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Max vacatures</Label>
                  <Input
                    type="number"
                    min={10}
                    max={5000}
                    value={importLimit}
                    onChange={e => setImportLimit(e.target.value)}
                  />
                </div>
              </div>

              {/* Title search */}
              <div>
                <Label>Titel zoeken</Label>
                <TagInput
                  value={importTitleSearch}
                  onChange={setImportTitleSearch}
                  placeholder="bijv. Software Engineer + Enter"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Gebruik :* voor prefix matching (bijv. Soft:*)</p>
              </div>

              {/* Location search */}
              <div>
                <Label>Locatie zoeken</Label>
                <TagInput
                  value={importLocationSearch}
                  onChange={setImportLocationSearch}
                  placeholder="bijv. Netherlands, Amsterdam + Enter"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Gebruik Engels: Netherlands, Germany, Belgium. Formaat: City, State, Country</p>
              </div>

              {/* ATS */}
              <div>
                <Label className="mb-2 block">ATS Platform</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ATS_OPTIONS.map(a => (
                    <Badge
                      key={a}
                      variant={importAts.includes(a) ? 'default' : 'outline'}
                      className="cursor-pointer capitalize text-xs"
                      onClick={() => setImportAts(prev => toggleArray(prev, a))}
                    >
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Branche */}
              <div>
                <Label className="mb-2 block">Branche / Taxonomie</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TAXONOMY_OPTIONS.map(t => (
                    <Badge
                      key={t}
                      variant={importTaxonomy.includes(t) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setImportTaxonomy(prev => toggleArray(prev, t))}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Work arrangement */}
              <div>
                <Label className="mb-2 block">Werkarrangement</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WORK_ARRANGEMENTS.map(w => (
                    <Badge
                      key={w}
                      variant={importWorkArr.includes(w) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setImportWorkArr(prev => toggleArray(prev, w))}
                    >
                      {w}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Employment type */}
              <div>
                <Label className="mb-2 block">Dienstverband</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EMPLOYMENT_TYPES.map(t => (
                    <Badge
                      key={t}
                      variant={importEmploymentType.includes(t) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setImportEmploymentType(prev => toggleArray(prev, t))}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Experience level */}
              <div>
                <Label className="mb-2 block">Ervaringsniveau</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EXPERIENCE_LEVELS.map(l => (
                    <Badge
                      key={l}
                      variant={importExperienceLevel.includes(l) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setImportExperienceLevel(prev => toggleArray(prev, l))}
                    >
                      {l}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Toggle filters */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Alleen met salarisinformatie</Label>
                  <Switch checked={importHasSalary} onCheckedChange={setImportHasSalary} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Visum sponsoring</Label>
                  <Switch checked={importVisaSponsorship} onCheckedChange={setImportVisaSponsorship} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Uitzendbureaus uitsluiten</Label>
                  <Switch checked={importRemoveAgency} onCheckedChange={setImportRemoveAgency} />
                </div>
              </div>

              <Separator />

              {/* Advanced / Exclusion filters */}
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 w-full justify-between text-muted-foreground">
                    Geavanceerde filters
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-3">
                  <div>
                    <Label>Titel uitsluiten</Label>
                    <TagInput value={importTitleExclusion} onChange={setImportTitleExclusion} placeholder="Titels uitsluiten..." />
                  </div>

                  <div>
                    <Label>Locatie uitsluiten</Label>
                    <TagInput value={importLocationExclusion} onChange={setImportLocationExclusion} placeholder="Locaties uitsluiten..." />
                  </div>

                  <div>
                    <Label>Beschrijving zoeken</Label>
                    <TagInput value={importDescriptionSearch} onChange={setImportDescriptionSearch} placeholder="Zoektermen in beschrijving..." />
                    <p className="text-[10px] text-muted-foreground mt-1">Wees specifiek, combineer met titelzoeken</p>
                  </div>

                  <div>
                    <Label>Beschrijving uitsluiten</Label>
                    <TagInput value={importDescriptionExclusion} onChange={setImportDescriptionExclusion} placeholder="Termen uitsluiten uit beschrijving..." />
                  </div>

                  <div>
                    <Label>Organisatie zoeken</Label>
                    <TagInput value={importOrgSearch} onChange={setImportOrgSearch} placeholder="bijv. Google, Microsoft + Enter" />
                  </div>

                  <div>
                    <Label>Organisatie uitsluiten</Label>
                    <TagInput value={importOrgExclusion} onChange={setImportOrgExclusion} placeholder="Organisaties uitsluiten..." />
                  </div>

                  <div>
                    <Label>Domein filter</Label>
                    <TagInput value={importDomainFilter} onChange={setImportDomainFilter} placeholder="bijv. google.com + Enter" />
                  </div>

                  <div>
                    <Label>Domein uitsluiten</Label>
                    <TagInput value={importDomainExclusion} onChange={setImportDomainExclusion} placeholder="Domeinen uitsluiten..." />
                  </div>

                  <div>
                    <Label className="mb-2 block">ATS uitsluiten</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {ATS_OPTIONS.map(a => (
                        <Badge
                          key={a}
                          variant={importAtsExclusion.includes(a) ? 'destructive' : 'outline'}
                          className="cursor-pointer capitalize text-xs"
                          onClick={() => setImportAtsExclusion(prev => toggleArray(prev, a))}
                        >
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Primaire branche filter</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {TAXONOMY_OPTIONS.map(t => (
                        <Badge
                          key={t}
                          variant={importTaxonomyPrimary.includes(t) ? 'default' : 'outline'}
                          className="cursor-pointer text-xs"
                          onClick={() => setImportTaxonomyPrimary(prev => toggleArray(prev, t))}
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Branche uitsluiten</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {TAXONOMY_OPTIONS.map(t => (
                        <Badge
                          key={t}
                          variant={importTaxonomyExclusion.includes(t) ? 'destructive' : 'outline'}
                          className="cursor-pointer text-xs"
                          onClick={() => setImportTaxonomyExclusion(prev => toggleArray(prev, t))}
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Separator />
                  <p className="text-xs font-medium text-muted-foreground">LinkedIn bedrijfsdata</p>

                  <div>
                    <Label>LinkedIn industrie</Label>
                    <TagInput value={importLinkedInIndustry} onChange={setImportLinkedInIndustry} placeholder="bijv. Information Technology + Enter" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Min. werknemers</Label>
                      <Input type="number" min={0} value={importMinEmployees} onChange={e => setImportMinEmployees(e.target.value)} placeholder="bijv. 50" />
                    </div>
                    <div>
                      <Label>Max. werknemers</Label>
                      <Input type="number" min={0} value={importMaxEmployees} onChange={e => setImportMaxEmployees(e.target.value)} placeholder="bijv. 500" />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
                className="w-full"
              >
                {importMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importeren...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" /> Importeren</>
                )}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Briefcase className="h-4 w-4" /> Totaal
          </div>
          <p className="text-2xl font-bold text-foreground">{jobs.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Globe className="h-4 w-4" /> Landen
          </div>
          <p className="text-2xl font-bold text-foreground">{countries.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Building2 className="h-4 w-4" /> Bronnen
          </div>
          <p className="text-2xl font-bold text-foreground">{sources.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <MapPin className="h-4 w-4" /> Gefilterd
          </div>
          <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op titel, bedrijf of stad..."
            className="pl-9"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <Select value={filterCountry} onValueChange={v => { setFilterCountry(v === '_all' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Land" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Alle landen</SelectItem>
            {countries.map(c => <SelectItem key={c} value={c!}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={v => { setFilterSource(v === '_all' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="ATS" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Alle ATS</SelectItem>
            {sources.map(s => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterWorkArr} onValueChange={v => { setFilterWorkArr(v === '_all' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Werkmodel" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Alle werkmodellen</SelectItem>
            {WORK_ARRANGEMENTS.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterTaxonomy} onValueChange={v => { setFilterTaxonomy(v === '_all' ? '' : v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Branche" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Alle branches</SelectItem>
            {taxonomies.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Floating action bar */}
      {someSelected && (
        <div className="sticky top-0 z-10 flex items-center gap-3 rounded-lg border bg-card p-3 shadow-md">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} geselecteerd
          </span>
          {selectedIds.size < filtered.length && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAllFiltered}>
              Selecteer alle {filtered.length}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedIds(new Set())}>
            Deselecteren
          </Button>
          <div className="ml-auto">
            <Button size="sm" onClick={() => setConvertOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Toevoegen aan vacatures
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allPageSelected && paged.length > 0}
                  onCheckedChange={togglePage}
                />
              </TableHead>
              <TableHead>Titel</TableHead>
              <TableHead>Bedrijf</TableHead>
              <TableHead>Locatie</TableHead>
              <TableHead>Branche</TableHead>
              <TableHead>ATS</TableHead>
              <TableHead>Werkmodel</TableHead>
              <TableHead>Datum</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Laden...
                </TableCell>
              </TableRow>
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {jobs.length === 0
                    ? 'Nog geen vacatures geïmporteerd. Klik op "Importeren" om te beginnen.'
                    : 'Geen vacatures gevonden met deze filters.'}
                </TableCell>
              </TableRow>
            ) : (
              paged.map(job => (
                <TableRow
                  key={job.id}
                  className={`cursor-pointer ${selectedIds.has(job.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
                  onClick={() => setDetailJob(job)}
                >
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(job.id)}
                      onCheckedChange={() => toggleOne(job.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[250px] truncate">{job.title}</TableCell>
                  <TableCell className="max-w-[150px] truncate">{job.organization_name || '—'}</TableCell>
                  <TableCell className="text-sm">
                    {[job.city, job.country].filter(Boolean).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    {job.ai_taxonomies?.[0] ? (
                      <Badge variant="secondary" className="text-[10px]">{job.ai_taxonomies[0]}</Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="capitalize text-sm">{job.source || '—'}</TableCell>
                  <TableCell className="text-sm">{job.work_arrangement || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {job.date_posted
                      ? format(new Date(job.date_posted), 'd MMM', { locale: nl })
                      : '—'}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {job.url && (
                      <a href={job.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Pagina {page + 1} van {totalPages} ({filtered.length} resultaten)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Vorige
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Volgende
            </Button>
          </div>
        </div>
      )}

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Toevoegen aan vacatures</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {selectedIds.size} vacature{selectedIds.size !== 1 ? 's' : ''} worden aangemaakt.
              Vacatures worden automatisch gekoppeld aan de opdrachtgever op basis van bedrijfsnaam.
            </p>

            {unmatchedJobs.length > 0 && (
              <div className="space-y-2">
                <Label>Standaard opdrachtgever *</Label>
                <p className="text-xs text-muted-foreground">
                  {unmatchedJobs.length} vacature{unmatchedJobs.length !== 1 ? 's' : ''} hebben geen matching bedrijf. Selecteer een standaard opdrachtgever.
                </p>
                <Select value={convertCompanyId} onValueChange={setConvertCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Selecteer opdrachtgever" /></SelectTrigger>
                  <SelectContent>
                    {(companies ?? []).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {unmatchedJobs.length === 0 && (
              <div className="rounded-lg border border-stat-green/30 bg-stat-green/5 p-3">
                <p className="text-sm text-stat-green">✓ Alle vacatures worden automatisch aan de juiste opdrachtgever gekoppeld.</p>
              </div>
            )}

            <div className="rounded-lg border bg-muted/50 p-3 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-muted-foreground mb-2">Geselecteerde vacatures:</p>
              <ul className="space-y-1">
                {selectedJobsList.slice(0, 20).map(j => (
                  <li key={j.id} className="text-sm text-foreground truncate">
                    • {j.title} {j.organization_name ? `(${j.organization_name})` : ''}
                  </li>
                ))}
                {selectedIds.size > 20 && (
                  <li className="text-xs text-muted-foreground">...en {selectedIds.size - 20} meer</li>
                )}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Annuleren</Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={(unmatchedJobs.length > 0 && !convertCompanyId) || convertMutation.isPending}
            >
              {convertMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aanmaken...</>
              ) : (
                <><Plus className="h-4 w-4 mr-2" /> {selectedIds.size} vacature{selectedIds.size !== 1 ? 's' : ''} aanmaken</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Job Detail Slide-over */}
      <Sheet open={!!detailJob} onOpenChange={open => { if (!open) setDetailJob(null); }}>
        <SheetContent className="sm:max-w-2xl p-0 overflow-hidden">
          {detailJob && (
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <SheetHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <SheetTitle className="text-xl">{detailJob.title}</SheetTitle>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        {detailJob.organization_name && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" />
                            {detailJob.organization_name}
                          </span>
                        )}
                        {detailJob.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {[detailJob.city, detailJob.country].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </SheetHeader>

                {/* Quick badges */}
                <div className="flex flex-wrap gap-2">
                  {detailJob.work_arrangement && <Badge variant="secondary">{detailJob.work_arrangement}</Badge>}
                  {detailJob.employment_type?.map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}
                  {detailJob.source && <Badge variant="outline" className="capitalize">{detailJob.source}</Badge>}
                  {detailJob.date_posted && (
                    <Badge variant="outline" className="gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(detailJob.date_posted), 'd MMM yyyy', { locale: nl })}
                    </Badge>
                  )}
                </div>

                {/* Salary info */}
                {(detailJob.ai_salary_min || detailJob.ai_salary_max) && (
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <DollarSign className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {detailJob.ai_salary_currency || '€'}{' '}
                          {detailJob.ai_salary_min?.toLocaleString() || '?'} – {detailJob.ai_salary_max?.toLocaleString() || '?'}
                          {detailJob.ai_salary_unit && ` / ${detailJob.ai_salary_unit}`}
                        </p>
                        <p className="text-xs text-muted-foreground">Geschat salaris (AI)</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Skills */}
                {detailJob.ai_key_skills?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Vaardigheden (AI)</CardTitle></CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                      {detailJob.ai_key_skills.map((s: string) => (
                        <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Taxonomies */}
                {detailJob.ai_taxonomies?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Branches (AI)</CardTitle></CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                      {detailJob.ai_taxonomies.map((t: string) => (
                        <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Company info */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Bedrijfsinformatie</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {detailJob.organization_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bedrijf</span>
                        <span className="flex items-center gap-2">
                          {detailJob.organization_logo && (
                            <img src={detailJob.organization_logo} alt="" className="h-5 w-5 rounded object-contain" />
                          )}
                          {detailJob.organization_name}
                        </span>
                      </div>
                    )}
                    {detailJob.organization_url && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Website</span>
                        <a href={detailJob.organization_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[200px]">
                          {detailJob.organization_url}
                        </a>
                      </div>
                    )}
                    {detailJob.linkedin_org_industry && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Industrie (LinkedIn)</span>
                        <span>{detailJob.linkedin_org_industry}</span>
                      </div>
                    )}
                    {detailJob.linkedin_org_employees && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Werknemers (LinkedIn)</span>
                        <span>{detailJob.linkedin_org_employees.toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Location details */}
                {detailJob.locations_derived && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Locatie details</CardTitle></CardHeader>
                    <CardContent className="text-sm">
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted/50 rounded p-2">
                        {JSON.stringify(detailJob.locations_derived, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Description */}
                {detailJob.description_text && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Beschrijving</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-[500px] overflow-y-auto">
                        {detailJob.description_text}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Meta */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Meta</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">External ID</span><span className="font-mono text-xs">{detailJob.external_id}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Bron</span><span className="capitalize">{detailJob.source || '—'}</span></div>
                    {detailJob.date_imported && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Geïmporteerd op</span><span>{format(new Date(detailJob.date_imported), 'd MMM yyyy HH:mm', { locale: nl })}</span></div>
                    )}
                    {detailJob.url && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Originele URL</span>
                        <a href={detailJob.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-xs">
                          Openen <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Action buttons */}
                <div className="flex gap-2 pb-4">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setSelectedIds(new Set([detailJob.id]));
                      setDetailJob(null);
                      setConvertOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" /> Toevoegen aan vacatures
                  </Button>
                  {detailJob.url && (
                    <Button variant="outline" asChild>
                      <a href={detailJob.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" /> Website
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Vacaturebank;
