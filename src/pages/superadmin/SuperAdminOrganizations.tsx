import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Building2, Search, Settings2, Wallet } from 'lucide-react';

const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

const ALL_MODULES = [
  { key: 'workbench', label: 'Workbench', group: 'Kern' },
  { key: 'opdrachtgevers', label: 'Opdrachtgevers', group: 'Kern' },
  { key: 'kandidaten', label: 'Kandidaten', group: 'Kern' },
  { key: 'medewerkers', label: 'Medewerkers', group: 'Kern' },
  { key: 'vacatures', label: 'Vacatures', group: 'Kern' },
  { key: 'planning', label: 'Planning', group: 'Kern' },
  { key: 'uren', label: 'Uren', group: 'Kern' },
  { key: 'huisvesting', label: 'Huisvesting', group: 'Vastgoed & Fleet' },
  { key: 'transport', label: 'Transport', group: 'Vastgoed & Fleet' },
  { key: 'tankpas-analyse', label: 'Tankpas analyse', group: 'Vastgoed & Fleet' },
  { key: 'communicatie', label: 'Communicatie', group: 'Communicatie' },
  { key: 'whatsapp', label: 'WhatsApp', group: 'Communicatie' },
  { key: 'bulk-campaigns', label: 'Bulk Campagnes', group: 'Communicatie' },
  { key: 'kennisbank', label: 'Kennisbank', group: 'Tools' },
  { key: 'vacaturebank', label: 'Vacaturebank', group: 'Tools' },
  { key: 'kandidaten-zoeken', label: 'Kandidaten zoeken', group: 'Tools' },
  { key: 'exact-online', label: 'Exact Online', group: 'Integraties' },
  { key: 'importeren', label: 'Importeren', group: 'Tools' },
  { key: 'cv-tool', label: 'CV Herschrijf-tool', group: 'AI Modules' },
  { key: 'ai-analyse', label: 'AI Kandidaat-analyse', group: 'AI Modules' },
  { key: 'ai-matching', label: 'AI Matching', group: 'AI Modules' },
  { key: 'ai-prioriteiten', label: 'AI Recruiter Prioriteiten', group: 'AI Modules' },
];

