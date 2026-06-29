import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Brain, Loader2, AlertTriangle, CheckCircle2, Image, Shield } from 'lucide-react';
import { toast } from 'sonner';

interface BatchResult {
  candidate_id: string;
  status: 'queued' | 'completed' | 'skipped' | 'failed';
  reason?: string;
  cost_cents?: number;
  pseudonymized_meta?: { name: number; email: number; phone: number; bsn: number; iban: number };
  has_photo?: boolean;
  selected_document?: { name?: string; reason?: string; type?: string | null } | null;
  context_counts?: { notes?: number; communications?: number; placements?: number; employments?: number };
}

interface BatchResponse {
  processed?: number;
  completed?: number;
  failed?: number;
  skipped?: number;
  continued?: boolean;
  done?: boolean;
  cost_cents?: number;
  stopped_reason?: string;
  results: BatchResult[];
  message?: string;
}

const textDocPattern = /\.(pdf|docx?|odt|rtf|txt)(?:$|[?#])/i;

const applyOrgFilter = (query: any, orgFilter: string) =>
  orgFilter ? query.eq('organization_id', orgFilter) : query;

const SuperAdminCvBackfill = () => {
  const qc = useQueryClient();
  const [batchSize, setBatchSize] = useState(5);
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [includeFailed, setIncludeFailed] = useState(false);
  const [lastResults, setLastResults] = useState<BatchResult[] | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['cv-backfill-stats', orgFilter],
    queryFn: async () => {
      const [
        { count: total },
        { count: withCv },
        { count: completed },
        { count: idle },
        { count: nullStatus },
        { count: analyzing },
        { count: failed },
        { count: photoFlagged },
        documentsRes,
        notesRes,
        commRes,
      ] = await Promise.all([
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).not('cv_file_url', 'is', null), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('ai_status', 'completed'), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('ai_status', 'idle'), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).is('ai_status', null), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('ai_status', 'analyzing'), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('ai_status', 'failed'), orgFilter),
        applyOrgFilter(supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('cv_has_photo', true), orgFilter),
        applyOrgFilter(supabase.from('documents').select('candidate_id, type, name, file_path').not('file_path', 'is', null).limit(10000), orgFilter),
        applyOrgFilter(supabase.from('notes').select('related_entity_id').in('related_entity_type', ['candidate', 'kandidaat']).limit(10000), orgFilter),
        applyOrgFilter(supabase.from('communications').select('candidate_id').eq('channel', 'notitie').not('candidate_id', 'is', null).limit(10000), orgFilter),
      ]);
      if (documentsRes.error) throw documentsRes.error;
      if (notesRes.error) throw notesRes.error;
      if (commRes.error) throw commRes.error;

      const docs = (documentsRes.data ?? []) as Array<{ candidate_id: string; type: string; name: string | null; file_path: string | null }>;
      const textDocCandidates = new Set(docs.filter((d) => textDocPattern.test(d.file_path ?? '')).map((d) => d.candidate_id));
      const cvTypeCandidates = new Set(docs.filter((d) => d.type === 'cv').map((d) => d.candidate_id));
      const cvLikeCandidates = new Set(docs.filter((d) => /(^|[^a-z])(cv|curriculum|vitae|resume)([^a-z]|$)/i.test(`${d.name ?? ''} ${d.file_path ?? ''}`)).map((d) => d.candidate_id));
      const noteCandidates = new Set((notesRes.data ?? []).map((n: any) => n.related_entity_id).filter(Boolean));
      const commCandidates = new Set((commRes.data ?? []).map((c: any) => c.candidate_id).filter(Boolean));

      return {
        total: total ?? 0,
        withCv: withCv ?? 0,
        completed: completed ?? 0,
        queued: (idle ?? 0) + (nullStatus ?? 0),
        analyzing: analyzing ?? 0,
        failed: failed ?? 0,
        photoFlagged: photoFlagged ?? 0,
        cvTypeDocuments: cvTypeCandidates.size,
        textDocuments: textDocCandidates.size,
        cvLikeDocuments: cvLikeCandidates.size,
        noteCandidates: noteCandidates.size,
        commNoteCandidates: commCandidates.size,
      };
    },
    refetchInterval: 5000,
  });

  const { data: orgs = [] } = useQuery({
    queryKey: ['superadmin-orgs-simple'],
    queryFn: async () => {
      const { data } = await supabase.rpc('sa_get_organizations');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const runBatch = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('analyze-cv-batch', {
        body: {
          batch_size: batchSize,
          organization_id: orgFilter || null,
          include_failed: includeFailed,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as BatchResponse;
    },
    onSuccess: (data) => {
      const results = data.results ?? [];
      setLastResults(results);
      qc.invalidateQueries({ queryKey: ['cv-backfill-stats'] });
      const completed = data.completed ?? results.filter((r) => r.status === 'completed').length;
      const queued = results.filter((r) => r.status === 'queued').length;
      const failed = data.failed ?? results.filter((r) => r.status === 'failed').length;
      const skipped = data.skipped ?? results.filter((r) => r.status === 'skipped').length;
      const processed = data.processed ?? completed + queued + failed + skipped;
      if (processed === 0) {
        toast.info(data.message ?? 'Geen kandidaten te verwerken');
      } else if (completed > 0) {
        const tail = failed || skipped ? ` (${failed} mislukt, ${skipped} overgeslagen)` : '';
        toast.success(`${completed} kandidaatdossiers via Gemini voltooid${tail}`);
      } else if (queued > 0) {
        toast.success(`${queued} kandidaatdossiers naar Gemini gestuurd`);
      } else {
        toast.info(`Batch verwerkt (${failed} mislukt, ${skipped} overgeslagen)`);
      }
    },
    onError: (e: any) => toast.error(e.message ?? 'Batch mislukt'),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 text-zinc-200">
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-red-500" />
        <h1 className="text-2xl font-semibold text-white">AI Dossier Backfill</h1>
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-base text-white">Status</CardTitle>
          <CardDescription className="text-zinc-400">Telling van analysebare kandidaten, documenten en notitiecontext</CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Stat label="Kandidaten totaal" value={stats?.total ?? 0} sub={`${stats?.withCv ?? 0} met cv_file_url`} />
              <Stat label="Tekstdocumenten" value={stats?.textDocuments ?? 0} sub={`${stats?.cvTypeDocuments ?? 0} type CV · ${stats?.cvLikeDocuments ?? 0} CV-naam`} />
              <Stat label="Met notities" value={stats?.noteCandidates ?? 0} sub={`${stats?.commNoteCandidates ?? 0} communicatie-notities`} />
              <Stat label="Voltooid" value={stats?.completed ?? 0} accent="green" />
              <Stat label="Te analyseren" value={stats?.queued ?? 0} accent="amber" sub={`${stats?.analyzing ?? 0} bezig`} />
              <Stat label="Mislukt" value={stats?.failed ?? 0} accent="red" />
              <Stat label="Met foto" value={stats?.photoFlagged ?? 0} accent="purple" icon={Image} />
              <Stat
                label="Te verwerken nu"
                value={(stats?.queued ?? 0) + (includeFailed ? stats?.failed ?? 0 : 0)}
                accent="blue"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-base text-white">Batch starten</CardTitle>
          <CardDescription className="text-zinc-400">
            <Shield className="h-3 w-3 inline mr-1" />
            Dossier wordt server-side opgebouwd uit CV/documenten en interne notities, daarna gepseudonimiseerd vóór verzending naar Gemini.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-zinc-300">Batch grootte (1-25)</Label>
              <Input
                type="number"
                min={1}
                max={25}
                value={batchSize}
                onChange={(e) => setBatchSize(Math.min(25, Math.max(1, parseInt(e.target.value) || 5)))}
                className="bg-zinc-800 border-zinc-700"
              />
            </div>
            <div>
              <Label className="text-zinc-300">Filter op organisatie (optioneel)</Label>
              <select
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                className="w-full h-10 rounded-md bg-zinc-800 border border-zinc-700 px-3 text-sm text-zinc-200"
              >
                <option value="">Alle organisaties</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Checkbox
                id="incl-failed"
                checked={includeFailed}
                onCheckedChange={(v) => setIncludeFailed(v === true)}
              />
              <Label htmlFor="incl-failed" className="text-sm cursor-pointer text-zinc-300 pb-1">
                Mislukte ook opnieuw proberen
              </Label>
            </div>
          </div>
          <div className="pt-2">
            <Button
              onClick={() => runBatch.mutate()}
              disabled={runBatch.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {runBatch.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {runBatch.isPending ? `Verwerken (~${batchSize * 2}s)...` : `Verwerk ${batchSize} dossiers`}
            </Button>
            <p className="text-xs text-zinc-500 mt-2">
              Verwerk batches achter elkaar tot de wachtrij leeg is.
            </p>
          </div>
        </CardContent>
      </Card>

      {lastResults && lastResults.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white">Resultaten laatste batch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lastResults.map((r) => (
              <div key={r.candidate_id} className="flex items-start gap-3 p-2 rounded bg-zinc-950 border border-zinc-800">
                <ResultIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-zinc-400 truncate">{r.candidate_id}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status}</Badge>
                    {r.has_photo && <Badge variant="outline" className="border-purple-700 text-purple-400 gap-1"><Image className="h-2.5 w-2.5" /> foto</Badge>}
                    {r.pseudonymized_meta && (
                      <span className="text-xs text-zinc-500">
                        gestript: naam {r.pseudonymized_meta.name}, email {r.pseudonymized_meta.email}, tel {r.pseudonymized_meta.phone}, bsn {r.pseudonymized_meta.bsn}, iban {r.pseudonymized_meta.iban}
                      </span>
                    )}
                    {r.selected_document?.name && (
                      <span className="text-xs text-zinc-500">
                        document: {r.selected_document.name} ({r.selected_document.reason})
                      </span>
                    )}
                    {r.context_counts && (
                      <span className="text-xs text-zinc-500">
                        context: {r.context_counts.notes ?? 0} notities, {r.context_counts.communications ?? 0} comm.
                      </span>
                    )}
                    {r.reason && <span className="text-xs text-red-400">{r.reason}</span>}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const Stat = ({ label, value, sub, accent, icon: Icon }: { label: string; value: number; sub?: string; accent?: 'green' | 'amber' | 'red' | 'purple' | 'blue'; icon?: any }) => {
  const accentClass = {
    green: 'text-green-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    purple: 'text-purple-400',
    blue: 'text-blue-400',
  }[accent ?? 'blue'] ?? 'text-zinc-200';
  return (
    <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <p className={`text-2xl font-bold mt-1 ${accent ? accentClass : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
};

const ResultIcon = ({ status }: { status: BatchResult['status'] }) => {
  if (status === 'queued' || status === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />;
  if (status === 'failed') return <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />;
  return <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />;
};

const statusBadgeClass = (s: BatchResult['status']) => {
  if (s === 'queued' || s === 'completed') return 'border-green-800 text-green-400';
  if (s === 'failed') return 'border-red-800 text-red-400';
  return 'border-amber-800 text-amber-400';
};

export default SuperAdminCvBackfill;
