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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TagInput from '@/components/ui/tag-input';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Download, ExternalLink, Globe, Building2, Briefcase, MapPin, Loader2, Plus, ChevronDown, X, DollarSign, Clock, Users, Tag, GraduationCap, Shield, Mail, User, Linkedin, Check, ChevronsUpDown, Rss, Play, Pause, Trash2 } from 'lucide-react';
import { format, subDays, subMonths } from 'date-fns';
import { nl } from 'date-fns/locale';
import { LINKEDIN_INDUSTRIES, LINKEDIN_INDUSTRIES_FEATURED } from '@/lib/linkedin-industries';

const ATS_OPTIONS = [
  'adp','applicantpro','ashby','bamboohr','breezy','careerplug','comeet','csod',
  'dayforce','dover','eightfold','firststage','freshteam','gem','gohire','greenhouse',
  'hibob','hirebridge','hirehive','hireology','hiringthing','icims','isolved','jazzhr',
  'jobvite','join.com','kula','lever.co','manatal','oraclecloud','pageup','paradox',
  'paycom','paycor','paylocity','personio','phenompeople','pinpoint','polymer',
  'recruitee','recooty','rippling','rival','smartrecruiters','successfactors','taleo',
  'teamtailor','trakstar','trinet','ultipro','werecruit','workable','workday','zoho',
];

const TAXONOMY_OPTIONS = [
  'Technology','Healthcare','Management & Leadership','Finance & Accounting',
  'Human Resources','Sales','Marketing','Customer Service & Support','Education',
  'Legal','Engineering','Science & Research','Trades','Construction','Manufacturing',
  'Logistics','Creative & Media','Hospitality','Environmental & Sustainability',
  'Retail','Data & Analytics','Software','Energy','Agriculture','Social Services',
  'Administrative','Government & Public Sector','Art & Design','Food & Beverage',
  'Transportation','Consulting','Sports & Recreation','Security & Safety',
];

const WORK_ARRANGEMENTS = ['On-site', 'Hybrid', 'Remote OK', 'Remote Solely'];

const EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Fulltime' },
  { value: 'PART_TIME', label: 'Parttime' },
  { value: 'CONTRACTOR', label: 'Contractor' },
  { value: 'TEMPORARY', label: 'Tijdelijk' },
  { value: 'INTERN', label: 'Stage' },
  { value: 'VOLUNTEER', label: 'Vrijwilliger' },
  { value: 'PER_DIEM', label: 'Per diem' },
  { value: 'OTHER', label: 'Overig' },
];

const EXPERIENCE_LEVELS = [
  { value: '0-2', label: '0-2 jaar' },
  { value: '2-5', label: '2-5 jaar' },
  { value: '5-10', label: '5-10 jaar' },
  { value: '10+', label: '10+ jaar' },
];

const LINKEDIN_DATE_POSTED = [
  { value: 'today', label: 'Vandaag' },
  { value: 'past_week', label: 'Afgelopen week' },
  { value: 'past_month', label: 'Afgelopen maand' },
  { value: 'all', label: 'Alles' },
];

const COMPANY_SIZE_OPTIONS = [
  { value: '1-10', label: '1-10', gte: 1, lte: 10 },
  { value: '11-50', label: '11-50', gte: 11, lte: 50 },
  { value: '51-200', label: '51-200', gte: 51, lte: 200 },
  { value: '201-500', label: '201-500', gte: 201, lte: 500 },
  { value: '501-1000', label: '501-1000', gte: 501, lte: 1000 },
  { value: '1001-5000', label: '1001-5000', gte: 1001, lte: 5000 },
  { value: '5001-10000', label: '5001-10000', gte: 5001, lte: 10000 },
  { value: '10001+', label: '10001+', gte: 10001, lte: undefined },
];

