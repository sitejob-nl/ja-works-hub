import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Users, Merge, ShieldCheck, AlertTriangle, EyeOff, Undo2, PhoneOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { toFriendlyError } from '@/lib/errorMessages';
import { analyzeGroup, type DupCandidate, type GroupAnalysis, type DupVerdict } from '@/lib/duplicate-diff';

interface DupRow extends DupCandidate {
  group_key: string;
  match_reason: string;
  candidate_id: string;
}

interface DupGroup {
  key: string;
  reason: string;
  rows: DupRow[];
  analysis: GroupAnalysis;
}

/** Extra kolommen voor de vergelijking; de RPC levert alleen de detectievelden. */
const COMPARE_COLUMNS = [
  'id', 'first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'nationality',
  'address_street', 'address_postal', 'address_city', 'id_document_number', 'status',
  'employee_number', 'employee_status', 'source', 'skills', 'languages', 'certifications',
  'notes', 'created_at',
].join(', ');

const VERDICT_META: Record<DupVerdict, { title: string; help: string; tone: string }> = {
  mergeable: {
    title: 'Waarschijnlijk dezelfde persoon',
    help: 'De namen passen op elkaar en er botsen geen geboortedatums of personeelsnummers. Velden die maar aan één kant zijn ingevuld worden bij het samenvoegen overgenomen.',
    tone: 'text-stat-green',
  },
  review: {
    title: 'Nakijken',
    help: 'Zelfde persoon volgens de naam, maar er botst iets wat je niet automatisch mag weggooien.',
    tone: 'text-amber-700',
  },
  'not-duplicate': {
    title: 'Waarschijnlijk niet hetzelfde',
    help: 'De namen hebben niets gemeen. Meestal een gedeeld telefoonnummer — een kantoornummer of het nummer van een contactpersoon. Zet zo’n groep weg, dan komt hij niet meer terug.',
    tone: 'text-muted-foreground',
  },
};

