import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Search, Download, ExternalLink, Globe, Building2, Briefcase, MapPin, Loader2 } from 'lucide-react';
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

const PAGE_SIZE = 25;

const Vacaturebank = () => {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  // Import sheet state
  const [importOpen, setImportOpen] = useState(false);
  const [importTimeRange, setImportTimeRange] = useState('7d');
  const [importLimit, setImportLimit] = useState('100');
  const [importLocation, setImportLocation] = useState('');
  const [importAts, setImportAts] = useState<string[]>([]);
  const [importTaxonomy, setImportTaxonomy] = useState<string[]>([]);
  const [importWorkArr, setImportWorkArr] = useState<string[]>([]);

  // Filter state
  const [search, setSearch] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterWorkArr, setFilterWorkArr] = useState('');
  const [filterTaxonomy, setFilterTaxonomy] = useState('');
  const [page, setPage] = useState(0);

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

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        timeRange: importTimeRange,
        limit: parseInt(importLimit) || 100,
      };
      if (importLocation.trim()) body.locationSearch = importLocation.split(',').map(s => s.trim());
      if (importAts.length) body.ats = importAts;
      if (importTaxonomy.length) body.aiTaxonomiesFilter = importTaxonomy;
      if (importWorkArr.length) body.aiWorkArrangementFilter = importWorkArr;

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
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Vacatures importeren</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-5">
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
                <Label>Max aantal vacatures</Label>
                <Input
                  type="number"
                  min={10}
                  max={5000}
                  value={importLimit}
                  onChange={e => setImportLimit(e.target.value)}
                />
              </div>

              <div>
                <Label>Locatie zoeken (kommagescheiden)</Label>
                <Input
                  placeholder="Netherlands, Germany, Belgium"
                  value={importLocation}
                  onChange={e => setImportLocation(e.target.value)}
                />
              </div>

              <div>
                <Label className="mb-2 block">ATS Platform</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ATS_OPTIONS.map(a => (
                    <Badge
                      key={a}
                      variant={importAts.includes(a) ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => setImportAts(prev => toggleArray(prev, a))}
                    >
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Branche / Taxonomie</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TAXONOMY_OPTIONS.map(t => (
                    <Badge
                      key={t}
                      variant={importTaxonomy.includes(t) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setImportTaxonomy(prev => toggleArray(prev, t))}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Werkarrangement</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WORK_ARRANGEMENTS.map(w => (
                    <Badge
                      key={w}
                      variant={importWorkArr.includes(w) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setImportWorkArr(prev => toggleArray(prev, w))}
                    >
                      {w}
                    </Badge>
                  ))}
                </div>
              </div>

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

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
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
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Laden...
                </TableCell>
              </TableRow>
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {jobs.length === 0
                    ? 'Nog geen vacatures geïmporteerd. Klik op "Importeren" om te beginnen.'
                    : 'Geen vacatures gevonden met deze filters.'}
                </TableCell>
              </TableRow>
            ) : (
              paged.map(job => (
                <TableRow key={job.id}>
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
                  <TableCell>
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
    </div>
  );
};

export default Vacaturebank;
