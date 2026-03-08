import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Loader2, ExternalLink, UserSearch, Globe, Bookmark } from 'lucide-react';

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

const KandidatenZoeken = () => {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [userLocation, setUserLocation] = useState('NL');
  const [numResults, setNumResults] = useState('10');
  const [includeText, setIncludeText] = useState(false);
  const [highlightsQuery, setHighlightsQuery] = useState('');

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

              {result.url && (
                <a
                  href={result.url as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Profiel bekijken
                </a>
              )}

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
    </div>
  );
};

export default KandidatenZoeken;
