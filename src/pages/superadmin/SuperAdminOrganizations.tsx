import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { Building2, Search, Settings2, Wallet } from 'lucide-react';
import AiCreditsPanel from '@/components/settings/AiCreditsPanel';
import { useAiCreditOrganizationBalances } from '@/hooks/useAiCredits';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { HOURS_WORKFLOW_MODULE, setHoursWorkflowEnabled } from '@/hooks/useHoursModuleAccess';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/db';
import { toFriendlyError } from '@/lib/errorMessages';
import { z } from 'zod';

const formatEuro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

const organizationModulesSchema = z.array(z.object({
  organization_id: z.string().uuid(),
  module_name: z.string(),
  enabled: z.boolean().nullable(),
}));

const ALL_MODULES = [
  { key: 'workbench', label: 'Workbench', group: 'Kern' },
  { key: 'opdrachtgevers', label: 'Opdrachtgevers', group: 'Kern' },
  { key: 'kandidaten', label: 'Kandidaten', group: 'Kern' },
  { key: 'medewerkers', label: 'Medewerkers', group: 'Kern' },
  { key: 'vacatures', label: 'Vacatures', group: 'Kern' },
  { key: 'planning', label: 'Planning', group: 'Kern' },
  { key: 'uren', label: 'Uren', group: 'Kern' },
  { key: HOURS_WORKFLOW_MODULE, label: 'Urenmodule — weekcontrole en matrices', group: 'Kern' },
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
  const queryClient = useQueryClient();
  const { user, isSuperAdmin, loading: authLoading } = useSuperAdmin();

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

  const modules = useQuery({
    queryKey: qk.hoursModule.adminModules(user?.id ?? '', selectedOrg?.id ?? ''),
    enabled: !!selectedOrg && !!user && isSuperAdmin && !authLoading,
    retry: false,
    refetchOnMount: 'always',
    queryFn: async () => {
      const data = organizationModulesSchema.parse(await unwrap(supabase
        .from('organization_modules')
        .select('organization_id,module_name,enabled')
        .eq('organization_id', selectedOrg.id)));
      if (data.some(module => module.organization_id !== selectedOrg.id)) throw new Error('De modules horen niet bij deze organisatie.');
      return data;
    },
  });

  const { data: allCredits, isError: creditsError } = useAiCreditOrganizationBalances();

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
      if (moduleName === HOURS_WORKFLOW_MODULE) {
        await setHoursWorkflowEnabled(orgId, enabled);
        return;
      }
      await unwrap(supabase
        .from('organization_modules')
        .upsert(
          { organization_id: orgId, module_name: moduleName, enabled },
          { onConflict: 'organization_id,module_name' }
        ));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.hoursModule.adminAll() }),
        queryClient.invalidateQueries({ queryKey: qk.hoursModule.all() }),
      ]);
      toast.success('Module bijgewerkt');
    },
    onError: error => toast.error(toFriendlyError(error)),
  });

  const filtered = orgs?.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const getModuleEnabled = (moduleName: string): boolean => {
    const override = modules.data?.find(m => m.module_name === moduleName && m.organization_id === selectedOrg?.id);
    if (moduleName === HOURS_WORKFLOW_MODULE) {
      return !authLoading && isSuperAdmin && modules.isSuccess && !modules.isFetching && override?.enabled === true;
    }
    if (override) return override.enabled === true;
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
              <th className="px-4 py-3 font-medium">Beschikbaar AI-tegoed</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Acties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((org) => {
              const plan = plans?.find(p => p.id === org.plan_id);
              const orgCredits = allCredits?.find(c => c.organization_id === org.id);
              const balance = orgCredits ? orgCredits.balance_cents - orgCredits.reserved_cents : null;
              const lowBalance = balance != null && balance < 100;
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
                      {creditsError || balance == null ? 'Onbekend' : formatEuro(balance)}
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
                        onClick={() => { toggleModule.reset(); setSelectedOrg(org); }}
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
            <p className="text-zinc-400 text-sm">Weekcontrole en matrices staan standaard uit en worden alleen met deze schakelaar beschikbaar voor medewerkers en interne gebruikers.</p>
            {modules.isFetching && <p role="status" className="text-sm text-zinc-400">Modules laden…</p>}
            {modules.isError && <div role="alert" className="space-y-2 text-sm text-red-300"><p>De modules konden niet worden geladen.</p><Button variant="outline" onClick={() => void modules.refetch()}>Opnieuw proberen</Button></div>}
            {toggleModule.isError && <p role="alert" className="text-sm text-red-300">De module is niet bijgewerkt. {toFriendlyError(toggleModule.error)}</p>}
            <div className="space-y-5 pb-4">
              {Array.from(new Set(ALL_MODULES.map(m => m.group))).map(group => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 px-1">{group}</p>
                  <div className="space-y-2">
                    {ALL_MODULES.filter(m => m.group === group).map((mod) => (
                      <div key={mod.key} className="flex items-center justify-between py-2 px-3 bg-zinc-800 rounded-lg">
                        <span className="text-sm text-white">{mod.label}</span>
                        <Switch
                          aria-label={mod.label}
                          checked={getModuleEnabled(mod.key)}
                          disabled={!user || authLoading || !isSuperAdmin || !modules.isSuccess || modules.isFetching || toggleModule.isPending}
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
        <SheetContent className="bg-background text-foreground sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Credits — {creditsOrg?.name}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 pb-6">
            {creditsOrg && <AiCreditsPanel key={creditsOrg.id} orgId={creditsOrg.id} canManage />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default SuperAdminOrganizations;
