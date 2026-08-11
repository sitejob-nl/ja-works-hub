import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList, toastError } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import ErrorState from '@/components/shared/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, Play, ShieldAlert, Search, ArrowRight, PencilLine } from 'lucide-react';

type DiffEntry = { van: unknown; naar: unknown };

export interface PreviewRow {
  id: string;
  entity: string;
  carerix_id: string;
  action: 'create' | 'update';
  label: string | null;
  details: Record<string, unknown> | null;
  diff: Record<string, DiffEntry> | null;
  spam_reason: string | null;
  excluded: boolean;
}

interface PreviewJob {
  id: string;
  finished_at: string | null;
  only_entities: string[] | null;
  modified_since: string | null;
}

// De previewregels gebruiken het koppeltype uit external_mappings (enkelvoud),
// niet de entiteitsnaam van de import-run (meervoud).
const ENTITY_LABEL: Record<string, string> = {
  company: 'Opdrachtgevers',
  contact: 'Contactpersonen',
  candidate: 'Kandidaten',
  vacancy: 'Vacatures',
  placement: 'Plaatsingen',
  match: 'Matches',
  document: 'Documenten',
  note: 'Notities',
};

const ENTITY_ORDER = ['candidate', 'company', 'contact', 'vacancy', 'placement', 'match', 'document', 'note'];

// NL-labels voor de diff-weergave; onbekende velden vallen terug op de kolomnaam.
const FIELD_LABEL: Record<string, string> = {
  first_name: 'voornaam',
  last_name: 'achternaam',
  full_name: 'naam',
  name: 'naam',
  email: 'e-mail',
  phone: 'telefoon',
  phone_nl: 'telefoon (NL)',
  date_of_birth: 'geboortedatum',
  nationality: 'nationaliteit',
  employee_number: 'personeelsnr.',
  languages: 'talen',
  address_street: 'straat',
  address_city: 'plaats',
  address_postal: 'postcode',
  address_country: 'land',
  birth_country: 'geboorteland',
  title: 'titel',
  hourly_rate: 'uurtarief',
  start_date: 'startdatum',
  end_date: 'einddatum',
};

type TypeFilter = 'alles' | 'nieuw' | 'gewijzigd' | 'spam';

const INITIAL_VISIBLE = 100;

function rowKind(row: PreviewRow): Exclude<TypeFilter, 'alles'> {
  if (row.spam_reason) return 'spam';
  return row.action === 'update' ? 'gewijzigd' : 'nieuw';
}

