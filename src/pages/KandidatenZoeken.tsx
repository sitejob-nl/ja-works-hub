import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { Search, Loader2, ExternalLink, UserSearch, Globe, Bookmark, UserPlus, ChevronDown, Eye, Calendar, Link } from 'lucide-react';
import { formatDate } from '@/lib/format';
import TagInput from '@/components/ui/tag-input';

const COUNTRY_OPTIONS = [
  { code: 'NL', label: 'Nederland' },
  { code: 'DE', label: 'Duitsland' },
  { code: 'BE', label: 'België' },
  { code: 'PL', label: 'Polen' },
  { code: 'RO', label: 'Roemenië' },
  { code: 'BG', label: 'Bulgarije' },
  { code: 'GB', label: 'Verenigd Koninkrijk' },
  { code: 'US', label: 'Verenigde Staten' },
];

const INDUSTRY_OPTIONS = [
  { value: '', label: 'Alle branches' },
  { value: 'technology', label: 'Technology / IT' },
  { value: 'manufacturing', label: 'Productie / Industrie' },
  { value: 'logistics', label: 'Logistiek / Transport' },
  { value: 'construction', label: 'Bouw' },
  { value: 'healthcare', label: 'Gezondheidszorg' },
  { value: 'agriculture', label: 'Agrarisch / Food' },
  { value: 'hospitality', label: 'Horeca' },
  { value: 'retail', label: 'Retail' },
  { value: 'finance', label: 'Finance' },
  { value: 'engineering', label: 'Engineering' },
];

interface ConvertDialogData {
  external_id: string;
  name: string;
  title: string;
  url: string;
  firstName: string;
  lastName: string;
}

function buildQuery(
  jobTitle: string,
  skills: string[],
  certifications: string[],
  city: string,
  industry: string,
  experienceYears: string,
): string {
  const parts: string[] = [];
  if (jobTitle.trim()) parts.push(jobTitle.trim());
  if (skills.length > 0) parts.push(`met ${skills.join(', ')} ervaring`);
  if (city.trim()) parts.push(`in ${city.trim()}`);
  if (industry) {
    const label = INDUSTRY_OPTIONS.find((i) => i.value === industry)?.label;
    if (label) parts.push(label);
  }
  if (certifications.length > 0) parts.push(`met ${certifications.join(', ')} certificering`);
  if (experienceYears.trim()) parts.push(`minimaal ${experienceYears} jaar ervaring`);
  return parts.join(' ');
}

