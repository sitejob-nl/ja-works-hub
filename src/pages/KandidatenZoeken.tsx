import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Search, Loader2, ExternalLink, UserSearch, Globe, Bookmark, UserPlus } from 'lucide-react';

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

interface ConvertDialogData {
  external_id: string;
  name: string;
  title: string;
  url: string;
  firstName: string;
  lastName: string;
}

const KandidatenZoeken = () => {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('query') || '');
  const [userLocation, setUserLocation] = useState('NL');
  const [numResults, setNumResults] = useState('10');
  const [includeText, setIncludeText] = useState(false);
  const [highlightsQuery, setHighlightsQuery] = useState('');
  const [convertDialog, setConvertDialog] = useState<ConvertDialogData | null>(null);
  const autoSearchDone = useRef(false);

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
      // Clear the search params to avoid re-triggering
      setSearchParams({}, { replace: true });
      // Trigger search on next tick after state is set
      setTimeout(() => searchMutation.mutate(), 100);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const searchMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        query,
        userLocation,
        numResults: parseInt(numResults),
        includeText,
      };
      if (highlightsQuery.trim()) body.highlightsQuery = highlightsQuery;

      const { data, error } = await supabase.functions.invoke('exa-people-search', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.total} resultaten gevonden, ${data.new_count} opgeslagen`);
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
          Zoek professionals met AI-powered natural language search
        </p>
      </div>

      {/* Search form */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label>Zoekquery (natural language)</Label>
            <Input
              placeholder="bijv. Senior software engineers met React ervaring in Amsterdam"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && query.trim() && searchMutation.mutate()}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                  {['10', '25', '50', '100'].map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Highlights query</Label>
              <Input
                placeholder="bijv. machine learning"
                value={highlightsQuery}
                onChange={(e) => setHighlightsQuery(e.target.value)}
              />
            </div>

            <div className="flex items-end gap-2">
              <div className="flex items-center gap-2">
                <Switch checked={includeText} onCheckedChange={setIncludeText} />
                <Label className="text-sm">Profieltekst</Label>
              </div>
            </div>
          </div>

          <Button
            onClick={() => searchMutation.mutate()}
            disabled={!query.trim() || searchMutation.isPending}
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
          <Card key={(result.external_id as string) || i} className="overflow-hidden">
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
                  >
                    <ExternalLink className="h-3 w-3" />
                    Profiel
                  </a>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs h-7"
                  onClick={() => openConvertDialog(result)}
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

      {/* Convert to Candidate Dialog */}
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