const LINKEDIN_EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Fulltime' },
  { value: 'PART_TIME', label: 'Parttime' },
  { value: 'CONTRACTOR', label: 'Contractor' },
  { value: 'TEMPORARY', label: 'Tijdelijk' },
  { value: 'INTERN', label: 'Stage' },
  { value: 'VOLUNTEER', label: 'Vrijwilliger' },
  { value: 'PER_DIEM', label: 'Per diem' },
  { value: 'OTHER', label: 'Overig' },
];

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

  // LinkedIn import state
  const [liKeywords, setLiKeywords] = useState('');
  const [liLocations, setLiLocations] = useState<string[]>([]);
  const [liIndustries, setLiIndustries] = useState<string[]>([]);
  const [liIndustryOpen, setLiIndustryOpen] = useState(false);
  const [liCompanySizes, setLiCompanySizes] = useState<string[]>([]);
  const [liEmploymentType, setLiEmploymentType] = useState<string[]>([]);
  const [liDatePosted, setLiDatePosted] = useState('past_week');
  const [liRemoveAgency, setLiRemoveAgency] = useState(false);
  const [liIncludeAi, setLiIncludeAi] = useState(true);
  const [liLimit, setLiLimit] = useState('100');
  const [liDescriptionSearch, setLiDescriptionSearch] = useState<string[]>([]);
  const [liOrgSearch, setLiOrgSearch] = useState<string[]>([]);
  const [importTab, setImportTab] = useState('career-sites');

  // Feed config state
  const [feedsOpen, setFeedsOpen] = useState(false);
  const [feedFormOpen, setFeedFormOpen] = useState(false);
  const [feedName, setFeedName] = useState('');
  const [feedSchedule, setFeedSchedule] = useState('daily');
  const [feedSourceType, setFeedSourceType] = useState('career_site');

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

  // Feed configs
  const { data: feedConfigs = [], refetch: refetchFeeds } = useQuery({
    queryKey: ['job-feed-configs', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('job_feed_configs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!organizationId,
  });

  const createFeedMutation = useMutation({
    mutationFn: async () => {
      if (!feedName.trim()) throw new Error('Geef de feed een naam');

      // Collect current filters based on source type
      const filtersConfig: Record<string, unknown> = {};
      if (feedSourceType === 'career_site') {
        filtersConfig.timeRange = importTimeRange;
        filtersConfig.limit = parseInt(importLimit) || 500;
        if (importTitleSearch.length) filtersConfig.titleSearch = importTitleSearch;
        if (importLocationSearch.length) filtersConfig.locationSearch = importLocationSearch;
        if (importAts.length) filtersConfig.ats = importAts;
        if (importTaxonomy.length) filtersConfig.aiTaxonomiesFilter = importTaxonomy;
        if (importWorkArr.length) filtersConfig.aiWorkArrangementFilter = importWorkArr;
        if (importEmploymentType.length) filtersConfig.aiEmploymentTypeFilter = importEmploymentType;
        if (importRemoveAgency) filtersConfig.removeAgency = true;
      } else {
        filtersConfig.limit = parseInt(liLimit) || 500;
        if (liKeywords.trim()) filtersConfig.keywords = liKeywords.trim();
        if (liLocations.length) filtersConfig.locations = liLocations;
        if (liIndustries.length) filtersConfig.linkedinIndustries = liIndustries;
        if (liEmploymentType.length) filtersConfig.employmentTypeFilter = liEmploymentType;
        if (liRemoveAgency) filtersConfig.removeAgency = true;
        if (liCompanySizes.length) {
          const sizes = liCompanySizes.map(v => COMPANY_SIZE_OPTIONS.find(o => o.value === v)).filter(Boolean);
          filtersConfig.organizationEmployeesGte = Math.min(...sizes.map(s => s!.gte));
          const maxLte = sizes.some(s => !s!.lte) ? undefined : Math.max(...sizes.map(s => s!.lte!));
          if (maxLte) filtersConfig.organizationEmployeesLte = maxLte;
        }
      }

      const { error } = await (supabase as any).from('job_feed_configs').insert({
        organization_id: organizationId,
        name: feedName.trim(),
        schedule: feedSchedule,
        source_type: feedSourceType,
        filters_config: filtersConfig,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feed aangemaakt');
      refetchFeeds();
      setFeedFormOpen(false);
      setFeedName('');
    },
    onError: (e: any) => toast.error(e.message || 'Fout bij aanmaken feed'),
  });

  const toggleFeedMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('job_feed_configs')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => refetchFeeds(),
    onError: (e: any) => toast.error(e.message),
  });

  const deleteFeedMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('job_feed_configs')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feed verwijderd');
      refetchFeeds();
    },
    onError: (e: any) => toast.error(e.message),
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
      if (importAts.length) body.ats = importAts;
      if (importAtsExclusion.length) body.atsExclusionFilter = importAtsExclusion;
      if (importTaxonomy.length) body.aiTaxonomiesFilter = importTaxonomy;
      if (importTaxonomyPrimary.length) body.aiTaxonomiesPrimaryFilter = importTaxonomyPrimary;
      if (importTaxonomyExclusion.length) body.aiTaxonomiesExclusionFilter = importTaxonomyExclusion;
      if (importWorkArr.length) body.aiWorkArrangementFilter = importWorkArr;
      if (importEmploymentType.length) body.aiEmploymentTypeFilter = importEmploymentType;
      if (importExperienceLevel.length) body.aiExperienceLevelFilter = importExperienceLevel;
      if (importHasSalary) body.aiHasSalary = true;
      if (importVisaSponsorship) body.aiVisaSponsorshipFilter = true;
      if (importLinkedInIndustry.length) body.liIndustryFilter = importLinkedInIndustry;
      if (importMinEmployees) body.liOrganizationEmployeesGte = parseInt(importMinEmployees);
      if (importMaxEmployees) body.liOrganizationEmployeesLte = parseInt(importMaxEmployees);
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

  // LinkedIn import mutation
  const linkedinMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        limit: parseInt(liLimit) || 100,
        includeAi: liIncludeAi,
        includeLinkedIn: true,
      };

      if (liKeywords.trim()) body.keywords = liKeywords.trim();
      if (liLocations.length) body.locations = liLocations;
      if (liIndustries.length) body.linkedinIndustries = liIndustries;
      if (liEmploymentType.length) body.employmentTypeFilter = liEmploymentType;
      if (liRemoveAgency) body.removeAgency = true;
      if (liDescriptionSearch.length) body.descriptionSearch = liDescriptionSearch;
      if (liOrgSearch.length) body.organizationSearch = liOrgSearch;

      // Company size → gte/lte
      if (liCompanySizes.length) {
        const sizes = liCompanySizes.map(v => COMPANY_SIZE_OPTIONS.find(o => o.value === v)).filter(Boolean);
        const minGte = Math.min(...sizes.map(s => s!.gte));
        const maxLte = sizes.some(s => !s!.lte) ? undefined : Math.max(...sizes.map(s => s!.lte!));
        body.organizationEmployeesGte = minGte;
        if (maxLte) body.organizationEmployeesLte = maxLte;
      }

      // Date posted → datePostedAfter
      if (liDatePosted && liDatePosted !== 'all') {
        const now = new Date();
        let afterDate: Date;
        switch (liDatePosted) {
          case 'today': afterDate = subDays(now, 1); break;
          case 'past_week': afterDate = subDays(now, 7); break;
          case 'past_month': afterDate = subMonths(now, 1); break;
          default: afterDate = subDays(now, 7);
        }
        body.datePostedAfter = afterDate.toISOString();
      }

      const { data, error } = await supabase.functions.invoke('linkedin-job-search', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.total} LinkedIn vacatures opgehaald, ${data.new_count} nieuw`);
      queryClient.invalidateQueries({ queryKey: ['job-listings'] });
      setImportOpen(false);
    },
    onError: (e: any) => toast.error(e.message || 'LinkedIn import mislukt'),
  });

  // Convert to vacancies mutation
  const convertMutation = useMutation({
    mutationFn: async () => {
      const selectedJobs = jobs.filter(j => selectedIds.has(j.id));
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

  const selectedJobsList = useMemo(() => jobs.filter(j => selectedIds.has(j.id)), [jobs, selectedIds]);
  const unmatchedJobs = useMemo(() => {
    if (!companies) return selectedJobsList;
    const companyNames = new Set((companies ?? []).map(c => c.name.toLowerCase()));
    return selectedJobsList.filter(j => !j.organization_name || !companyNames.has(j.organization_name.toLowerCase()));
  }, [selectedJobsList, companies]);

  const toggleArray = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];

  // Helper for detail view field display
  const DetailField = ({ label, value }: { label: string; value: React.ReactNode }) => {
    if (!value) return null;
    return (
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="text-right">{value}</span>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vacaturebank</h1>
          <p className="text-muted-foreground text-sm">Externe vacatures van career sites en LinkedIn</p>
        </div>
        <div className="flex gap-2">
          {/* Feeds dialog */}
          <Dialog open={feedsOpen} onOpenChange={setFeedsOpen}>
            <Button variant="outline" onClick={() => setFeedsOpen(true)}>
              <Rss className="h-4 w-4 mr-2" />
              Feeds
              {feedConfigs.filter((f: any) => f.is_active).length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {feedConfigs.filter((f: any) => f.is_active).length}
                </Badge>
              )}
            </Button>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Automatische feeds</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Feeds importeren automatisch vacatures op een vast schema.
                </p>

                {feedConfigs.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    Nog geen feeds ingesteld.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {feedConfigs.map((feed: any) => (
                      <div key={feed.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{feed.name}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {feed.source_type === 'linkedin' ? 'LinkedIn' : 'Career Sites'}
                            </Badge>
                            <Badge variant={feed.is_active ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                              {feed.schedule}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {feed.last_run_at
                              ? `Laatste run: ${format(new Date(feed.last_run_at), 'd MMM HH:mm', { locale: nl })} — ${feed.last_run_job_count} jobs (${feed.last_run_status})`
                              : 'Nog niet gedraaid'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleFeedMutation.mutate({ id: feed.id, is_active: !feed.is_active })}
                          >
                            {feed.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => deleteFeedMutation.mutate(feed.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Separator />

                {feedFormOpen ? (
                  <div className="space-y-3">
                    <div>
                      <Label>Naam</Label>
                      <Input value={feedName} onChange={e => setFeedName(e.target.value)} placeholder="bijv. Dagelijks productie Brabant" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Bron</Label>
                        <Select value={feedSourceType} onValueChange={setFeedSourceType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="career_site">Career Sites</SelectItem>
                            <SelectItem value="linkedin">LinkedIn</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Schema</Label>
                        <Select value={feedSchedule} onValueChange={setFeedSchedule}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hourly">Uurlijks</SelectItem>
                            <SelectItem value="daily">Dagelijks</SelectItem>
                            <SelectItem value="weekly">Wekelijks</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      De huidige filters uit het {feedSourceType === 'linkedin' ? 'LinkedIn' : 'Career Sites'} import-formulier worden opgeslagen.
                      Stel eerst je filters in via "Importeren" en kom dan hier terug.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setFeedFormOpen(false)}>Annuleren</Button>
                      <Button size="sm" onClick={() => createFeedMutation.mutate()} disabled={createFeedMutation.isPending}>
                        {createFeedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Feed aanmaken'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setFeedFormOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Nieuwe feed
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Sheet open={importOpen} onOpenChange={setImportOpen}>
          <SheetTrigger asChild>
            <Button><Download className="h-4 w-4 mr-2" /> Importeren</Button>
          </SheetTrigger>
          <SheetContent className="overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>Vacatures importeren</SheetTitle>
            </SheetHeader>
            <Tabs value={importTab} onValueChange={setImportTab} className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="career-sites" className="gap-1.5"><Globe className="h-3.5 w-3.5" /> Career Sites</TabsTrigger>
                <TabsTrigger value="linkedin" className="gap-1.5"><Linkedin className="h-3.5 w-3.5" /> LinkedIn</TabsTrigger>
              </TabsList>

              <TabsContent value="career-sites">
            <div className="mt-4 space-y-5">
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
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
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
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
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
                      key={t.value}
                      variant={importEmploymentType.includes(t.value) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setImportEmploymentType(prev => toggleArray(prev, t.value))}
                    >
                      {t.label}
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
                      key={l.value}
                      variant={importExperienceLevel.includes(l.value) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setImportExperienceLevel(prev => toggleArray(prev, l.value))}
                    >
                      {l.label}
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
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
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
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
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
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
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
                  <><Download className="h-4 w-4 mr-2" /> Career Sites importeren</>
                )}
              </Button>
            </div>
              </TabsContent>

              <TabsContent value="linkedin">
                <div className="mt-4 space-y-5">
                  {/* Keywords */}
                  <div>
                    <Label>Zoektermen</Label>
                    <Input
                      value={liKeywords}
                      onChange={e => setLiKeywords(e.target.value)}
                      placeholder="bijv. Productiemedewerker, Magazijnmedewerker"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Gebruik :* voor prefix matching (bijv. Soft:*)</p>
                  </div>

                  {/* Locations */}
                  <div>
                    <Label>Locaties</Label>
                    <TagInput
                      value={liLocations}
                      onChange={setLiLocations}
                      placeholder="bijv. Eindhoven, Netherlands + Enter"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Formaat: City, Country (in het Engels)</p>
                  </div>

                  {/* Date posted */}
                  <div>
                    <Label>Geplaatst sinds</Label>
                    <Select value={liDatePosted} onValueChange={setLiDatePosted}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LINKEDIN_DATE_POSTED.map(d => (
                          <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Industry combobox */}
                  <div>
                    <Label className="mb-2 block">Industrie (LinkedIn)</Label>
                    <Popover open={liIndustryOpen} onOpenChange={setLiIndustryOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                          {liIndustries.length
                            ? `${liIndustries.length} industrie${liIndustries.length !== 1 ? 'ën' : ''} geselecteerd`
                            : 'Selecteer industrieën...'}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[350px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Zoek industrie..." />
                          <CommandList>
                            <CommandEmpty>Geen industrie gevonden.</CommandEmpty>
                            <CommandGroup heading="Aanbevolen voor uitzendwerk">
                              {LINKEDIN_INDUSTRIES_FEATURED.map(ind => (
                                <CommandItem
                                  key={ind}
                                  value={ind}
                                  onSelect={() => setLiIndustries(prev =>
                                    prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]
                                  )}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${liIndustries.includes(ind) ? 'opacity-100' : 'opacity-0'}`} />
                                  {ind}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                            <CommandGroup heading="Alle industrieën">
                              {LINKEDIN_INDUSTRIES.filter(i => !LINKEDIN_INDUSTRIES_FEATURED.includes(i)).map(ind => (
                                <CommandItem
                                  key={ind}
                                  value={ind}
                                  onSelect={() => setLiIndustries(prev =>
                                    prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]
                                  )}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${liIndustries.includes(ind) ? 'opacity-100' : 'opacity-0'}`} />
                                  {ind}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {liIndustries.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {liIndustries.map(ind => (
                          <Badge key={ind} variant="secondary" className="text-xs gap-1">
                            {ind}
                            <X className="h-3 w-3 cursor-pointer" onClick={() => setLiIndustries(prev => prev.filter(i => i !== ind))} />
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Company size */}
                  <div>
                    <Label className="mb-2 block">Bedrijfsgrootte</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {COMPANY_SIZE_OPTIONS.map(s => (
                        <Badge
                          key={s.value}
                          variant={liCompanySizes.includes(s.value) ? 'default' : 'outline'}
                          className="cursor-pointer text-xs"
                          onClick={() => setLiCompanySizes(prev => toggleArray(prev, s.value))}
                        >
                          {s.label}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Employment type */}
                  <div>
                    <Label className="mb-2 block">Dienstverband</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {LINKEDIN_EMPLOYMENT_TYPES.map(t => (
                        <Badge
                          key={t.value}
                          variant={liEmploymentType.includes(t.value) ? 'default' : 'outline'}
                          className="cursor-pointer text-xs"
                          onClick={() => setLiEmploymentType(prev => toggleArray(prev, t.value))}
                        >
                          {t.label}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Uitzendbureaus uitsluiten</Label>
                      <Switch checked={liRemoveAgency} onCheckedChange={setLiRemoveAgency} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">AI verrijking</Label>
                      <Switch checked={liIncludeAi} onCheckedChange={setLiIncludeAi} />
                    </div>
                  </div>

                  {/* Max results */}
                  <div>
                    <Label>Max resultaten</Label>
                    <Select value={liLimit} onValueChange={setLiLimit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="250">250</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                        <SelectItem value="1000">1.000</SelectItem>
                        <SelectItem value="2500">2.500</SelectItem>
                        <SelectItem value="5000">5.000</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  {/* Advanced LinkedIn filters */}
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1 w-full justify-between text-muted-foreground">
                        Geavanceerde filters
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-3">
                      <div>
                        <Label>Zoek in beschrijving</Label>
                        <TagInput value={liDescriptionSearch} onChange={setLiDescriptionSearch} placeholder="Keywords in beschrijving..." />
                        <p className="text-[10px] text-muted-foreground mt-1">Zeer intensief — max 3-5 termen, combineer met zoektermen</p>
                      </div>
                      <div>
                        <Label>Zoek op bedrijfsnaam</Label>
                        <TagInput value={liOrgSearch} onChange={setLiOrgSearch} placeholder="bijv. ASML, Philips + Enter" />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Button
                    onClick={() => linkedinMutation.mutate()}
                    disabled={linkedinMutation.isPending}
                    className="w-full"
                  >
                    {linkedinMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> LinkedIn importeren...</>
                    ) : (
                      <><Linkedin className="h-4 w-4 mr-2" /> LinkedIn importeren</>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </SheetContent>
        </Sheet>
        </div>
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
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm text-primary">✓ Alle vacatures worden automatisch aan de juiste opdrachtgever gekoppeld.</p>
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
                  {detailJob.ai_employment_type?.map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}
                  {!detailJob.ai_employment_type?.length && detailJob.employment_type?.map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}
                  {detailJob.ai_experience_level && <Badge variant="outline">Ervaring: {detailJob.ai_experience_level}</Badge>}
                  {detailJob.remote_derived && <Badge variant="secondary">Remote</Badge>}
                  {detailJob.ai_visa_sponsorship && <Badge variant="secondary"><Shield className="h-3 w-3 mr-1" />Visum</Badge>}
                  {detailJob.source && <Badge variant="outline" className="capitalize">{detailJob.source}</Badge>}
                  {detailJob.source_type && <Badge variant="outline">{detailJob.source_type}</Badge>}
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

                {/* AI Summary */}
                {(detailJob.ai_core_responsibilities || detailJob.ai_requirements_summary) && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">AI Samenvatting</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {detailJob.ai_core_responsibilities && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Verantwoordelijkheden</p>
                          <p className="text-foreground">{detailJob.ai_core_responsibilities}</p>
                        </div>
                      )}
                      {detailJob.ai_requirements_summary && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Vereisten</p>
                          <p className="text-foreground">{detailJob.ai_requirements_summary}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Education */}
                {detailJob.ai_education_requirements?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Opleidingsvereisten</CardTitle></CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                      {detailJob.ai_education_requirements.map((e: string) => (
                        <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                      ))}
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

                {/* Benefits */}
                {detailJob.ai_benefits?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Benefits</CardTitle></CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                      {detailJob.ai_benefits.map((b: string) => (
                        <Badge key={b} variant="outline" className="text-xs">{b}</Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Keywords & Taxonomies */}
                {(detailJob.ai_taxonomies?.length > 0 || detailJob.ai_keywords?.length > 0) && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Branches & Keywords</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {detailJob.ai_taxonomies?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {detailJob.ai_taxonomies.map((t: string) => (
                            <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                      )}
                      {detailJob.ai_keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {detailJob.ai_keywords.map((k: string) => (
                            <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* AI Details */}
                {(detailJob.ai_working_hours || detailJob.ai_hiring_manager_name || detailJob.ai_hiring_manager_email) && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">AI Details</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <DetailField label="Werkuren" value={detailJob.ai_working_hours ? `${detailJob.ai_working_hours} uur/week` : null} />
                      <DetailField label="Hiring Manager" value={detailJob.ai_hiring_manager_name} />
                      {detailJob.ai_hiring_manager_email && (
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Email</span>
                          <a href={`mailto:${detailJob.ai_hiring_manager_email}`} className="text-primary hover:underline flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {detailJob.ai_hiring_manager_email}
                          </a>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Company info + LinkedIn */}
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
                    <DetailField label="Website" value={
                      detailJob.organization_url ? (
                        <a href={detailJob.organization_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[200px]">
                          {detailJob.organization_url}
                        </a>
                      ) : null
                    } />
                    <DetailField label="Domein" value={detailJob.domain_derived} />
                    <DetailField label="Industrie (LI)" value={detailJob.linkedin_org_industry} />
                    <DetailField label="Werknemers (LI)" value={detailJob.linkedin_org_employees?.toLocaleString()} />
                    <DetailField label="Bedrijfsgrootte" value={detailJob.linkedin_org_size} />
                    <DetailField label="Type" value={detailJob.linkedin_org_type} />
                    <DetailField label="Hoofdkantoor" value={detailJob.linkedin_org_headquarters} />
                    <DetailField label="Opgericht" value={detailJob.linkedin_org_founded_date} />
                    <DetailField label="Volgers (LI)" value={detailJob.linkedin_org_followers?.toLocaleString()} />
                    {detailJob.linkedin_org_recruitment_agency && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Uitzendbureau</span>
                        <Badge variant="destructive" className="text-[10px]">Ja</Badge>
                      </div>
                    )}
                    {detailJob.linkedin_org_url && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">LinkedIn</span>
                        <a href={detailJob.linkedin_org_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
                          Profiel openen <ExternalLink className="h-3 w-3 inline" />
                        </a>
                      </div>
                    )}
                    {detailJob.linkedin_org_description && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground mb-1">Bedrijfsomschrijving (LinkedIn)</p>
                        <p className="text-xs text-foreground line-clamp-4">{detailJob.linkedin_org_description}</p>
                      </div>
                    )}
                    {detailJob.linkedin_org_specialties?.length > 0 && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground mb-1">Specialiteiten</p>
                        <div className="flex flex-wrap gap-1">
                          {detailJob.linkedin_org_specialties.map((s: string) => (
                            <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

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
                    <DetailField label="External ID" value={<span className="font-mono text-xs">{detailJob.external_id}</span>} />
                    <DetailField label="Bron" value={<span className="capitalize">{detailJob.source || '—'}</span>} />
                    <DetailField label="Bron type" value={detailJob.source_type} />
                    {detailJob.date_imported && (
                      <DetailField label="Geïmporteerd op" value={format(new Date(detailJob.date_imported), 'd MMM yyyy HH:mm', { locale: nl })} />
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
