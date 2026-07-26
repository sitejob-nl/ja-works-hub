import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, CheckCircle2, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { normalizeFiscalMileagePolicy } from '@/lib/engagement';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const DAY_KEY: Record<number, string> = { 0: 'zo', 1: 'ma', 2: 'di', 3: 'wo', 4: 'do', 5: 'vr', 6: 'za' };
const DEFAULT_WORK_DAYS = ['ma', 'di', 'wo', 'do', 'vr'];

const firstDayOfMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};

const endOfMonth = (startIso: string) => {
  const start = new Date(`${startIso}T00:00:00`);
  return new Date(start.getFullYear(), start.getMonth() + 1, 0).toISOString().slice(0, 10);
};

const daysInPeriod = (startIso: string, endIso: string, workDays: string[] | null | undefined) => {
  const wanted = new Set((workDays?.length ? workDays : DEFAULT_WORK_DAYS).map((day) => day.toLowerCase()));
  let count = 0;
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    if (wanted.has(DAY_KEY[cursor.getDay()])) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

const reviewKey = (review: any) => `${review.candidate_id ?? 'none'}__${review.vehicle_id ?? 'none'}__${review.reason}`;

const FiscalMileageAnalysis = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [periodStart, setPeriodStart] = useState(firstDayOfMonth());
  const periodEnd = useMemo(() => endOfMonth(periodStart), [periodStart]);

  const { data: org } = useQuery({
    queryKey: ['fiscal-mileage-policy', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const policy = normalizeFiscalMileagePolicy((org?.settings as any)?.fiscal_mileage_policy);
  const [draft, setDraft] = useState(policy);

  useEffect(() => {
    setDraft(policy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, org?.settings]);

  const { data: mileageEntries = [] } = useQuery({
    queryKey: ['fiscal-mileage-entries', orgId, periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mileage_entries')
        .select('*, candidates(first_name, last_name), vehicles(license_plate, brand, model)')
        .eq('organization_id', orgId)
        .gte('entry_date', periodStart)
        .lte('entry_date', periodEnd);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: placements = [] } = useQuery({
    queryKey: ['fiscal-mileage-placements', orgId, periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements')
        .select('id, candidate_id, start_date, end_date, work_days, function_name, placement_travel_types(max_km_per_day)')
        .eq('organization_id', orgId)
        .lte('start_date', periodEnd)
        .or(`end_date.is.null,end_date.gte.${periodStart}`);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['fiscal-mileage-reviews', orgId, periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_mileage_reviews' as any)
        .select('*, candidates(first_name, last_name), vehicles(license_plate)')
        .eq('organization_id', orgId)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const savePolicy = useMutation({
    mutationFn: async () => {
      const nextSettings = {
        ...((org?.settings as any) ?? {}),
        fiscal_mileage_policy: draft,
      };
      const { error } = await supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-mileage-policy'] });
      toast.success('Kilometerbeleid opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generateReviews = useMutation({
    mutationFn: async () => {
      if (!policy.analysis_enabled) throw new Error('Fiscale signalering staat uit');
      const existingByKey = new Map(reviews.map((review: any) => [reviewKey(review), review]));
      const groups = new Map<string, any>();

      for (const entry of mileageEntries) {
        const key = `${entry.candidate_id ?? 'none'}__${entry.vehicle_id ?? 'none'}`;
        const distance = Math.max(0, Number(entry.end_km) - Number(entry.start_km));
        const current = groups.get(key) ?? {
          organization_id: orgId,
          candidate_id: entry.candidate_id,
          vehicle_id: entry.vehicle_id,
          candidate: entry.candidates,
          vehicle: entry.vehicles,
          actual_total_km: 0,
          actual_private_km: 0,
          actual_business_km: 0,
          entries: 0,
        };
        current.actual_total_km += distance;
        if (entry.is_private) current.actual_private_km += distance;
        else current.actual_business_km += distance;
        current.entries += 1;
        groups.set(key, current);
      }

      let written = 0;
      for (const group of groups.values()) {
        const candidatePlacements = placements.filter((placement: any) => placement.candidate_id === group.candidate_id);
        const expectedBusinessKm = candidatePlacements.reduce((sum: number, placement: any) => {
          const maxKmPerDay = Number(placement.placement_travel_types?.[0]?.max_km_per_day ?? 0);
          if (!maxKmPerDay) return sum;
          return sum + maxKmPerDay * daysInPeriod(periodStart, periodEnd, placement.work_days);
        }, 0);

        const allowedBusinessKm = expectedBusinessKm > 0 ? expectedBusinessKm * (1 + policy.business_margin_pct / 100) : null;
        const signals: any[] = [];

        if (!expectedBusinessKm && group.actual_business_km > 0) {
          signals.push({ reason: 'missing_expected_km', severity: 'info', excess_km: 0 });
        } else if (allowedBusinessKm != null && group.actual_business_km > allowedBusinessKm) {
          signals.push({
            reason: 'business_above_margin',
            severity: 'warning',
            excess_km: Math.round((group.actual_business_km - allowedBusinessKm) * 100) / 100,
          });
        }

        if (group.actual_private_km > policy.monthly_private_allowance_km) {
          signals.push({
            reason: 'private_above_allowance',
            severity: 'warning',
            excess_km: Math.round((group.actual_private_km - policy.monthly_private_allowance_km) * 100) / 100,
          });
        }

        for (const signal of signals) {
          const payload = {
            organization_id: orgId,
            candidate_id: group.candidate_id,
            vehicle_id: group.vehicle_id,
            placement_id: candidatePlacements[0]?.id ?? null,
            period_start: periodStart,
            period_end: periodEnd,
            actual_total_km: group.actual_total_km,
            actual_private_km: group.actual_private_km,
            actual_business_km: group.actual_business_km,
            expected_business_km: expectedBusinessKm || null,
            business_margin_pct: policy.business_margin_pct,
            private_allowance_km: policy.monthly_private_allowance_km,
            excess_km: signal.excess_km,
            reason: signal.reason,
            severity: signal.severity,
            source_data: {
              entries: group.entries,
              warning: policy.warning_text,
              expected_source: expectedBusinessKm ? 'placement_travel_types.max_km_per_day' : 'missing',
            },
          };
          const existing = existingByKey.get(reviewKey(payload));
          if (existing) {
            const { error } = await supabase.from('fiscal_mileage_reviews' as any).update(payload).eq('id', existing.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('fiscal_mileage_reviews' as any).insert(payload);
            if (error) throw error;
          }
          written++;
        }
      }
      return written;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['fiscal-mileage-reviews'] });
      toast.success(`${count} signaal${count === 1 ? '' : 'en'} bijgewerkt`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateReview = useMutation({
    mutationFn: async ({ id, status, explanation }: { id: string; status: string; explanation?: string }) => {
      const patch: any = {
        status,
        explanation,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id ?? null,
      };
      const { error } = await supabase.from('fiscal_mileage_reviews' as any).update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-mileage-reviews'] });
      toast.success('Review bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setDraftValue = (key: keyof typeof policy, value: any) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calculator className="h-6 w-6" /> Fiscale kilometeranalyse
          </h1>
          <p className="text-muted-foreground text-sm" data-no-translate="true">{policy.warning_text}</p>
        </div>
        <Button onClick={() => generateReviews.mutate()} disabled={generateReviews.isPending} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Analyse draaien
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Beleid en periode</CardTitle>
          <CardDescription>Signalering only: geen fiscale conclusie, geen loon- of payrollactie.</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-5 gap-4 items-end">
          <div>
            <Label htmlFor="fiscal-mileage-period">Maand</Label>
            <Input id="fiscal-mileage-period" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fiscal-mileage-business-margin">Zakelijke marge (%)</Label>
            <Input id="fiscal-mileage-business-margin" type="number" value={draft.business_margin_pct} onChange={(e) => setDraftValue('business_margin_pct', Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="fiscal-mileage-private-allowance">Privémarge per maand (km)</Label>
            <Input id="fiscal-mileage-private-allowance" type="number" value={draft.monthly_private_allowance_km} onChange={(e) => setDraftValue('monthly_private_allowance_km', Number(e.target.value))} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label>Analyse actief</Label>
            <Switch checked={draft.analysis_enabled} onCheckedChange={(v) => setDraftValue('analysis_enabled', v)} />
          </div>
          <Button variant="outline" onClick={() => savePolicy.mutate()} disabled={savePolicy.isPending} className="gap-2">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
          <div className="md:col-span-5">
            <Label>Waarschuwingstekst</Label>
            <Textarea value={draft.warning_text} onChange={(e) => setDraftValue('warning_text', e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Kilometerregels</p><p className="text-2xl font-bold">{mileageEntries.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Open signalen</p><p className="text-2xl font-bold">{reviews.filter((r: any) => r.status === 'open').length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Periode</p><p className="text-sm font-medium">{periodStart} t/m {periodEnd}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reviewlijst</CardTitle>
          <CardDescription>Alle meldingen blijven handmatig te verklaren of accepteren.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medewerker / voertuig</TableHead>
                <TableHead>Reden</TableHead>
                <TableHead className="text-right">Werkelijk</TableHead>
                <TableHead className="text-right">Verwacht</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verklaring</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review: any) => {
                const candidateName = review.candidates ? `${review.candidates.first_name} ${review.candidates.last_name}` : 'Onbekend';
                return (
                  <TableRow key={review.id}>
                    <TableCell>
                      <p className="font-medium">{candidateName}</p>
                      <p className="text-xs text-muted-foreground">{review.vehicles?.license_plate ?? 'Geen voertuig'}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={review.severity === 'urgent' ? 'bg-destructive/10 text-destructive border-0' : ''}>
                        {review.reason === 'business_above_margin' && 'Zakelijk boven marge'}
                        {review.reason === 'private_above_allowance' && 'Privé boven marge'}
                        {review.reason === 'missing_expected_km' && 'Norm ontbreekt'}
                        {review.reason === 'manual_review' && 'Handmatige review'}
                      </Badge>
                      {review.excess_km > 0 && <p className="text-xs text-muted-foreground mt-1">+{Number(review.excess_km).toLocaleString('nl-NL')} km</p>}
                    </TableCell>
                    <TableCell className="text-right">{Number(review.actual_total_km).toLocaleString('nl-NL')} km</TableCell>
                    <TableCell className="text-right">{review.expected_business_km == null ? '—' : `${Number(review.expected_business_km).toLocaleString('nl-NL')} km`}</TableCell>
                    <TableCell>
                      <Select value={review.status} onValueChange={(status) => updateReview.mutate({ id: review.id, status, explanation: review.explanation ?? '' })}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="verklaard">Verklaard</SelectItem>
                          <SelectItem value="geaccepteerd">Geaccepteerd</SelectItem>
                          <SelectItem value="actie_nodig">Actie nodig</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        defaultValue={review.explanation ?? ''}
                        placeholder="Korte verklaring"
                        onBlur={(e) => {
                          if (e.target.value !== (review.explanation ?? '')) {
                            updateReview.mutate({ id: review.id, status: review.status, explanation: e.target.value });
                          }
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {reviews.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Nog geen signalen voor deze periode.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {reviews.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" /> Signalering is dossieropbouw; fiscale beoordeling blijft buiten automatische verwerking.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FiscalMileageAnalysis;