const KandidatenZoeken = () => {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();

  // Structured fields
  const [jobTitle, setJobTitle] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [industry, setIndustry] = useState('');
  const [experienceYears, setExperienceYears] = useState('');

  // Advanced: manual query override
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [useManualQuery, setUseManualQuery] = useState(false);

  // Options
  const [userLocation, setUserLocation] = useState('NL');
  const [numResults, setNumResults] = useState('20');
  const [includeText, setIncludeText] = useState(false);
  const [maxCharacters, setMaxCharacters] = useState('2000');
  const [highlightsQuery, setHighlightsQuery] = useState('');
  const [numSentences, setNumSentences] = useState('3');
  const [highlightsPerUrl, setHighlightsPerUrl] = useState('3');
  const [convertDialog, setConvertDialog] = useState<ConvertDialogData | null>(null);
  const [detailResult, setDetailResult] = useState<Record<string, unknown> | null>(null);
  const autoSearchDone = useRef(false);

  // Build query from structured fields
  const generatedQuery = useMemo(
    () => buildQuery(jobTitle, skills, certifications, city, industry, experienceYears),
    [jobTitle, skills, certifications, city, industry, experienceYears],
  );

  // Keep manual query in sync when not overriding
  useEffect(() => {
    if (!useManualQuery) {
      setManualQuery(generatedQuery);
    }
  }, [generatedQuery, useManualQuery]);

  const effectiveQuery = useManualQuery ? manualQuery : generatedQuery;

  // Saved results
  const { data: savedResults } = useQuery({
    queryKey: ['people-search-results', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('people_search_results')
        .select('*')
        .eq('organization_id', organizationId)
        .order('date_imported', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  // Auto-search when navigated from vacancy page with query param
  useEffect(() => {
    const urlQuery = searchParams.get('query');
    if (urlQuery && !autoSearchDone.current) {
      autoSearchDone.current = true;
      setManualQuery(urlQuery);
      setUseManualQuery(true);
      setShowAdvanced(true);
      setSearchParams({}, { replace: true });
      setTimeout(() => searchMutation.mutate(), 100);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const searchMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        query: effectiveQuery,
        userLocation,
        numResults: parseInt(numResults),
        includeText,
        maxCharacters: parseInt(maxCharacters),
      };
      if (highlightsQuery.trim()) {
        body.highlightsQuery = highlightsQuery;
        body.numSentences = parseInt(numSentences);
        body.highlightsPerUrl = parseInt(highlightsPerUrl);
      }

      const { data, error } = await supabase.functions.invoke('exa-people-search', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const filterMsg = data.filtered_count > 0
        ? `, ${data.filtered_count} vacatures gefilterd`
        : '';
      toast.success(`${data.total} kandidaten gevonden${filterMsg}, ${data.new_count} opgeslagen`);
      queryClient.invalidateQueries({ queryKey: ['people-search-results'] });
    },
    onError: (err: Error) => {
      toast.error(`Zoekfout: ${err.message}`);
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (data: ConvertDialogData) => {
      const { data: candidate, error } = await supabase
        .from('candidates')
        .insert({
          organization_id: organizationId,
          first_name: data.firstName,
          last_name: data.lastName,
          source: 'Exa People Search',
          notes: [
            data.title && `Titel: ${data.title}`,
            data.url && `Profiel: ${data.url}`,
          ].filter(Boolean).join('\n'),
          external_id: data.external_id,
        })
        .select('id')
        .single();
      if (error) throw error;
      return candidate;
    },
    onSuccess: (candidate) => {
      toast.success('Kandidaat aangemaakt');
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      setConvertDialog(null);
      navigate(`/kandidaten/${candidate.id}`);
    },
    onError: (err: Error) => {
      toast.error(`Fout: ${err.message}`);
    },
  });

  const openConvertDialog = (result: Record<string, unknown>) => {
    const fullName = (result.name as string) || '';
    const parts = fullName.split(' ').filter(Boolean);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    setConvertDialog({
      external_id: (result.external_id as string) || '',
      name: fullName,
      title: (result.title as string) || '',
      url: (result.url as string) || '',
      firstName,
      lastName,
    });
  };

  const liveResults = searchMutation.data?.results || [];
  const displayResults = liveResults.length > 0 ? liveResults : (savedResults || []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <UserSearch className="h-6 w-6" />
          Kandidaten zoeken
        </h1>
        <p className="text-muted-foreground mt-1">
          Zoek professionals met AI-powered search · <span className="text-xs">vacature-links worden automatisch gefilterd</span>
        </p>
      </div>

      {/* Search form */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Main structured fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Functietitel</Label>
              <Input
                placeholder="bijv. Lasser, Software engineer, Heftruck chauffeur"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Stad / Regio</Label>
              <Input
                placeholder="bijv. Rotterdam, Noord-Holland"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Vaardigheden</Label>
              <TagInput
                value={skills}
                onChange={setSkills}
                placeholder="Typ vaardigheid en druk Enter..."
              />
            </div>
            <div className="space-y-2">
              <Label>Certificeringen</Label>
              <TagInput
                value={certifications}
                onChange={setCertifications}
                placeholder="Typ certificering en druk Enter..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Branche</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger><SelectValue placeholder="Alle branches" /></SelectTrigger>
                <SelectContent>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || '_all'} value={opt.value || '_all'}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Min. jaren ervaring</Label>
              <Input
                type="number"
                min="0"
                placeholder="bijv. 3"
                value={experienceYears}
                onChange={(e) => setExperienceYears(e.target.value)}
              />
            </div>
          </div>

          {/* Options row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label>Land</Label>
              <Select value={userLocation} onValueChange={setUserLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Max resultaten</Label>
              <Select value={numResults} onValueChange={setNumResults}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['10', '20', '25', '50', '100'].map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pb-1">
              <Switch checked={includeText} onCheckedChange={setIncludeText} />
              <Label className="text-sm">Profieltekst ophalen</Label>
            </div>

            {includeText && (
              <div className="space-y-2">
                <Label>Max tekens per profiel</Label>
                <Input
                  type="number"
                  min={100}
                  max={10000}
                  value={maxCharacters}
                  onChange={(e) => setMaxCharacters(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Highlights settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Highlights query</Label>
              <Input
                placeholder="bijv. machine learning"
                value={highlightsQuery}
                onChange={(e) => setHighlightsQuery(e.target.value)}
              />
            </div>
            {highlightsQuery.trim() && (
              <>
                <div className="space-y-2">
                  <Label>Zinnen per highlight</Label>
                  <Select value={numSentences} onValueChange={setNumSentences}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['1', '2', '3', '5', '10'].map((n) => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Highlights per resultaat</Label>
                  <Select value={highlightsPerUrl} onValueChange={setHighlightsPerUrl}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['1', '2', '3', '5', '10'].map((n) => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          {/* Advanced: show generated query */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                <Eye className="h-4 w-4" />
                Toon query
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              <div className="flex items-center gap-2">
                <Switch checked={useManualQuery} onCheckedChange={setUseManualQuery} />
                <Label className="text-sm">Handmatig aanpassen</Label>
              </div>
              <Textarea
                value={useManualQuery ? manualQuery : generatedQuery}
                onChange={(e) => {
                  setUseManualQuery(true);
                  setManualQuery(e.target.value);
                }}
                placeholder="De samengestelde zoekquery..."
                className="min-h-[60px] text-sm"
                readOnly={!useManualQuery}
              />
              {useManualQuery && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => {
                    setUseManualQuery(false);
                    setManualQuery(generatedQuery);
                  }}
                >
                  Reset naar velden
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Button
            onClick={() => searchMutation.mutate()}
            disabled={!effectiveQuery.trim() || searchMutation.isPending}
          >
            {searchMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Zoeken...</>
            ) : (
              <><Search className="h-4 w-4 mr-2" /> Zoeken</>
            )}
          </Button>

          {searchMutation.data?.cost && (
            <p className="text-xs text-muted-foreground">
              Kosten: ${searchMutation.data.cost.total?.toFixed(3) ?? '?'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="flex gap-4">
        <Badge variant="secondary" className="text-sm">
          <Globe className="h-3 w-3 mr-1" />
          {displayResults.length} resultaten
        </Badge>
        {savedResults && (
          <Badge variant="outline" className="text-sm">
            <Bookmark className="h-3 w-3 mr-1" />
            {savedResults.length} opgeslagen
          </Badge>
        )}
      </div>

      {/* Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayResults.map((result: Record<string, unknown>, i: number) => (
          <Card
            key={(result.external_id as string) || i}
            className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setDetailResult(result)}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                {result.image_url ? (
                  <img
                    src={result.image_url as string}
                    alt=""
                    className="h-12 w-12 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <UserSearch className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {(result.name as string) || 'Onbekend'}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {(result.title as string) || ''}
                  </p>
                </div>
              </div>

              {result.highlights && (result.highlights as string[]).length > 0 && (
                <div className="space-y-1">
                  {(result.highlights as string[]).slice(0, 2).map((h, j) => (
                    <p key={j} className="text-xs text-muted-foreground bg-muted/50 rounded p-2 line-clamp-2">
                      {h}
                    </p>
                  ))}
                </div>
              )}

              {result.text_content && (
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {result.text_content as string}
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                {result.url && (
                  <a
                    href={result.url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Profiel
                  </a>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs h-7"
                  onClick={(e) => { e.stopPropagation(); openConvertDialog(result); }}
                >
                  <UserPlus className="h-3 w-3 mr-1" />
                  Kandidaat maken
                </Button>
              </div>

              {result.search_query && (
                <Badge variant="outline" className="text-[10px]">
                  {result.search_query as string}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {displayResults.length === 0 && !searchMutation.isPending && (
        <div className="text-center py-12 text-muted-foreground">
          <UserSearch className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Voer een zoekopdracht in om kandidaten te vinden</p>
        </div>
      )}

      {/* Detail Slide-Over */}
      <Sheet open={!!detailResult} onOpenChange={(open) => { if (!open) setDetailResult(null); }}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3">
              {detailResult?.image_url ? (
                <img src={detailResult.image_url as string} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <UserSearch className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <span>{(detailResult?.name as string) || 'Onbekend'}</span>
            </SheetTitle>
          </SheetHeader>
          {detailResult && (
            <div className="space-y-6 mt-6">
              {/* Title / Headline */}
              {detailResult.title && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Titel</p>
                  <p className="text-sm text-foreground">{detailResult.title as string}</p>
                </div>
              )}

              {/* Profile link */}
              {detailResult.url && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Profiel</p>
                  <a
                    href={detailResult.url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
                  >
                    <Link className="h-3.5 w-3.5 shrink-0" />
                    {detailResult.url as string}
                  </a>
                </div>
              )}

              <Separator />

              {/* Published date */}
              {detailResult.published_date && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Profiel bijgewerkt</p>
                  <p className="text-sm text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatDate(detailResult.published_date as string)}
                  </p>
                </div>
              )}

              {/* Search query */}
              {detailResult.search_query && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Gevonden met zoekopdracht</p>
                  <Badge variant="secondary">{detailResult.search_query as string}</Badge>
                </div>
              )}

              {/* Highlights */}
              {detailResult.highlights && (detailResult.highlights as string[]).length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Highlights</p>
                  <div className="space-y-2">
                    {(detailResult.highlights as string[]).map((h, j) => {
                      const scores = detailResult.highlight_scores as number[] | null;
                      const score = scores?.[j];
                      return (
                        <div key={j} className="bg-muted/50 rounded-md p-3 text-sm text-foreground">
                          <p>{h}</p>
                          {score != null && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Relevantie: {(score * 100).toFixed(0)}%
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Full text content */}
              {detailResult.text_content && (
                <div>
                  <Separator className="mb-4" />
                  <p className="text-sm font-medium text-muted-foreground mb-2">Profieltekst</p>
                  <div className="text-sm text-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-4 max-h-[400px] overflow-y-auto">
                    {detailResult.text_content as string}
                  </div>
                </div>
              )}

              <Separator />

              {/* Actions */}
              <div className="flex gap-2">
                {detailResult.url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detailResult.url as string} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      Open profiel
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => { openConvertDialog(detailResult); setDetailResult(null); }}
                >
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  Kandidaat maken
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>


      <Dialog open={!!convertDialog} onOpenChange={(open) => !open && setConvertDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Omzetten naar kandidaat</DialogTitle>
          </DialogHeader>
          {convertDialog && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {convertDialog.title}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Voornaam</Label>
                  <Input
                    value={convertDialog.firstName}
                    onChange={(e) => setConvertDialog({ ...convertDialog, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Achternaam</Label>
                  <Input
                    value={convertDialog.lastName}
                    onChange={(e) => setConvertDialog({ ...convertDialog, lastName: e.target.value })}
                  />
                </div>
              </div>
              {convertDialog.url && (
                <p className="text-xs text-muted-foreground">
                  LinkedIn: {convertDialog.url}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertDialog(null)}>
              Annuleren
            </Button>
            <Button
              onClick={() => convertDialog && convertMutation.mutate(convertDialog)}
              disabled={convertMutation.isPending || !convertDialog?.firstName || !convertDialog?.lastName}
            >
              {convertMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Aanmaken...</>
              ) : (
                <><UserPlus className="h-4 w-4 mr-2" /> Kandidaat aanmaken</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default KandidatenZoeken;
