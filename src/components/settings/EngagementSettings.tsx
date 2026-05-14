import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus, Save, Star, TicketCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { DEFAULT_ENGAGEMENT_SETTINGS, normalizeEngagementSettings } from '@/lib/engagement';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const REDEMPTION_STATUSES = ['aangevraagd', 'goedgekeurd', 'uitgegeven', 'geannuleerd'] as const;

const EngagementSettings = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [rewardForm, setRewardForm] = useState({ id: '', name: '', description: '', points_cost: '120', is_active: true });
  const [adjustForm, setAdjustForm] = useState({ candidate_id: '', points: '', description: '' });

  const { data: org } = useQuery({
    queryKey: ['engagement-org-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const settings = normalizeEngagementSettings((org?.settings as any)?.engagement_settings);
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, org?.settings]);

  const { data: templates = [] } = useQuery({
    queryKey: ['birthday-email-templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates' as any)
        .select('id, name, subject, category')
        .eq('organization_id', orgId)
        .order('name');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: rewards = [] } = useQuery({
    queryKey: ['reward-catalog', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reward_catalog' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: redemptions = [] } = useQuery({
    queryKey: ['reward-redemptions', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reward_redemptions' as any)
        .select('*, candidates(first_name, last_name), reward_catalog(name)')
        .eq('organization_id', orgId)
        .order('requested_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ['loyalty-candidates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, employee_number')
        .eq('organization_id', orgId)
        .in('employee_status', ['actief', 'onboarding'])
        .order('last_name')
        .limit(250);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const nextSettings = {
        ...((org?.settings as any) ?? {}),
        engagement_settings: draft,
      };
      const { error } = await supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement-org-settings', orgId] });
      toast.success('Engagement-instellingen opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveReward = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        name: rewardForm.name.trim(),
        description: rewardForm.description.trim() || null,
        points_cost: Number(rewardForm.points_cost),
        is_active: rewardForm.is_active,
        created_by: user?.id ?? null,
      };
      if (!payload.name || !payload.points_cost) throw new Error('Naam en punten zijn verplicht');
      if (rewardForm.id) {
        const { error } = await supabase.from('reward_catalog' as any).update(payload).eq('id', rewardForm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('reward_catalog' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reward-catalog'] });
      setRewardForm({ id: '', name: '', description: '', points_cost: '120', is_active: true });
      toast.success('Reward opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateRedemption = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const now = new Date().toISOString();
      const patch: any = { status, handled_by: user?.id ?? null };
      if (status === 'goedgekeurd' || status === 'geannuleerd') patch.decided_at = now;
      if (status === 'uitgegeven') patch.fulfilled_at = now;
      const { error } = await supabase.from('reward_redemptions' as any).update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reward-redemptions'] });
      toast.success('Aanvraag bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const adjustPoints = useMutation({
    mutationFn: async () => {
      const points = Number(adjustForm.points);
      if (!adjustForm.candidate_id || !points || !adjustForm.description.trim()) {
        throw new Error('Kies een medewerker, vul punten en reden in');
      }
      const { error } = await supabase.rpc('admin_adjust_loyalty_points' as any, {
        p_candidate_id: adjustForm.candidate_id,
        p_points: points,
        p_description: adjustForm.description.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAdjustForm({ candidate_id: '', points: '', description: '' });
      toast.success('Punten gecorrigeerd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setDraftValue = (key: keyof typeof DEFAULT_ENGAGEMENT_SETTINGS, value: any) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4" /> Verjaardagen, punten & rewards
        </CardTitle>
        <CardDescription>Configureer birthday-campagnes, loyaltysaldo en de eenvoudige reward-shop.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Birthday-campagne actief</Label>
              <p className="text-xs text-muted-foreground">Dagelijkse job draait rond 07:00.</p>
            </div>
            <Switch checked={draft.birthday_enabled} onCheckedChange={(v) => setDraftValue('birthday_enabled', v)} />
          </div>
          <div>
            <Label>Bonuspunten verjaardag</Label>
            <Input type="number" min={0} value={draft.birthday_bonus_points} onChange={(e) => setDraftValue('birthday_bonus_points', Number(e.target.value))} />
          </div>
          <div>
            <Label>Verzendtijd</Label>
            <Input
              type="time"
              value={draft.birthday_send_time}
              onChange={(e) => setDraftValue('birthday_send_time', e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">De cron draait elk uur; tijden met minuten worden op de eerstvolgende run verwerkt.</p>
          </div>
          <div>
            <Label>E-mailtemplate</Label>
            <Select value={draft.birthday_email_template_id ?? 'none'} onValueChange={(v) => setDraftValue('birthday_email_template_id', v === 'none' ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Standaard birthday-mail</SelectItem>
                {templates.map((template: any) => (
                  <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>E-mail versturen</Label>
              <p className="text-xs text-muted-foreground">Via de standaard Outlook-afzender indien gekoppeld.</p>
            </div>
            <Switch checked={draft.birthday_email_enabled} onCheckedChange={(v) => setDraftValue('birthday_email_enabled', v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Portaalmelding / push</Label>
              <p className="text-xs text-muted-foreground">Maakt een portaalnotificatie aan; device-push volgt kanaalbeschikbaarheid.</p>
            </div>
            <Switch checked={draft.birthday_push_enabled} onCheckedChange={(v) => setDraftValue('birthday_push_enabled', v)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Standaardbericht</Label>
            <Textarea value={draft.birthday_message} onChange={(e) => setDraftValue('birthday_message', e.target.value)} rows={3} />
          </div>
        </div>
        <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="gap-2">
          <Save className="h-4 w-4" /> Instellingen opslaan
        </Button>

        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4">
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium text-sm"><Star className="h-4 w-4" /> Reward toevoegen</div>
            <div><Label>Naam</Label><Input value={rewardForm.name} onChange={(e) => setRewardForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Punten</Label><Input type="number" min={1} value={rewardForm.points_cost} onChange={(e) => setRewardForm((f) => ({ ...f, points_cost: e.target.value }))} /></div>
            <div><Label>Omschrijving</Label><Textarea value={rewardForm.description} onChange={(e) => setRewardForm((f) => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div className="flex items-center justify-between"><Label>Actief in shop</Label><Switch checked={rewardForm.is_active} onCheckedChange={(v) => setRewardForm((f) => ({ ...f, is_active: v }))} /></div>
            <Button onClick={() => saveReward.mutate()} disabled={saveReward.isPending} className="w-full gap-2">
              <Plus className="h-4 w-4" /> Reward opslaan
            </Button>
          </div>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reward</TableHead>
                  <TableHead>Punten</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map((reward: any) => (
                  <TableRow key={reward.id} className="cursor-pointer" onClick={() => setRewardForm({
                    id: reward.id,
                    name: reward.name,
                    description: reward.description ?? '',
                    points_cost: String(reward.points_cost),
                    is_active: reward.is_active,
                  })}>
                    <TableCell className="font-medium">{reward.name}</TableCell>
                    <TableCell>{reward.points_cost}</TableCell>
                    <TableCell><Badge variant="secondary">{reward.is_active ? 'Actief' : 'Inactief'}</Badge></TableCell>
                  </TableRow>
                ))}
                {rewards.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Nog geen rewards</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium text-sm"><TicketCheck className="h-4 w-4" /> Handmatige puntencorrectie</div>
          <div className="grid sm:grid-cols-[1fr_120px_1.2fr_auto] gap-2 items-end">
            <div>
              <Label>Medewerker</Label>
              <Select value={adjustForm.candidate_id} onValueChange={(v) => setAdjustForm((f) => ({ ...f, candidate_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Kies medewerker" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate: any) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.first_name} {candidate.last_name}{candidate.employee_number ? ` (${candidate.employee_number})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Punten</Label><Input type="number" value={adjustForm.points} onChange={(e) => setAdjustForm((f) => ({ ...f, points: e.target.value }))} placeholder="+/-" /></div>
            <div><Label>Reden</Label><Input value={adjustForm.description} onChange={(e) => setAdjustForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <Button onClick={() => adjustPoints.mutate()} disabled={adjustPoints.isPending}>Boeken</Button>
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aanvraag</TableHead>
                <TableHead>Reward</TableHead>
                <TableHead>Punten</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {redemptions.map((redemption: any) => {
                const candidate = redemption.candidates;
                return (
                  <TableRow key={redemption.id}>
                    <TableCell>{candidate ? `${candidate.first_name} ${candidate.last_name}` : '—'}</TableCell>
                    <TableCell>{redemption.reward_catalog?.name ?? '—'}</TableCell>
                    <TableCell>{redemption.points_cost}</TableCell>
                    <TableCell>
                      <Select value={redemption.status} onValueChange={(status) => updateRedemption.mutate({ id: redemption.id, status })}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {REDEMPTION_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
              {redemptions.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nog geen aanvragen</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default EngagementSettings;