const DuplicateCandidates = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: dismissed = [] } = useQuery({
    queryKey: ['duplicate-dismissals', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_duplicate_dismissals' as any)
        .select('group_key')
        .eq('organization_id', orgId);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.group_key as string);
    },
    enabled: !!orgId,
  });

  const { data: allGroups = [], isLoading } = useQuery({
    queryKey: ['duplicate-candidates', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('find_duplicate_candidates');
      if (error) throw error;
      const rpcRows = (data ?? []) as DupRow[];

      // De RPC geeft alleen de velden waarop gegroepeerd wordt. Voor een zinnige
      // vergelijking halen we de rest van de profielen er in één keer bij.
      const ids = Array.from(new Set(rpcRows.map((r) => r.candidate_id)));
      const details = new Map<string, Record<string, unknown>>();
      if (ids.length) {
        const { data: rows, error: detailError } = await supabase
          .from('candidates')
          .select(COMPARE_COLUMNS)
          .in('id', ids);
        if (detailError) throw detailError;
        for (const row of (rows ?? []) as any[]) details.set(row.id, row);
      }

      const byKey = new Map<string, { key: string; reason: string; rows: DupRow[] }>();
      for (const row of rpcRows) {
        const merged: DupRow = { ...(details.get(row.candidate_id) ?? {}), ...row };
        if (!byKey.has(row.group_key)) byKey.set(row.group_key, { key: row.group_key, reason: row.match_reason, rows: [] });
        byKey.get(row.group_key)!.rows.push(merged);
      }
      return Array.from(byKey.values()).map((g) => ({ ...g, analysis: analyzeGroup(g.rows) })) as DupGroup[];
    },
    enabled: !!orgId,
  });

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const groups = useMemo(
    () => allGroups.filter((g) => showDismissed || !dismissedSet.has(g.key)),
    [allGroups, dismissedSet, showDismissed],
  );

  const buckets = useMemo(() => ({
    mergeable: groups.filter((g) => g.analysis.verdict === 'mergeable'),
    review: groups.filter((g) => g.analysis.verdict === 'review'),
    'not-duplicate': groups.filter((g) => g.analysis.verdict === 'not-duplicate'),
  }), [groups]);

  const survivorFor = (group: DupGroup) =>
    survivors[group.key] ?? group.analysis.suggestedSurvivorId ?? group.rows[0].candidate_id;

  const mergeOne = async (group: DupGroup) => {
    const survivorId = survivorFor(group);
    const losers = group.rows.filter((r) => r.candidate_id !== survivorId);
    for (const loser of losers) {
      const { error } = await (supabase as any).rpc('merge_candidate_records', {
        p_survivor: survivorId,
        p_loser: loser.candidate_id,
        p_actor: user?.id ?? null,
      });
      if (error) throw new Error(error.message);
    }
    return losers.length;
  };

  const mergeGroup = useMutation({
    mutationFn: async (group: DupGroup) => {
      const merged = await mergeOne(group);
      if (merged === 0) throw new Error('Kies een ander profiel om te behouden');
      return merged;
    },
    onSuccess: (merged) => {
      qc.invalidateQueries({ queryKey: ['duplicate-candidates', orgId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      toast.success(`${merged} dubbel profiel${merged === 1 ? '' : 'en'} samengevoegd`);
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  // Sequentieel: de RPC werkt per paar en een mislukking mag de rest niet tegenhouden.
  const mergeAll = useMutation({
    mutationFn: async () => {
      const targets = buckets.mergeable;
      let merged = 0;
      const failed: string[] = [];
      setBulkProgress({ done: 0, total: targets.length });
      for (const [index, group] of targets.entries()) {
        try {
          merged += await mergeOne(group);
        } catch (e: any) {
          failed.push(`${group.rows[0]?.last_name ?? group.key}: ${e.message ?? 'onbekende fout'}`);
        }
        setBulkProgress({ done: index + 1, total: targets.length });
      }
      return { merged, failed };
    },
    onSuccess: ({ merged, failed }) => {
      qc.invalidateQueries({ queryKey: ['duplicate-candidates', orgId] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      if (failed.length) {
        toast.warning(`${merged} samengevoegd, ${failed.length} overgeslagen`, { description: failed.slice(0, 3).join(' · ') });
      } else {
        toast.success(`${merged} dubbel profiel${merged === 1 ? '' : 'en'} samengevoegd`);
      }
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
    onSettled: () => setBulkProgress(null),
  });

  const dismiss = useMutation({
    mutationFn: async (group: DupGroup) => {
      const { error } = await supabase.from('candidate_duplicate_dismissals' as any).insert({
        organization_id: orgId,
        group_key: group.key,
        reason: group.analysis.namesCompatible ? null : 'Verschillende namen onder dezelfde sleutel',
        dismissed_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicate-dismissals', orgId] });
      toast.success('Groep weggezet als geen duplicaat');
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const undismiss = useMutation({
    mutationFn: async (group: DupGroup) => {
      const { error } = await supabase
        .from('candidate_duplicate_dismissals' as any)
        .delete()
        .eq('organization_id', orgId)
        .eq('group_key', group.key);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicate-dismissals', orgId] });
      toast.success('Groep staat weer in de lijst');
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const fullName = (r: DupRow) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '(naamloos)';

  const renderGroup = (group: DupGroup) => {
    const survivorId = survivorFor(group);
    const { analysis } = group;
    const isDismissed = dismissedSet.has(group.key);
    const canMerge = !analysis.doubleEmployment && group.rows.length > 1;

    return (
      <Card key={group.key} className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" /> {group.reason} · {group.rows.length} profielen
          </Badge>
          <div className="flex items-center gap-2">
            {isDismissed ? (
              <Button size="sm" variant="outline" onClick={() => undismiss.mutate(group)} className="gap-1.5">
                <Undo2 className="h-3.5 w-3.5" /> Terugzetten
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(group)} className="gap-1.5 text-muted-foreground">
                <EyeOff className="h-3.5 w-3.5" /> Geen duplicaat
              </Button>
            )}
            <Button
              size="sm"
              // Bij een groep die waarschijnlijk geen duplicaat is, hoort samenvoegen
              // niet de opvallendste knop te zijn — dan nodigt het scherm uit tot precies
              // de actie die je daar niet wilt.
              variant={analysis.verdict === 'mergeable' ? 'default' : 'outline'}
              onClick={() => mergeGroup.mutate(group)}
              disabled={mergeGroup.isPending || !canMerge}
              className="gap-1.5"
            >
              <Merge className="h-3.5 w-3.5" /> Samenvoegen in geselecteerde
            </Button>
          </div>
        </div>

        {analysis.doubleEmployment && (
          <p className="text-xs text-amber-700 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Meerdere profielen hebben een dienstverband of payroll-record — samenvoegen moet hier handmatig.
          </p>
        )}
        {analysis.verdict === 'not-duplicate' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <PhoneOff className="h-3.5 w-3.5" />
            De namen hebben niets gemeen. Waarschijnlijk delen deze mensen een telefoonnummer.
          </p>
        )}

        <div className="grid gap-2">
          {group.rows.map((r) => {
            const isSurvivor = r.candidate_id === survivorId;
            return (
              <div
                key={r.candidate_id}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-md border p-3 cursor-pointer transition-colors',
                  isSurvivor ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
                )}
                onClick={() => setSurvivors((s) => ({ ...s, [group.key]: r.candidate_id }))}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/kandidaten/${r.candidate_id}`}
                      className="font-medium text-foreground hover:text-stat-blue"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {fullName(r)}
                    </Link>
                    {isSurvivor && <Badge className="bg-primary/10 text-stat-blue border-0 text-[10px]">Behouden</Badge>}
                    {r.has_employee && <Badge variant="outline" className="text-[10px]">Dienstverband</Badge>}
                    {r.status && <Badge variant="outline" className="text-[10px]">{r.status}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {[r.email, r.phone, r.date_of_birth ? `geb. ${formatDate(r.date_of_birth)}` : null]
                      .filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Aangemaakt {formatDate(r.created_at)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={isSurvivor ? 'secondary' : 'ghost'}
                  className="flex-shrink-0 text-xs h-7"
                  onClick={(e) => { e.stopPropagation(); setSurvivors((s) => ({ ...s, [group.key]: r.candidate_id })); }}
                >
                  {isSurvivor ? 'Behouden' : 'Behoud deze'}
                </Button>
              </div>
            );
          })}
        </div>

        {analysis.diffs.length > 0 ? (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium px-3 py-2 w-40">Verschil</th>
                  {group.rows.map((r) => (
                    <th key={r.candidate_id} className="text-left font-medium px-3 py-2">
                      {fullName(r)}
                      {r.candidate_id === survivorId && <span className="text-stat-blue"> (behouden)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.diffs.map((diff) => (
                  <tr key={diff.key} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2 text-muted-foreground">
                      {diff.label}
                      {diff.blocking && <AlertTriangle className="inline h-3 w-3 ml-1 text-amber-600" />}
                    </td>
                    {diff.values.map((value) => (
                      <td
                        key={value.candidateId}
                        className={cn('px-3 py-2', !value.filled && 'text-muted-foreground')}
                      >
                        {value.filled ? <span className="line-clamp-3 break-words">{value.display}</span> : 'leeg'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">
              Alleen velden die aan beide kanten zijn ingevuld en van elkaar afwijken. Wat maar aan één kant staat,
              wordt bij het samenvoegen overgenomen. Van het profiel dat verdwijnt blijft de volledige inhoud in het
              auditlogboek staan.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Geen botsende velden — de profielen vullen elkaar aan.</p>
        )}
      </Card>
    );
  };

  const renderBucket = (verdict: DupVerdict) => {
    const list = buckets[verdict];
    if (!list.length) return null;
    const meta = VERDICT_META[verdict];
    return (
      <section className="space-y-3">
        <div>
          <h2 className={cn('text-sm font-semibold', meta.tone)}>{meta.title} · {list.length}</h2>
          <p className="text-xs text-muted-foreground max-w-3xl">{meta.help}</p>
        </div>
        {verdict === 'mergeable' && list.length > 1 && (
          <Button onClick={() => setBulkOpen(true)} disabled={mergeAll.isPending} className="gap-1.5">
            <Merge className="h-3.5 w-3.5" />
            {mergeAll.isPending && bulkProgress
              ? `Bezig… ${bulkProgress.done}/${bulkProgress.total}`
              : `Alle ${list.length} groepen samenvoegen`}
          </Button>
        )}
        {list.map(renderGroup)}
      </section>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link to="/kandidaten" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Kandidaten
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold">Duplicatenbeheer</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Mogelijke dubbele kandidaten op basis van telefoonnummer of geboortedatum + achternaam,
              gesorteerd op hoe zeker het is. Kies per groep welk profiel je behoudt; de rest wordt erin samengevoegd.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dismissed.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowDismissed((v) => !v)} className="gap-1.5">
                <EyeOff className="h-3.5 w-3.5" />
                {showDismissed ? 'Weggezette verbergen' : `Weggezet (${dismissed.length})`}
              </Button>
            )}
            {!isLoading && <Badge variant="outline">{groups.length} groep{groups.length === 1 ? '' : 'en'}</Badge>}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldCheck className="h-12 w-12 text-stat-green/50 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Geen mogelijke duplicaten gevonden</p>
          <p className="text-sm text-muted-foreground">Je kandidatenbestand is schoon op telefoon en geboortedatum + naam.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {renderBucket('mergeable')}
          {renderBucket('review')}
          {renderBucket('not-duplicate')}
        </div>
      )}

      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{buckets.mergeable.length} groepen samenvoegen?</AlertDialogTitle>
            <AlertDialogDescription>
              Per groep blijft het voorgestelde profiel staan — dat met een dienstverband, anders het meest
              ingevulde. De andere profielen verdwijnen en hun gegevens gaan over naar het profiel dat blijft.
              Dit is niet met één knop terug te draaien; wat verdwijnt staat wel volledig in het auditlogboek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={() => mergeAll.mutate()}>Samenvoegen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DuplicateCandidates;
