import { useState } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Briefcase, MapPin, Building2, Search, Clock, CheckCircle2 } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { createMatch } from '@/lib/match-lifecycle';
import { splitGeneratedVacancyDescription, stripMarkdownInline } from '@/lib/rich-text';

/** Wat deze kandidaat van de vacature te zien krijgt — nooit interne of ruwe markdown-tekst. */
const candidateText = (vacancy: any): string => {
  if (vacancy.candidate_description) return stripMarkdownInline(vacancy.candidate_description);
  const split = splitGeneratedVacancyDescription(vacancy.description);
  return stripMarkdownInline(split.candidateText);
};

const PortalJobMarket = () => {
  const { employee, candidate } = usePortal();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [applyVacancy, setApplyVacancy] = useState<any>(null);
  const [motivation, setMotivation] = useState('');

  const orgId = candidate?.organization_id;

  // Fetch open vacancies for this organization
  const { data: vacancies = [], isLoading } = useQuery({
    queryKey: ['portal-job-market', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancies')
        .select('*, companies:company_id(id, name, address_city)')
        .eq('organization_id', orgId!)
        .eq('status', 'open' as any)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  // Fetch existing matches for this candidate to show applied status
  const { data: myMatches = [] } = useQuery({
    queryKey: ['portal-my-matches', employee?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('vacancy_id, status')
        .eq('candidate_id', employee!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!employee?.id,
  });

  const matchedVacancies = new Map(myMatches.map((m: any) => [m.vacancy_id, m.status]));

  const applyMutation = useMutation({
    mutationFn: async ({ vacancyId, vacancyCreatedBy }: { vacancyId: string; vacancyCreatedBy?: string | null }) => {
      await createMatch(supabase as any, {
        candidateId: employee!.id,
        vacancyId,
        orgId: orgId!,
        // De medewerker solliciteert zelf; die mag nooit accountmanager van de eigen
        // match worden. De vacature-eigenaar pakt de opvolging op.
        assignedTo: vacancyCreatedBy ?? null,
        source: 'sollicitatie',
        notes: motivation || null,
        proposedAt: new Date().toISOString().split('T')[0],
      });
    },
    onSuccess: () => {
      toast.success('Sollicitatie verstuurd!');
      qc.invalidateQueries({ queryKey: ['portal-my-matches'] });
      setApplyVacancy(null);
      setMotivation('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = vacancies.filter((v: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      v.title?.toLowerCase().includes(s) ||
      (v.companies as any)?.name?.toLowerCase().includes(s) ||
      v.work_location?.toLowerCase().includes(s) ||
      (v.companies as any)?.address_city?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Vacatures</h1>
        <p className="text-sm text-muted-foreground">Bekijk beschikbare functies en reageer direct</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Zoek op functie, bedrijf of locatie..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-center py-12">Laden...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Briefcase className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">
            {search ? 'Geen vacatures gevonden voor je zoekopdracht' : 'Er zijn momenteel geen openstaande vacatures'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((v: any) => {
            const company = v.companies as any;
            const matchStatus = matchedVacancies.get(v.id);
            const hasApplied = !!matchStatus;

            return (
              <Card key={v.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base" data-no-translate="true">{v.title}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          <span data-no-translate="true">{company?.name ?? '—'}</span>
                        </span>
                        {(v.work_location || company?.address_city) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            <span data-no-translate="true">{v.work_location ?? company?.address_city}</span>
                          </span>
                        )}
                        {v.hourly_rate && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            €{v.hourly_rate}/uur
                          </span>
                        )}
                      </div>
                      {/* De kandidaatomschrijving is de tekst die vóór de kandidaat geschreven is.
                          Terugval op `description` mag alleen ná opsplitsen: bij oudere vacatures
                          staat daar de complete AI-dump in, inclusief matchingprofiel en interne
                          controlelijst. Die mag een kandidaat nooit te zien krijgen. Markdown gaat
                          er sowieso uit — anders leest hij hier "## Volledige SEO-vacaturetekst". */}
                      {candidateText(v) && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-3" data-no-translate="true">
                          {candidateText(v)}
                        </p>
                      )}
                      {v.requirements && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          <span className="font-medium">Vereisten:</span> <span data-no-translate="true">{v.requirements}</span>
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {v.start_date && (
                          <Badge variant="outline" className="text-xs">Start: {formatDate(v.start_date)}</Badge>
                        )}
                        {v.contract_type && (
                          <Badge variant="outline" className="text-xs" data-no-translate="true">{v.contract_type}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {hasApplied ? (
                        <div className="flex items-center gap-1.5 text-sm text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Gesolliciteerd</span>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => setApplyVacancy(v)}>
                          Reageren
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Apply dialog */}
      <Dialog open={!!applyVacancy} onOpenChange={open => { if (!open) { setApplyVacancy(null); setMotivation(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reageren op vacature</DialogTitle>
            <DialogDescription>
              <span data-no-translate="true">{applyVacancy?.title}</span> bij <span data-no-translate="true">{(applyVacancy?.companies as any)?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Motivatie (optioneel)</Label>
              <Textarea
                value={motivation}
                onChange={e => setMotivation(e.target.value)}
                placeholder="Waarom ben je geinteresseerd in deze functie?"
                rows={4}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setApplyVacancy(null); setMotivation(''); }}>
                Annuleren
              </Button>
              <Button
                onClick={() => applyMutation.mutate({ vacancyId: applyVacancy.id, vacancyCreatedBy: applyVacancy.created_by })}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending ? 'Versturen...' : 'Sollicitatie versturen'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalJobMarket;