const SuperAdminOrganizations = () => {
  const [search, setSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [creditsOrg, setCreditsOrg] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const queryClient = useQueryClient();

  const { data: orgs, isLoading } = useQuery({
    queryKey: ['sa-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_organizations');
      if (error) throw error;
      return data;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ['sa-plans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subscription_plans').select('*');
      if (error) throw error;
      return data;
    },
  });

  const { data: orgModules } = useQuery({
    queryKey: ['sa-org-modules', selectedOrg?.id],
    enabled: !!selectedOrg,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_modules')
        .select('*')
        .eq('organization_id', selectedOrg.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: allCredits } = useQuery({
    queryKey: ['sa-all-credits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_credits')
        .select('organization_id, balance_cents, lifetime_topped_up_cents');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: creditDetails } = useQuery({
    queryKey: ['sa-credit-detail', creditsOrg?.id],
    enabled: !!creditsOrg,
    queryFn: async () => {
      const [creditsRes, topupsRes, usageRes] = await Promise.all([
        supabase
          .from('organization_credits')
          .select('balance_cents, lifetime_topped_up_cents, pricing_input_cents_per_mtok, pricing_output_cents_per_mtok, updated_at')
          .eq('organization_id', creditsOrg.id)
          .maybeSingle(),
        supabase
          .from('credit_topups')
          .select('id, amount_cents, note, created_at')
          .eq('organization_id', creditsOrg.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('ai_usage_log')
          .select('id, provider, model, input_tokens, output_tokens, cost_cents, duration_ms, created_at')
          .eq('organization_id', creditsOrg.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      return {
        credits: creditsRes.data,
        topups: topupsRes.data ?? [],
        usage: usageRes.data ?? [],
      };
    },
  });

  const topup = useMutation({
    mutationFn: async ({ orgId, amountCents, note }: { orgId: string; amountCents: number; note: string }) => {
      const { data, error } = await supabase.rpc('topup_ai_credits', {
        p_org_id: orgId,
        p_amount_cents: amountCents,
        p_note: note || null,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (newBalance) => {
      queryClient.invalidateQueries({ queryKey: ['sa-credit-detail', creditsOrg?.id] });
      queryClient.invalidateQueries({ queryKey: ['sa-all-credits'] });
      toast.success(`Saldo bijgewerkt: ${formatEuro(newBalance)}`);
      setTopupAmount('');
      setTopupNote('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleTopup = () => {
    const euros = parseFloat(topupAmount.replace(',', '.'));
    if (!isFinite(euros) || euros === 0) {
      toast.error('Vul een geldig bedrag in (kan negatief zijn voor correctie)');
      return;
    }
    const cents = Math.round(euros * 100);
    topup.mutate({ orgId: creditsOrg.id, amountCents: cents, note: topupNote });
  };

  const toggleActive = useMutation({
    mutationFn: async ({ orgId, active }: { orgId: string; active: boolean }) => {
      const { error } = await supabase.rpc('sa_update_org_active', { org_uuid: orgId, active });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa-orgs'] });
      toast.success('Organisatie status bijgewerkt');
    },
  });

  const updatePlan = useMutation({
    mutationFn: async ({ orgId, planId }: { orgId: string; planId: string }) => {
      const { error } = await supabase.rpc('sa_update_org_plan', { org_uuid: orgId, new_plan_id: planId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa-orgs'] });
      toast.success('Abonnement bijgewerkt');
    },
  });

  const toggleModule = useMutation({
    mutationFn: async ({ orgId, moduleName, enabled }: { orgId: string; moduleName: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('organization_modules')
        .upsert(
          { organization_id: orgId, module_name: moduleName, enabled },
          { onConflict: 'organization_id,module_name' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa-org-modules'] });
      toast.success('Module bijgewerkt');
    },
  });

  const filtered = orgs?.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const getModuleEnabled = (moduleName: string): boolean => {
    const override = orgModules?.find(m => m.module_name === moduleName);
    if (override) return override.enabled;
    // Fall back to plan modules
    if (selectedOrg?.plan_id && plans) {
      const plan = plans.find(p => p.id === selectedOrg.plan_id);
      return plan?.modules?.includes(moduleName) ?? true;
    }
    return true;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Organisaties</h1>
        <p className="text-zinc-400 text-sm">Beheer alle organisaties, abonnementen en modules</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Zoek op naam of slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
          />
        </div>
        <span className="text-zinc-500 text-sm">{filtered.length} organisaties</span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left">
              <th className="px-4 py-3 font-medium">Organisatie</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Abonnement</th>
              <th className="px-4 py-3 font-medium">Saldo</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Acties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((org) => {
              const plan = plans?.find(p => p.id === org.plan_id);
              const orgCredits = allCredits?.find(c => c.organization_id === org.id);
              const balance = orgCredits?.balance_cents ?? 0;
              const lowBalance = balance < 100;
              return (
                <tr key={org.id} className="hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {org.logo_url ? (
                        <img src={org.logo_url} alt="" className="h-6 w-6 rounded object-contain" />
                      ) : (
                        <div className="h-6 w-6 rounded bg-zinc-700 flex items-center justify-center">
                          <Building2 className="h-3 w-3 text-zinc-400" />
                        </div>
                      )}
                      <span className="text-white font-medium">{org.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{org.slug}</td>
                  <td className="px-4 py-3">
                    <Select
                      value={org.plan_id ?? ''}
                      onValueChange={(v) => updatePlan.mutate({ orgId: org.id, planId: v })}
                    >
                      <SelectTrigger className="w-36 h-8 bg-zinc-800 border-zinc-700 text-white text-xs">
                        <SelectValue placeholder="Geen plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans?.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setCreditsOrg(org)}
                      className={`text-sm font-mono hover:underline ${
                        lowBalance ? 'text-orange-400' : 'text-zinc-300'
                      }`}
                    >
                      {formatEuro(balance)}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={org.is_active ? 'default' : 'secondary'}
                      className={org.is_active ? 'bg-green-900/50 text-green-400 hover:bg-green-900/70' : 'bg-red-900/50 text-red-400'}>
                      {org.is_active ? 'Actief' : 'Inactief'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={org.is_active}
                        onCheckedChange={(v) => toggleActive.mutate({ orgId: org.id, active: v })}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-400 hover:text-white"
                        onClick={() => setCreditsOrg(org)}
                        title="Credits beheren"
                      >
                        <Wallet className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-400 hover:text-white"
                        onClick={() => setSelectedOrg(org)}
                        title="Modules beheren"
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isLoading && <p className="text-zinc-500 text-center py-8">Laden...</p>}
        {!isLoading && filtered.length === 0 && <p className="text-zinc-500 text-center py-8">Geen organisaties gevonden</p>}
      </div>

      {/* Module config sheet */}
      <Sheet open={!!selectedOrg} onOpenChange={() => setSelectedOrg(null)}>
        <SheetContent className="bg-zinc-900 border-zinc-800 text-white">
          <SheetHeader>
            <SheetTitle className="text-white">Modules — {selectedOrg?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4 overflow-y-auto max-h-[calc(100vh-8rem)]">
            <p className="text-zinc-400 text-sm">Schakel modules in of uit voor deze organisatie. Overrides hebben voorrang op het abonnement.</p>
            <div className="space-y-5 pb-4">
              {Array.from(new Set(ALL_MODULES.map(m => m.group))).map(group => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 px-1">{group}</p>
                  <div className="space-y-2">
                    {ALL_MODULES.filter(m => m.group === group).map((mod) => (
                      <div key={mod.key} className="flex items-center justify-between py-2 px-3 bg-zinc-800 rounded-lg">
                        <span className="text-sm text-white">{mod.label}</span>
                        <Switch
                          checked={getModuleEnabled(mod.key)}
                          onCheckedChange={(enabled) =>
                            toggleModule.mutate({
                              orgId: selectedOrg.id,
                              moduleName: mod.key,
                              enabled,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Credits sheet */}
      <Sheet open={!!creditsOrg} onOpenChange={() => setCreditsOrg(null)}>
        <SheetContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-white flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Credits — {creditsOrg?.name}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6 pb-6">
            {/* Saldo + lifetime */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Huidig saldo</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {formatEuro(creditDetails?.credits?.balance_cents ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Lifetime toegekend</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {formatEuro(creditDetails?.credits?.lifetime_topped_up_cents ?? 0)}
                </p>
              </div>
            </div>

            {/* Pricing */}
            {creditDetails?.credits && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-1">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Pricing per 1M tokens</p>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Input</span>
                  <span className="text-white font-mono">
                    {formatEuro(creditDetails.credits.pricing_input_cents_per_mtok)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Output</span>
                  <span className="text-white font-mono">
                    {formatEuro(creditDetails.credits.pricing_output_cents_per_mtok)}
                  </span>
                </div>
              </div>
            )}

            {/* Top-up form */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
              <p className="text-sm font-medium text-white">Saldo aanpassen</p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="50,00"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white w-28"
                />
                <span className="text-zinc-400 self-center text-sm">euro</span>
              </div>
              <Textarea
                placeholder="Notitie (bv. 'Top-up factuur 2026-04-30')"
                value={topupNote}
                onChange={(e) => setTopupNote(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white text-sm"
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleTopup}
                  disabled={topup.isPending || !topupAmount}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Boeken
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setTopupAmount('50'); setTopupNote('Standaard top-up €50'); }}
                  className="text-zinc-400"
                >
                  +€50 invullen
                </Button>
              </div>
              <p className="text-xs text-zinc-500">Negatieve bedragen toegestaan voor correcties.</p>
            </div>

            {/* Top-up history */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Recente top-ups
              </p>
              {(creditDetails?.topups?.length ?? 0) === 0 ? (
                <p className="text-zinc-500 text-sm">Nog geen top-ups (alleen starter-bonus).</p>
              ) : (
                <div className="space-y-1">
                  {creditDetails?.topups?.map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-2 px-3 bg-zinc-800 rounded text-sm">
                      <div>
                        <span className={`font-mono font-semibold ${t.amount_cents > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {t.amount_cents > 0 ? '+' : ''}{formatEuro(t.amount_cents)}
                        </span>
                        {t.note && <span className="text-zinc-400 ml-2">— {t.note}</span>}
                      </div>
                      <span className="text-zinc-500 text-xs">
                        {new Date(t.created_at).toLocaleDateString('nl-NL')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent usage */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Recent gebruik (laatste 20)
              </p>
              {(creditDetails?.usage?.length ?? 0) === 0 ? (
                <p className="text-zinc-500 text-sm">Nog geen gebruik.</p>
              ) : (
                <div className="space-y-1">
                  {creditDetails?.usage?.map((u) => (
                    <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-zinc-800 rounded text-xs">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={u.provider === 'cloud' ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-700 text-zinc-300'}
                        >
                          {u.provider}
                        </Badge>
                        <span className="text-zinc-400">
                          {u.input_tokens ?? '?'}→{u.output_tokens ?? '?'} tok
                        </span>
                        {typeof u.duration_ms === 'number' && (
                          <span className="text-zinc-500">{(u.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-white">{formatEuro(u.cost_cents)}</span>
                        <span className="text-zinc-500">
                          {new Date(u.created_at).toLocaleDateString('nl-NL')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default SuperAdminOrganizations;
