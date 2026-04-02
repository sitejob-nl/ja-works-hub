import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ChevronRight, Save, Building2, User, FileText, XCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { payrollerLabel } from '@/lib/payroller';
import PlacementHourTypesTab from '@/components/placements/tabs/PlacementHourTypesTab';
import PlacementTravelTypesTab from '@/components/placements/tabs/PlacementTravelTypesTab';
import PlacementAllowancesTab from '@/components/placements/tabs/PlacementAllowancesTab';
import { useTrackPageVisit } from '@/hooks/useTrackPageVisit';

const statusBadge: Record<string, string> = {
  gepland: 'bg-blue-100 text-blue-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  gepland: 'Gepland', actief: 'Actief', afgerond: 'Afgerond', voortijdig_beeindigd: 'Voortijdig beëindigd',
};
const housingPaymentLabel: Record<string, string> = {
  betaald: 'Betaald door medewerker', inhouding: 'Inhouding via payroller', gratis: 'Gratis huisvesting',
};

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

const PlacementDetail = () => {
  const { id } = useParams<{ id: string }>();
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showTerminate, setShowTerminate] = useState(false);

  const { data: placement, isLoading } = useQuery({
    queryKey: ['placement', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('placements')
        .select('*, companies!placements_company_id_fkey(id, name), employees!placements_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const candidateName = placement?.employees?.candidates
    ? `${placement.employees.candidates.first_name} ${placement.employees.candidates.last_name}`
    : placement?.function_name ?? 'Plaatsing';
  const placementSublabel = placement?.companies && placement?.function_name
    ? `${(placement.companies as any).name} - ${placement.function_name}`
    : undefined;

  useTrackPageVisit({
    id,
    type: 'plaatsing',
    label: candidateName,
    sublabel: placementSublabel,
  });

  const [form, setForm] = useState<any>({});

  const startEdit = () => {
    if (!placement) return;
    setForm({
      is_seasonal: placement.is_seasonal ?? false,
      is_time_for_time: placement.is_time_for_time ?? false,
      cao_hours: placement.cao_hours ?? '',
      work_days: placement.work_days ?? [],
      work_location: placement.work_location ?? '',
      hourly_rate: placement.hourly_rate,
      overtime_rate: placement.overtime_rate ?? '',
      function_name: placement.function_name,
      start_date: placement.start_date,
      end_date: placement.end_date ?? '',
      expected_end_date: placement.expected_end_date ?? '',
      payroller: placement.payroller ?? '',
      housing_payment_type: placement.housing_payment_type ?? '',
      salary_indication: placement.salary_indication ?? '',
    });
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('placements').update({
        is_seasonal: form.is_seasonal,
        is_time_for_time: form.is_time_for_time,
        cao_hours: form.cao_hours ? parseFloat(form.cao_hours) : null,
        work_days: form.work_days.length > 0 ? form.work_days : null,
        work_location: form.work_location || null,
        hourly_rate: parseFloat(form.hourly_rate),
        overtime_rate: form.overtime_rate ? parseFloat(form.overtime_rate) : null,
        function_name: form.function_name,
        start_date: form.start_date,
        end_date: form.end_date || null,
        expected_end_date: form.expected_end_date || null,
        payroller: form.payroller || null,
        housing_payment_type: form.housing_payment_type || null,
        salary_indication: form.salary_indication || null,
      }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['placement', id] });
      setEditing(false);
      toast.success('Plaatsing bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleDay = (day: string) => {
    setForm((f: any) => ({
      ...f,
      work_days: f.work_days.includes(day) ? f.work_days.filter((d: string) => d !== day) : [...f.work_days, day],
    }));
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!placement) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  const emp = placement.employees as any;
  const cand = emp?.candidates as any;
  const company = placement.companies as any;
  const canTerminate = placement.status === 'actief' || placement.status === 'gepland';

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      {/* Breadcrumb + Quick links */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link to="/plaatsingen" className="hover:text-foreground transition-colors">Plaatsingen</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground truncate">{placement.function_name}</span>
        </div>
        <div className="flex items-center gap-2">
          {company && <Link to={`/opdrachtgevers/${company.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"><Building2 className="h-3 w-3" />{company.name}</Link>}
          {emp && <Link to={`/medewerkers/${emp.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"><User className="h-3 w-3" />{cand?.first_name} {cand?.last_name}</Link>}
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold truncate">{placement.function_name}</h1>
            <Badge variant="secondary" className={statusBadge[placement.status] ?? ''}>{statusLabel[placement.status] ?? placement.status}</Badge>
            {placement.payroller && <Badge variant="outline" className="text-xs">{payrollerLabel[placement.payroller] ?? placement.payroller}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {cand?.first_name} {cand?.last_name} → {company?.name} · {formatDate(placement.start_date)} t/m {formatDate(placement.expected_end_date || placement.end_date)}
          </p>
        </div>
        <div className="flex gap-2">
          {canTerminate && (
            <Button variant="destructive" size="sm" onClick={() => setShowTerminate(true)} className="gap-1">
              <XCircle className="h-3.5 w-3.5" /> Beëindigen
            </Button>
          )}
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>Bewerken</Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Annuleren</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-1.5">
                <Save className="h-3.5 w-3.5" /> Opslaan
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Terminated info */}
      {placement.terminated_by && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
          <p className="font-medium text-red-800">Beëindigd door: {placement.terminated_by}</p>
          {placement.termination_reason && <p className="text-red-700">Reden: {placement.termination_reason}</p>}
          {placement.termination_notes && <p className="text-red-600 mt-1">{placement.termination_notes}</p>}
          {placement.terminated_at && <p className="text-red-500 text-xs mt-1">Op {formatDate(placement.terminated_at)}</p>}
        </div>
      )}

      {/* Main placement info */}
      {editing ? (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Functienaam</Label><Input value={form.function_name} onChange={e => setForm((f: any) => ({ ...f, function_name: e.target.value }))} /></div>
            <div><Label>Startdatum</Label><Input type="date" value={form.start_date} onChange={e => setForm((f: any) => ({ ...f, start_date: e.target.value }))} /></div>
            <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={e => setForm((f: any) => ({ ...f, end_date: e.target.value }))} /></div>
            <div><Label>Verwachte einddatum</Label><Input type="date" value={form.expected_end_date} onChange={e => setForm((f: any) => ({ ...f, expected_end_date: e.target.value }))} /></div>
            <div><Label>Uurtarief (€)</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={e => setForm((f: any) => ({ ...f, hourly_rate: e.target.value }))} /></div>
            <div><Label>Overwerktarief (€)</Label><Input type="number" step="0.01" value={form.overtime_rate} onChange={e => setForm((f: any) => ({ ...f, overtime_rate: e.target.value }))} /></div>
            <div><Label>CAO-uren per week</Label><Input type="number" step="0.5" value={form.cao_hours} onChange={e => setForm((f: any) => ({ ...f, cao_hours: e.target.value }))} /></div>
            <div><Label>Werklocatie</Label><Input value={form.work_location} onChange={e => setForm((f: any) => ({ ...f, work_location: e.target.value }))} /></div>
            <div>
              <Label>Payroller / Verloningswijze</Label>
              <Select value={form.payroller} onValueChange={v => setForm((f: any) => ({ ...f, payroller: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flexpedia">Flexpedia</SelectItem>
                  <SelectItem value="brioworks">BrioWorks (Portugal)</SelectItem>
                  <SelectItem value="bromida">Bromida (Litouwen)</SelectItem>
                  <SelectItem value="retiva">Retiva / A1</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Huisvesting betaling</Label>
              <Select value={form.housing_payment_type} onValueChange={v => setForm((f: any) => ({ ...f, housing_payment_type: v }))}>
                <SelectTrigger><SelectValue placeholder="N.v.t." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="betaald">Betaald door medewerker</SelectItem>
                  <SelectItem value="inhouding">Inhouding via payroller</SelectItem>
                  <SelectItem value="gratis">Gratis huisvesting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Salarisindicatie</Label><Input value={form.salary_indication} onChange={e => setForm((f: any) => ({ ...f, salary_indication: e.target.value }))} placeholder="bijv. 3000-4000" /></div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={form.is_seasonal} onCheckedChange={v => setForm((f: any) => ({ ...f, is_seasonal: v }))} />
              <Label>Seizoenswerk</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_time_for_time} onCheckedChange={v => setForm((f: any) => ({ ...f, is_time_for_time: v }))} />
              <Label>Tijd-voor-tijd</Label>
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Werkdagen</Label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map(d => (
                <Button key={d} size="sm" variant={form.work_days.includes(d) ? 'default' : 'outline'}
                  onClick={() => toggleDay(d)} className="min-w-[40px]">{d}</Button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border rounded-lg p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">Uurtarief</span><p className="font-medium">{formatEUR(placement.hourly_rate)}</p></div>
            <div><span className="text-muted-foreground">Overwerktarief</span><p className="font-medium">{formatEUR(placement.overtime_rate)}</p></div>
            <div><span className="text-muted-foreground">CAO-uren/week</span><p className="font-medium">{placement.cao_hours ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Werklocatie</span><p className="font-medium">{placement.work_location ?? '—'}</p></div>
            <div><span className="text-muted-foreground">Payroller</span><p className="font-medium">{placement.payroller ? payrollerLabel[placement.payroller] ?? placement.payroller : '—'}</p></div>
            <div><span className="text-muted-foreground">Verwachte einddatum</span><p className="font-medium">{formatDate(placement.expected_end_date) || '—'}</p></div>
            <div><span className="text-muted-foreground">Huisvesting</span><p className="font-medium">{placement.housing_payment_type ? housingPaymentLabel[placement.housing_payment_type] : '—'}</p></div>
            <div><span className="text-muted-foreground">Salarisindicatie</span><p className="font-medium">{placement.salary_indication ? `€ ${placement.salary_indication}` : '—'}</p></div>
            <div><span className="text-muted-foreground">Seizoenswerk</span><p className="font-medium">{placement.is_seasonal ? 'Ja' : 'Nee'}</p></div>
            <div><span className="text-muted-foreground">Tijd-voor-tijd</span><p className="font-medium">{placement.is_time_for_time ? 'Ja' : 'Nee'}</p></div>
            <div><span className="text-muted-foreground">Werkdagen</span>
              <div className="flex gap-1 mt-0.5">
                {(placement.work_days ?? []).map((d: string) => <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>)}
                {(!placement.work_days || placement.work_days.length === 0) && <span className="text-muted-foreground">—</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="uurtypes">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="uurtypes">Uurtypes</TabsTrigger>
            <TabsTrigger value="reistypes">Reistypes</TabsTrigger>
            <TabsTrigger value="vergoedingen">Vergoedingen</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="uurtypes"><PlacementHourTypesTab placementId={id!} organizationId={placement.organization_id} /></TabsContent>
        <TabsContent value="reistypes"><PlacementTravelTypesTab placementId={id!} organizationId={placement.organization_id} /></TabsContent>
        <TabsContent value="vergoedingen"><PlacementAllowancesTab placementId={id!} organizationId={placement.organization_id} /></TabsContent>
      </Tabs>

      {/* Termination Dialog */}
      <TerminationDialog
        open={showTerminate}
        onOpenChange={setShowTerminate}
        placementId={id!}
        orgId={orgId}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['placement', id] });
          setShowTerminate(false);
        }}
      />
    </div>
  );
};

// ─── Termination Dialog ───
function TerminationDialog({ open, onOpenChange, placementId, orgId, onSuccess }: {
  open: boolean; onOpenChange: (o: boolean) => void; placementId: string; orgId: string; onSuccess: () => void;
}) {
  const [terminatedBy, setTerminatedBy] = useState<string>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);

  // Fetch termination reasons filtered by terminated_by
  const { data: reasons } = useQuery({
    queryKey: ['termination-reasons', orgId, terminatedBy],
    queryFn: async () => {
      if (!terminatedBy) return [];
      const { data, error } = await supabase.from('termination_reasons')
        .select('*').eq('organization_id', orgId).eq('terminated_by', terminatedBy).eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!terminatedBy,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('placements').update({
        status: 'voortijdig_beeindigd',
        terminated_by: terminatedBy,
        termination_reason: reason,
        termination_notes: notes || null,
        terminated_at: new Date().toISOString(),
        end_date: new Date().toISOString().split('T')[0],
      }).eq('id', placementId);
      if (error) throw error;
      logAudit({ action: 'update', tableName: 'placements', recordId: placementId, newValues: { status: 'voortijdig_beeindigd', terminated_by: terminatedBy, termination_reason: reason } });
    },
    onSuccess: () => { toast.success('Plaatsing beëindigd'); onSuccess(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plaatsing beëindigen</DialogTitle>
          <DialogDescription>Deze actie kan niet eenvoudig ongedaan worden gemaakt.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Door wie beëindigd? *</Label>
            <Select value={terminatedBy} onValueChange={v => { setTerminatedBy(v); setReason(''); }}>
              <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="opdrachtgever">Opdrachtgever</SelectItem>
                <SelectItem value="medewerker">Medewerker</SelectItem>
                <SelectItem value="uitzendbureau">Uitzendbureau</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {terminatedBy && (
            <div>
              <Label>Reden *</Label>
              {(reasons ?? []).length > 0 ? (
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue placeholder="Selecteer reden..." /></SelectTrigger>
                  <SelectContent>
                    {(reasons ?? []).map((r: any) => <SelectItem key={r.id} value={r.reason}>{r.reason}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Vul de reden in" />
              )}
            </div>
          )}

          <div>
            <Label>Toelichting (optioneel)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Eventuele extra informatie..." rows={3} />
          </div>

          {!confirm ? (
            <Button variant="destructive" disabled={!terminatedBy || !reason} onClick={() => setConfirm(true)} className="w-full">
              Bevestig beëindiging
            </Button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-sm text-red-800 font-medium">Weet je het zeker?</p>
              <p className="text-xs text-red-600">De plaatsing wordt definitief beëindigd. Contacteer een beheerder om dit ongedaan te maken.</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Annuleren</Button>
                <Button variant="destructive" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                  {mutation.isPending ? 'Bezig...' : 'Ja, beëindigen'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PlacementDetail;
