import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2, RefreshCw, Plug, PlugZap, Play, OctagonX, Download, AlertTriangle, FileCheck2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const ENTITIES = [
  'companies',
  'contacts',
  'candidates',
  'vacancies',
  'placements',
  'matches',
  'documents',
  'employment',
  'notes',
] as const;
type EntityName = (typeof ENTITIES)[number];

// Entities with a working runner. CR*-entities require the wrapper-scope on the
// Carerix tenant; if not granted the runner gracefully marks them skipped.
const SUPPORTED_ENTITIES: EntityName[] = [
  'companies',
  'contacts',
  'candidates',
  'vacancies',
  'placements',
  'matches',
  'documents',
  'notes',
];

const ENTITY_LABEL: Record<EntityName, string> = {
  companies: 'Opdrachtgevers',
  contacts: 'Contactpersonen',
  candidates: 'Kandidaten',
  vacancies: 'Vacatures',
  placements: 'Plaatsingen (werkhistorie)',
  matches: 'Matches (pipeline)',
  documents: 'Documenten (per kandidaat)',
  employment: 'Werkhistorie (zit in plaatsingen)',
  notes: 'Notities & taken',
};

const UNSUPPORTED_REASON: Partial<Record<EntityName, string>> = {
  employment:
    'Werkhistorie wordt al gemigreerd via Plaatsingen (CRWorkHistory bevat alle JA Werkt-plaatsingen).',
};

interface CarerixConfig {
  id: string;
  client_id: string | null;
  instance_url: string | null;
  token_endpoint: string | null;
  scope: string | null;
  is_connected: boolean;
  connected_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  last_test_total_companies: number | null;
}

interface CarerixJob {
  id: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  mode: 'dry_run' | 'live';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  only_entities: string[] | null;
  skip_entities: string[] | null;
  summary: Record<string, {
    status: string;
    found: number;
    created: number;
    skipped: number;
    failed: number;
    missing_scope?: boolean;
    dependency_missing?: boolean;
    top_failure_reasons?: Array<{ reason: string; count: number }>;
  }> | null;
  last_error: string | null;
}

interface EntityRun {
  job_id: string;
  entity: EntityName;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  page_cursor: number;
  total_elements: number | null;
  found: number;
  created: number;
  skipped: number;
  failed: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
export default function CarerixImport() {
  const orgId = useOrganizationId();

  const { data: config, isLoading: cfgLoading } = useQuery({
    queryKey: ['carerix-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('carerix-config', {
        body: { action: 'get' },
      });
      if (error) throw new Error(error.message);
      return ((data as any)?.config ?? null) as CarerixConfig | null;
    },
  });

  const isConnected = !!config?.is_connected;

  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Carerix import</h1>
        <p className="text-muted-foreground">
          Live import via Carerix GraphQL: basisgegevens via het publieke schema, rijke migratiedata via het
          CR*-schema met aparte documentdownload naar Supabase Storage.
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardContent className="pt-4 text-sm space-y-2">
          <p className="font-medium">Belangrijk voor volledige migratie</p>
          <p className="text-muted-foreground">
            Kandidaten, vacatures, matches, werkhistorie, documenten en notities komen uit Carerix' rijke
            <code> CR*</code>-schema. Daarvoor moet de OAuth-client de scope{' '}
            <code>urn:cx/cx5Wrapper:data:manage</code> hebben.
          </p>
          <p className="text-muted-foreground">
            Als die scope ontbreekt, werkt de basisverbinding nog wel, maar blijven de rijke runners overslaan.
            Gebruik dan tijdelijk de CSV-wizard via{' '}
            <a href="/importeren" className="text-primary underline underline-offset-2">
              Importeren
            </a>
            .
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue={isConnected ? 'import' : 'connect'}>
        <TabsList>
          <TabsTrigger value="connect">Verbinding</TabsTrigger>
          <TabsTrigger value="import" disabled={!isConnected}>
            Import
          </TabsTrigger>
          <TabsTrigger value="history" disabled={!isConnected}>
            Geschiedenis
          </TabsTrigger>
          <TabsTrigger value="acceptance" disabled={!isConnected}>
            Acceptatie
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connect">
          <ConnectCard config={config} loading={cfgLoading} />
        </TabsContent>

        <TabsContent value="import">
          <ImportTab />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>

        <TabsContent value="acceptance">
          <AcceptanceTab config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Connect card
