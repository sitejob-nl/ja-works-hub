import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronRight, Save } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import PlacementHourTypesTab from '@/components/placements/tabs/PlacementHourTypesTab';
import PlacementTravelTypesTab from '@/components/placements/tabs/PlacementTravelTypesTab';
import PlacementAllowancesTab from '@/components/placements/tabs/PlacementAllowancesTab';

const statusBadge: Record<string, string> = {
  gepland: 'bg-blue-100 text-blue-700 border-0',
  actief: 'bg-stat-green/10 text-stat-green border-0',
  afgerond: 'bg-muted text-muted-foreground border-0',
  voortijdig_beeindigd: 'bg-red-100 text-red-600 border-0',
};
const statusLabel: Record<string, string> = {
  gepland: 'Gepland', actief: 'Actief', afgerond: 'Afgerond', voortijdig_beeindigd: 'Voortijdig beëindigd',
};

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

const PlacementDetail = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: placement, isLoading } = useQuery({
    queryKey: ['placement', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('placements')
        .select('*, companies!placements_company_id_fkey(name), employees!placements_employee_id_fkey(id, candidates!employees_candidate_id_fkey(first_name, last_name))')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
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
      work_days: f.work_days.includes(day)
        ? f.work_days.filter((d: string) => d !== day)
        : [...f.work_days, day],
    }));
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!placement) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  const emp = placement.employees as any;
  const cand = emp?.candidates as any;
  const company = placement.companies as any;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/medewerkers" className="hover:text-foreground transition-colors">Medewerkers</Link>
        <ChevronRight className="h-3 w-3" />
        {emp && <Link to={`/medewerkers/${emp.id}`} className="hover:text-foreground transition-colors">{cand?.first_name} {cand?.last_name}</Link>}
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground truncate">Plaatsing</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold truncate">{placement.function_name}</h1>
            <Badge variant="secondary" className={statusBadge[placement.status] ?? ''}>{statusLabel[placement.status] ?? placement.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {cand?.first_name} {cand?.last_name} → {company?.name} · {formatDate(placement.start_date)} t/m {formatDate(placement.end_date)}
          </p>
        </div>
        <div className="flex gap-2">
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

      {/* Main placement info */}
      {editing ? (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Functienaam</Label><Input value={form.function_name} onChange={e => setForm((f: any) => ({ ...f, function_name: e.target.value }))} /></div>
            <div><Label>Startdatum</Label><Input type="date" value={form.start_date} onChange={e => setForm((f: any) => ({ ...f, start_date: e.target.value }))} /></div>
            <div><Label>Einddatum</Label><Input type="date" value={form.end_date} onChange={e => setForm((f: any) => ({ ...f, end_date: e.target.value }))} /></div>
            <div><Label>Uurtarief (€)</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={e => setForm((f: any) => ({ ...f, hourly_rate: e.target.value }))} /></div>
            <div><Label>Overwerktarief (€)</Label><Input type="number" step="0.01" value={form.overtime_rate} onChange={e => setForm((f: any) => ({ ...f, overtime_rate: e.target.value }))} /></div>
            <div><Label>CAO-uren per week</Label><Input type="number" step="0.5" value={form.cao_hours} onChange={e => setForm((f: any) => ({ ...f, cao_hours: e.target.value }))} /></div>
            <div><Label>Werklocatie</Label><Input value={form.work_location} onChange={e => setForm((f: any) => ({ ...f, work_location: e.target.value }))} /></div>
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
                  onClick={() => toggleDay(d)} className="min-w-[40px]">
                  {d}
                </Button>
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
            <div><span className="text-muted-foreground">Seizoenswerk</span><p className="font-medium">{placement.is_seasonal ? 'Ja' : 'Nee'}</p></div>
            <div><span className="text-muted-foreground">Tijd-voor-tijd</span><p className="font-medium">{placement.is_time_for_time ? 'Ja' : 'Nee'}</p></div>
            <div><span className="text-muted-foreground">Werkdagen</span>
              <div className="flex gap-1 mt-0.5">
                {(placement.work_days ?? []).map((d: string) => (
                  <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>
                ))}
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
    </div>
  );
};

export default PlacementDetail;