export default function ImportPreviewPanel({
  job,
  onStarted,
}: {
  job: PreviewJob;
  onStarted: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('alles');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const queryKey = useMemo(() => ['carerix-preview', job.id], [job.id]);

  // Gepagineerd inladen tot een korte pagina: PostgREST capt een enkele select
  // op 1000 rijen en dat gebeurt STIL. Een half geladen voorvertoning zou
  // records buiten beeld houden (en "Alles uitvinken" zou ze overslaan) — zelfde
  // les als de id-mapper-preload aan de serverkant.
  const { data: rows, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const all: PreviewRow[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const page = await unwrapList<PreviewRow>(
          supabase
            .from('carerix_import_previews' as any)
            .select('id, entity, carerix_id, action, label, details, diff, spam_reason, excluded')
            .eq('job_id', job.id)
            .order('entity', { ascending: true })
            .order('carerix_id', { ascending: true })
            .range(from, from + PAGE - 1) as never,
        );
        all.push(...page);
        if (page.length < PAGE) break;
      }
      return all;
    },
  });

  // Is deze voorvertoning al gebruikt voor een live import? Dan niet nogmaals
  // aanbieden: de selectie is al uitgevoerd en opnieuw draaien zou oude
  // goedgekeurde updates herhalen op mogelijk inmiddels gewijzigde data.
  const { data: usedBy } = useQuery({
    queryKey: ['carerix-preview-used', job.id],
    queryFn: () =>
      unwrap<{ id: string; status: string; started_at: string | null } | null>(
        supabase
          .from('carerix_import_jobs' as any)
          .select('id, status, started_at')
          .eq('preview_job_id', job.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as never,
      ),
  });

  const setExcluded = useMutation({
    // Hele entiteitsgroep via een server-side filter op (job, entiteit); losse
    // rijen via ids in stukken van 100 — duizend UUID's in één URL proppen
    // loopt tegen de URL-lengtelimiet van de gateway aan.
    mutationFn: async (vars: { ids?: string[]; entity?: string; excluded: boolean }) => {
      if (vars.entity) {
        await unwrap(
          supabase
            .from('carerix_import_previews' as any)
            .update({ excluded: vars.excluded })
            .eq('job_id', job.id)
            .eq('entity', vars.entity) as never,
        );
        return;
      }
      const ids = vars.ids ?? [];
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await unwrap(
          supabase
            .from('carerix_import_previews' as any)
            .update({ excluded: vars.excluded })
            .in('id', ids.slice(i, i + CHUNK)) as never,
        );
      }
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PreviewRow[]>(queryKey);
      const idSet = new Set(vars.ids ?? []);
      queryClient.setQueryData<PreviewRow[]>(queryKey, (old) =>
        (old ?? []).map((r) =>
          (vars.entity ? r.entity === vars.entity : idSet.has(r.id))
            ? { ...r, excluded: vars.excluded }
            : r,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toastError(err, 'Selectie kon niet worden opgeslagen');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const startLive = useMutation({
    mutationFn: async () => {
      const { data, error: fnError } = await supabase.functions.invoke('carerix-sync-start', {
        body: {
          mode: 'live',
          only: job.only_entities,
          modified_since: job.modified_since,
          preview_job_id: job.id,
        },
      });
      if (fnError) throw new Error(fnError.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    },
    onSuccess: () => {
      toast.success('Import gestart met jouw selectie');
      onStarted();
    },
    onError: (err) => toast.error(toFriendlyError(err)),
  });

  // "Alles aan/uitvinken" werkt op wat de gebruiker ZIET: zonder actief filter
  // de hele entiteitsgroep (server-side filter, één verzoek), mét zoekterm of
  // typefilter alleen de getoonde rijen (chunked ids).
  const bulkToggle = (entity: string, visibleRows: PreviewRow[], excluded: boolean) => {
    const unfiltered = search.trim() === '' && typeFilter === 'alles';
    if (unfiltered) setExcluded.mutate({ entity, excluded });
    else setExcluded.mutate({ ids: visibleRows.map((r) => r.id), excluded });
  };

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const map = new Map<string, PreviewRow[]>();
    for (const row of rows ?? []) {
      if (typeFilter !== 'alles' && rowKind(row) !== typeFilter) continue;
      if (term) {
        const haystack = `${row.label ?? ''} ${row.carerix_id} ${JSON.stringify(row.details ?? {})} ${JSON.stringify(row.diff ?? {})}`.toLowerCase();
        if (!haystack.includes(term)) continue;
      }
      const list = map.get(row.entity) ?? [];
      list.push(row);
      map.set(row.entity, list);
    }
    return [...map.entries()].sort(
      (a, b) => ENTITY_ORDER.indexOf(a[0]) - ENTITY_ORDER.indexOf(b[0]),
    );
  }, [rows, search, typeFilter]);

  const totals = useMemo(() => {
    const all = rows ?? [];
    const nieuw = all.filter((r) => rowKind(r) === 'nieuw');
    const gewijzigd = all.filter((r) => rowKind(r) === 'gewijzigd');
    const spam = all.filter((r) => rowKind(r) === 'spam');
    return {
      total: all.length,
      nieuw: nieuw.length,
      gewijzigd: gewijzigd.length,
      spam: spam.length,
      selectedCreates: all.filter((r) => r.action === 'create' && !r.excluded).length,
      selectedUpdates: gewijzigd.filter((r) => !r.excluded).length,
    };
  }, [rows]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Voorvertoning laden…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <ErrorState title="Voorvertoning kon niet geladen worden" error={error} onRetry={() => refetch()} />;
  }

  if (usedBy) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Voorvertoning al gebruikt</CardTitle>
          <CardDescription>
            De dry-run van{' '}
            {job.finished_at ? new Date(job.finished_at).toLocaleString('nl-NL') : '—'} is al gebruikt
            voor een import
            {usedBy.started_at ? ` (gestart ${new Date(usedBy.started_at).toLocaleString('nl-NL')})` : ''}.
            Draai een nieuwe dry-run om opnieuw te kunnen kiezen wat je importeert.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Geen nieuwe of gewijzigde records</CardTitle>
          <CardDescription>
            De laatste dry-run vond niets dat nog aangemaakt of bijgewerkt moet worden. Alles uit Carerix
            is al gekoppeld en gelijk.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const filterChips: Array<{ key: TypeFilter; label: string; count: number }> = [
    { key: 'alles', label: 'Alles', count: totals.total },
    { key: 'nieuw', label: 'Nieuw', count: totals.nieuw },
    { key: 'gewijzigd', label: 'Gewijzigd', count: totals.gewijzigd },
    { key: 'spam', label: 'Spam', count: totals.spam },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wat deze import zou doen</CardTitle>
        <CardDescription>
          Uit de dry-run van{' '}
          {job.finished_at ? new Date(job.finished_at).toLocaleString('nl-NL') : 'zojuist'}:{' '}
          {totals.nieuw} nieuw{totals.gewijzigd > 0 && <>, {totals.gewijzigd} met afwijkende gegevens</>}
          {totals.spam > 0 && <>, {totals.spam} als spam herkend</>}.{' '}
          Aangevinkt: {totals.selectedCreates} om aan te maken
          {totals.gewijzigd > 0 && <> en {totals.selectedUpdates} om bij te werken</>}.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Zoek op naam of Carerix-id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {filterChips.map((chip) => (
              <Button
                key={chip.key}
                variant={typeFilter === chip.key ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={typeFilter === chip.key}
                onClick={() => setTypeFilter(chip.key)}
                disabled={chip.count === 0 && chip.key !== 'alles'}
              >
                {chip.label} ({chip.count})
              </Button>
            ))}
          </div>
        </div>

        {totals.gewijzigd > 0 && (
          <p className="text-sm text-muted-foreground">
            Gewijzigde records staan standaard <strong>uitgevinkt</strong>: vink je ze aan, dan
            overschrijft de import de platformwaarden met de getoonde Carerix-waarden. Bij
            kandidaten vult de import lege velden sowieso automatisch aan; wat je hier ziet zijn de
            overige verschillen.
          </p>
        )}

        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">Geen records die aan je filter voldoen.</p>
        )}

        {grouped.map(([entity, entityRows]) => {
          const selectedCount = entityRows.filter((r) => !r.excluded).length;
          const showAll = expanded[entity];
          const visible = showAll ? entityRows : entityRows.slice(0, INITIAL_VISIBLE);

          return (
            <div key={entity} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {ENTITY_LABEL[entity] ?? entity}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    — {selectedCount} van {entityRows.length} geselecteerd
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkToggle(entity, entityRows, false)}
                    disabled={setExcluded.isPending || selectedCount === entityRows.length}
                  >
                    Alles aanvinken
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkToggle(entity, entityRows, true)}
                    disabled={setExcluded.isPending || selectedCount === 0}
                  >
                    Alles uitvinken
                  </Button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Record</TableHead>
                      <TableHead className="w-32">Carerix-id</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <TableRow key={row.id} className={row.excluded ? 'opacity-60' : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={!row.excluded}
                            onCheckedChange={(checked) =>
                              setExcluded.mutate({ ids: [row.id], excluded: !checked })
                            }
                            aria-label={
                              row.action === 'update'
                                ? `${row.label ?? row.carerix_id} bijwerken met Carerix-gegevens`
                                : `${row.label ?? row.carerix_id} meenemen in de import`
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{row.label ?? <span className="text-muted-foreground">zonder naam</span>}</span>
                            {row.action === 'update' && (
                              <Badge variant="secondary" className="gap-1">
                                <PencilLine className="h-3 w-3" />
                                Gewijzigd
                              </Badge>
                            )}
                            {row.spam_reason && (
                              <Badge variant="destructive" className="gap-1">
                                <ShieldAlert className="h-3 w-3" />
                                {row.spam_reason}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.carerix_id}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.action === 'update' && row.diff ? (
                            <DiffList diff={row.diff} />
                          ) : (
                            formatDetails(row.details)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {entityRows.length > INITIAL_VISIBLE && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((prev) => ({ ...prev, [entity]: !prev[entity] }))}
                >
                  {showAll
                    ? `Toon alleen de eerste ${INITIAL_VISIBLE}`
                    : `Toon alle ${entityRows.length}`}
                </Button>
              )}
            </div>
          );
        })}

        <Separator />

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => startLive.mutate()} disabled={startLive.isPending}>
            {startLive.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            Importeren ({totals.selectedCreates} nieuw
            {totals.selectedUpdates > 0 && <>, {totals.selectedUpdates} bijwerken</>})
          </Button>
          <p className="text-sm text-muted-foreground">
            Alleen wat in deze voorvertoning staat én aangevinkt is, wordt geïmporteerd. Uitgevinkte
            records worden overgeslagen (geen koppeling) en records die ná de dry-run in Carerix
            zijn bijgekomen wachten op de volgende dry-run. Uitgevinkte wijzigingen blijven zoals ze
            in het platform staan.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DiffList({ diff }: { diff: Record<string, DiffEntry> }) {
  return (
    <div className="space-y-0.5">
      {Object.entries(diff).map(([field, change]) => (
        <div key={field} className="flex flex-wrap items-center gap-1 text-xs">
          <span className="font-medium text-foreground">{FIELD_LABEL[field] ?? field}:</span>
          <span className="sr-only">was</span>
          <span className="line-through">{formatDiffValue(change.van)}</span>
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="sr-only">wordt</span>
          <span className="text-foreground">{formatDiffValue(change.naar)}</span>
        </div>
      ))}
    </div>
  );
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'leeg';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ') || 'leeg';
  return String(value);
}

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .map(([, value]) => String(value))
    .join(' · ');
}
