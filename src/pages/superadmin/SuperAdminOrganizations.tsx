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
import { Building2, Search, Settings2 } from 'lucide-react';

const ALL_MODULES = [
  { key: 'opdrachtgevers', label: 'Opdrachtgevers' },
  { key: 'kandidaten', label: 'Kandidaten' },
  { key: 'medewerkers', label: 'Medewerkers' },
  { key: 'vacatures', label: 'Vacatures' },
  { key: 'planning', label: 'Planning' },
  { key: 'uren', label: 'Uren' },
  { key: 'huisvesting', label: 'Huisvesting' },
  { key: 'transport', label: 'Transport' },
  { key: 'communicatie', label: 'Communicatie' },
  { key: 'kennisbank', label: 'Kennisbank' },
  { key: 'vacaturebank', label: 'Vacaturebank' },
  { key: 'kandidaten-zoeken', label: 'Kandidaten zoeken' },
];

const SuperAdminOrganizations = () => {
  const [search, setSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
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
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Acties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((org) => {
              const plan = plans?.find(p => p.id === org.plan_id);
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
                        onClick={() => setSelectedOrg(org)}
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
          <div className="mt-6 space-y-4">
            <p className="text-zinc-400 text-sm">Schakel modules in of uit voor deze organisatie. Overrides hebben voorrang op het abonnement.</p>
            <div className="space-y-3">
              {ALL_MODULES.map((mod) => (
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
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default SuperAdminOrganizations;