// ─────────────────────────────────────────────────────────────
function ConnectCard({ config, loading }: { config: CarerixConfig | null | undefined; loading: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ client_id: '', client_secret: '', instance_url: '', token_endpoint: '' });

  const connectMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('carerix-config', {
        body: { action: 'connect', ...form },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('Carerix gekoppeld');
      setForm({ client_id: '', client_secret: '', instance_url: '', token_endpoint: '' });
      queryClient.invalidateQueries({ queryKey: ['carerix-config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('carerix-test', { body: {} });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: boolean; totalCompanies: number; richSchemaOk?: boolean };
    },
    onSuccess: (d) => {
      toast.success(
        `Verbinding werkt — ${d.totalCompanies} opdrachtgevers zichtbaar, CR*-scope actief`,
      );
      queryClient.invalidateQueries({ queryKey: ['carerix-config'] });
    },
    onError: (e: Error) => toast.error(`Test mislukt: ${e.message}`),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('carerix-config', {
        body: { action: 'disconnect' },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Verbinding verbroken');
      queryClient.invalidateQueries({ queryKey: ['carerix-config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <p className="text-muted-foreground">Laden...</p>;

  if (config?.is_connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="h-5 w-5 text-green-600" /> Gekoppeld met Carerix
          </CardTitle>
          <CardDescription>
            {config.instance_url} — verbonden op{' '}
            {config.connected_at ? new Date(config.connected_at).toLocaleString('nl-NL') : '-'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Client ID:</span> <code>{config.client_id}</code>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Scope:</span> <code>{config.scope}</code>
          </div>
          <Separator />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Laatste test:</span>
            {config.last_test_at ? (
              <>
                {config.last_test_ok ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" /> {config.last_test_error}
                  </Badge>
                )}
                <span>{new Date(config.last_test_at).toLocaleString('nl-NL')}</span>
                {config.last_test_total_companies != null && (
                  <span className="text-muted-foreground">({config.last_test_total_companies} bedrijven)</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">nog niet getest</span>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={() => testMut.mutate()} disabled={testMut.isPending}>
              {testMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Test verbinding
            </Button>
            <IntrospectButton />
            <Button variant="destructive" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
              Ontkoppelen
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5" /> Carerix koppelen
        </CardTitle>
        <CardDescription>
          Vul hier je Carerix OAuth2-credentials in. Zie docs/carerix-credentials-setup.md voor hoe je ze aanmaakt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="instance_url">Instance URL</Label>
          <Input
            id="instance_url"
            placeholder="https://jouw-omgeving.carerix.com"
            value={form.instance_url}
            onChange={(e) => setForm({ ...form, instance_url: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Het domein waarop je inlogt op Carerix.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="client_id">Client ID</Label>
          <Input
            id="client_id"
            value={form.client_id}
            onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client_secret">Client Secret</Label>
          <Input
            id="client_secret"
            type="password"
            value={form.client_secret}
            onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Wordt versleuteld opgeslagen via Supabase Vault.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="token_endpoint">Token endpoint of OpenID Configuration URL</Label>
          <Input
            id="token_endpoint"
            placeholder="https://identity.carerix.io/realms/.../openid-connect/token"
            value={form.token_endpoint}
            onChange={(e) => setForm({ ...form, token_endpoint: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Klik in Carerix bij je client op "OpenID Configuration" — die opent een JSON-pagina. Plak hier het{' '}
            <code>token_endpoint</code> veld daaruit (eindigt op <code>/openid-connect/token</code>).{' '}
            Als je de <code>/auth</code> URL plakt zet de app hem automatisch om naar <code>/token</code>.
            Óf plak de volledige <code>.well-known/openid-configuration</code> URL — app extract dan zelf.
          </p>
        </div>
        <Button
          onClick={() => connectMut.mutate()}
          disabled={connectMut.isPending || !form.client_id || !form.client_secret || !form.instance_url}
        >
          {connectMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plug className="h-4 w-4 mr-1" />}
          Verbinden + testen
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Import tab (active job + start controls)
// ─────────────────────────────────────────────────────────────
function ImportTab() {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [only, setOnly] = useState<EntityName[]>([...SUPPORTED_ENTITIES]);
  const [dryRun, setDryRun] = useState(false);

  const { data: activeJob } = useQuery({
    queryKey: ['carerix-active-job', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any as CarerixJob | null;
    },
    refetchInterval: (q) => (q.state.data ? 3000 : 5000),
  });

  const startMut = useMutation({
    mutationFn: async () => {
      const body = {
        mode: dryRun ? 'dry_run' : 'live',
        only: only.length < ENTITIES.length ? only : null,
      };
      const { data, error } = await supabase.functions.invoke('carerix-sync-start', { body });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('Import gestart');
      queryClient.invalidateQueries({ queryKey: ['carerix-active-job'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke('carerix-sync-cancel', { body: { job_id: jobId } });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
    },
    onSuccess: () => {
      toast.success('Import geannuleerd');
      queryClient.invalidateQueries({ queryKey: ['carerix-active-job'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (activeJob) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              {activeJob.mode === 'dry_run' ? 'Dry-run loopt' : 'Import loopt'}
            </CardTitle>
            <CardDescription>
              Job {activeJob.id.slice(0, 8)} — gestart{' '}
              {activeJob.started_at ? new Date(activeJob.started_at).toLocaleTimeString('nl-NL') : '—'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressPanel jobId={activeJob.id} />
            <Button variant="destructive" onClick={() => cancelMut.mutate(activeJob.id)} disabled={cancelMut.isPending}>
              <OctagonX className="h-4 w-4 mr-1" /> Annuleren
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nieuwe import starten</CardTitle>
        <CardDescription>
          Kies welke entiteiten je wilt importeren. Gebruik dry-run om te zien wat er zou gebeuren zonder te schrijven.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <Label>Entiteiten</Label>
          <div className="grid grid-cols-2 gap-2">
            {ENTITIES.map((e) => {
              const unsupported = UNSUPPORTED_REASON[e];
              const disabled = Boolean(unsupported);
              return (
                <label
                  key={e}
                  className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title={unsupported}
                >
                  <Checkbox
                    checked={only.includes(e)}
                    disabled={disabled}
                    onCheckedChange={(v) => {
                      if (disabled) return;
                      if (v) setOnly([...only, e]);
                      else setOnly(only.filter((x) => x !== e));
                    }}
                  />
                  <div>
                    <div>{ENTITY_LABEL[e]}</div>
                    {unsupported && (
                      <div className="text-xs text-muted-foreground">{unsupported}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="dry-run" checked={dryRun} onCheckedChange={setDryRun} />
          <Label htmlFor="dry-run">Dry-run (niets wegschrijven)</Label>
        </div>

        <Button onClick={() => startMut.mutate()} disabled={startMut.isPending || only.length === 0}>
          {startMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          Import starten
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Progress panel (realtime)
// ─────────────────────────────────────────────────────────────
function ProgressPanel({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['carerix-entity-runs', jobId], [jobId]);

  const { data: runs } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_entity_runs' as any)
        .select('*')
        .eq('job_id', jobId);
      if (error) throw error;
      return data as any as EntityRun[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`carerix-runs-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'carerix_import_entity_runs', filter: `job_id=eq.${jobId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, queryClient, queryKey]);

  return (
    <div className="space-y-2">
      {ENTITIES.map((e) => {
        const run = runs?.find((r) => r.entity === e);
        const total = run?.total_elements ?? run?.found ?? 0;
        const done = (run?.created ?? 0) + (run?.skipped ?? 0) + (run?.failed ?? 0);
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        return (
          <div key={e} className="flex items-center gap-3">
            <div className="w-36 text-sm">{ENTITY_LABEL[e]}</div>
            <div className="flex-1">
              <Progress value={pct} />
            </div>
            <div className="w-56 text-xs text-muted-foreground tabular-nums">
              <StatusBadge status={run?.status ?? 'queued'} /> {done}/{total || '?'} · +{run?.created ?? 0} ={run?.skipped ?? 0} ✕{run?.failed ?? 0}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IntrospectButton() {
  const [result, setResult] = useState<{
    types: Record<string, { name: string; type: string }[] | null>;
    queries: { name: string; type: string }[];
  } | null>(null);
  const [open, setOpen] = useState(false);

  const introspectMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('carerix-introspect', { body: {} });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (d) => {
      setResult({ types: d.types, queries: d.queries });
      setOpen(true);
      const typesWithFields = Object.entries(d.types ?? {}).filter(
        ([, v]) => Array.isArray(v) && v.length > 0,
      );
      toast.success(
        `Ontdekt: ${typesWithFields.length} types zichtbaar, ${d.queries?.length ?? 0} queries beschikbaar`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="outline" onClick={() => introspectMut.mutate()} disabled={introspectMut.isPending}>
        {introspectMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        Ontdek beschikbare velden
      </Button>
      {open && result && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-background max-w-5xl w-full max-h-[85vh] overflow-auto p-6 rounded-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Carerix schema introspectie</h3>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Sluiten</Button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Kopieer en deel deze JSON met Kas. Bevat alle types zichtbaar voor deze scope +
              lijst van alle beschikbare top-level queries (voor schema-verificatie).
            </p>
            <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-[65vh]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Acceptance / go-no-go
// ─────────────────────────────────────────────────────────────
function AcceptanceTab({ config }: { config: CarerixConfig | null | undefined }) {
  const orgId = useOrganizationId();

  const { data: latestJob } = useQuery({
    queryKey: ['carerix-acceptance-latest-job', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any as CarerixJob | null;
    },
    enabled: !!orgId,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ['carerix-acceptance-runs', latestJob?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_entity_runs' as any)
        .select('*')
        .eq('job_id', latestJob!.id);
      if (error) throw error;
      return data as any as EntityRun[];
    },
    enabled: !!latestJob?.id,
  });

  const { data: failures = [] } = useQuery({
    queryKey: ['carerix-acceptance-failures', latestJob?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_failures' as any)
        .select('entity, carerix_id, error')
        .eq('job_id', latestJob!.id)
        .order('entity');
      if (error) throw error;
      return data as any as Array<{ entity: string; carerix_id: string | null; error: string }>;
    },
    enabled: !!latestJob?.id,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['carerix-document-validation', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_carerix_document_validation' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const requiredEntities: EntityName[] = ['candidates', 'vacancies', 'placements', 'matches', 'documents', 'notes'];
  const crScopeOk = Boolean(config?.last_test_ok);
  const entityCoverageOk = requiredEntities.every((e) => {
    const run = runs.find((r) => r.entity === e);
    return run?.status === 'completed' && (run.found > 0 || run.created > 0 || run.skipped === 0);
  });
  const documentStats = documents.reduce(
    (acc, d: any) => {
      acc.total += 1;
      if (d.download_status === 'downloaded') acc.downloaded += 1;
      else if (d.download_status === 'failed') acc.failed += 1;
      else acc.pending += 1;
      if (d.is_cv) acc.cv += 1;
      return acc;
    },
    { total: 0, downloaded: 0, pending: 0, failed: 0, cv: 0 },
  );
  const documentBytesOk = documentStats.total === 0 || (documentStats.failed === 0 && documentStats.pending === 0);
  const failuresOk = failures.length === 0;
  const goNoGo = crScopeOk && entityCoverageOk && documentBytesOk && failuresOk;

  const exportFailures = () => {
    const header = ['entity', 'carerix_id', 'error'];
    const lines = failures.map((f) => [f.entity, f.carerix_id ?? '', f.error].map(csvCell).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carerix-failures-${latestJob?.id?.slice(0, 8) ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {goNoGo ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            {goNoGo ? 'Go voor productie-import' : 'Nog niet productie-klaar'}
          </CardTitle>
          <CardDescription>
            Laatste job: {latestJob ? `${latestJob.id.slice(0, 8)} · ${latestJob.mode} · ${latestJob.status}` : 'geen importgeschiedenis'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <AcceptanceCheck ok={crScopeOk} label="CR*-scope" detail={config?.last_test_ok ? 'Laatste test OK' : config?.last_test_error ?? 'Nog niet getest'} />
          <AcceptanceCheck ok={entityCoverageOk} label="Entiteiten" detail={`${runs.filter((r) => r.status === 'completed').length}/${SUPPORTED_ENTITIES.length} afgerond`} />
          <AcceptanceCheck ok={documentBytesOk} label="Document bytes" detail={`${documentStats.downloaded}/${documentStats.total} gedownload · ${documentStats.failed} fout`} />
          <AcceptanceCheck ok={failuresOk} label="Failures" detail={`${failures.length} open importfouten`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entiteitdekking</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entiteit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gevonden</TableHead>
                <TableHead className="text-right">Aangemaakt</TableHead>
                <TableHead className="text-right">Overgeslagen</TableHead>
                <TableHead className="text-right">Fout</TableHead>
                <TableHead>Signaal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SUPPORTED_ENTITIES.map((entity) => {
                const run = runs.find((r) => r.entity === entity);
                const summary = latestJob?.summary?.[entity];
                const signal = summary?.missing_scope
                  ? 'Scope ontbreekt'
                  : summary?.dependency_missing
                    ? 'Dependency ontbreekt'
                    : run?.last_error ?? '—';
                return (
                  <TableRow key={entity}>
                    <TableCell>{ENTITY_LABEL[entity]}</TableCell>
                    <TableCell><StatusBadge status={run?.status ?? 'queued'} /></TableCell>
                    <TableCell className="text-right">{run?.found ?? 0}</TableCell>
                    <TableCell className="text-right">{run?.created ?? 0}</TableCell>
                    <TableCell className="text-right">{run?.skipped ?? 0}</TableCell>
                    <TableCell className="text-right">{run?.failed ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{signal}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><FileCheck2 className="h-4 w-4" /> Documentvalidatie</CardTitle>
              <CardDescription>{documentStats.total} Carerix-documenten · {documentStats.cv} CV's</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={exportFailures} disabled={failures.length === 0} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Failure CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kandidaat</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Carerix ID</TableHead>
                <TableHead>Foutreden</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.slice(0, 50).map((d: any) => (
                <TableRow key={d.document_id}>
                  <TableCell>{[d.first_name, d.last_name].filter(Boolean).join(' ')}</TableCell>
                  <TableCell>{d.name}{d.is_cv && <Badge variant="secondary" className="ml-2 text-[10px]">CV</Badge>}</TableCell>
                  <TableCell><DocumentStatusBadge status={d.download_status} /></TableCell>
                  <TableCell className="font-mono text-xs">{d.carerix_id ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.failure_reason ?? '—'}</TableCell>
                </TableRow>
              ))}
              {documents.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Geen Carerix-documenten gevonden</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AcceptanceCheck({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-lg border p-3 ${ok ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
        {label}
      </div>
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{detail}</p>
    </div>
  );
}

function DocumentStatusBadge({ status }: { status: string }) {
  const meta: Record<string, string> = {
    downloaded: 'bg-green-100 text-green-700 border-0',
    pending: 'bg-yellow-100 text-yellow-700 border-0',
    failed: 'bg-red-100 text-red-700 border-0',
  };
  const label: Record<string, string> = { downloaded: 'Gedownload', pending: 'Wacht', failed: 'Fout' };
  return <Badge variant="secondary" className={meta[status] ?? 'bg-muted text-muted-foreground border-0'}>{label[status] ?? status}</Badge>;
}

function csvCell(value: string) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: 'bg-gray-200 text-gray-700',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    skipped: 'bg-muted text-muted-foreground',
  };
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] mr-1 ${map[status] ?? ''}`}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────
// History tab
// ─────────────────────────────────────────────────────────────
function HistoryTab() {
  const orgId = useOrganizationId();
  const { data: jobs } = useQuery({
    queryKey: ['carerix-jobs', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any as CarerixJob[];
    },
  });

  if (!jobs || jobs.length === 0) return <p className="text-muted-foreground">Nog geen imports uitgevoerd.</p>;

  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: CarerixJob }) {
  const { data: failures } = useQuery({
    queryKey: ['carerix-failures', job.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carerix_import_failures' as any)
        .select('entity, carerix_id, error')
        .eq('job_id', job.id)
        .limit(50);
      if (error) throw error;
      return data as any as Array<{ entity: string; carerix_id: string; error: string }>;
    },
    enabled:
      job.status === 'failed' ||
      Boolean(job.summary && Object.values(job.summary).some((s) => s.failed > 0)),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">
              {new Date(job.created_at).toLocaleString('nl-NL')} · {job.mode === 'dry_run' ? 'Dry-run' : 'Live'}
            </CardTitle>
            <CardDescription>Job {job.id.slice(0, 8)}</CardDescription>
          </div>
          <StatusBadge status={job.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {job.summary ? (
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(job.summary).filter(([entity]) => !entity.startsWith('_')).map(([entity, s]) => (
              <div key={entity} className="border rounded px-2 py-1">
                <div className="font-medium">{ENTITY_LABEL[entity as EntityName] ?? entity}</div>
                <div className="text-xs text-muted-foreground">
                  +{s.created} ={s.skipped} ✕{s.failed} · {s.status}
                </div>
                {s.top_failure_reasons && s.top_failure_reasons.length > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {s.top_failure_reasons[0].reason} ({s.top_failure_reasons[0].count})
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">Geen samenvatting beschikbaar.</p>
        )}
        {job.last_error && <div className="text-red-600 text-xs">{job.last_error}</div>}
        {failures && failures.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">Toon {failures.length} gefaalde records</summary>
            <ul className="pl-4 mt-2 space-y-1">
              {failures.map((f, i) => (
                <li key={i}>
                  <code>{f.entity}</code> {f.carerix_id}: {f.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
