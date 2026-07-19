import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ALL_PAYROLLERS, JA_WERKT_PAYROLLERS, getPayrollerSettings, payrollerLabel } from '@/lib/payroller';

const NONE = '__none__';

// Instellingen voor de plaatsingswizard: welke payrollers actief zijn (+ default)
// en wie de contract-taak krijgt bij een nieuwe plaatsing (PlacementTriggers).
const PlacementSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ['placement-settings', orgId],
    queryFn: () => unwrap(supabase.from('organizations').select('settings').eq('id', orgId).single()),
    enabled: !!orgId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['org-users-for-placements', orgId],
    queryFn: () => unwrapList(
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name'),
    ),
    enabled: !!orgId,
  });

  const settings = (org?.settings as any) ?? {};
  const payrollers = getPayrollerSettings(settings);
  const contractOwnerId: string | null = settings.contract_owner_profile_id ?? null;

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await unwrap(supabase
        .from('organizations')
        .update({ settings: { ...settings, ...patch } })
        .eq('id', orgId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['placement-settings', orgId] });
      toast.success('Plaatsingsinstellingen opgeslagen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const togglePayroller = (key: string, on: boolean) => {
    const enabled = on ? [...payrollers.enabled, key] : payrollers.enabled.filter((p) => p !== key);
    if (enabled.length === 0) {
      toast.warning('Minimaal één payroller moet actief blijven');
      return;
    }
    const def = payrollers.default && enabled.includes(payrollers.default) ? payrollers.default : null;
    save.mutate({ payrollers: { enabled, default: def } });
  };

  const setDefaultPayroller = (value: string) => {
    save.mutate({ payrollers: { enabled: payrollers.enabled, default: value === NONE ? null : value } });
  };

  const setContractOwner = (value: string) => {
    save.mutate({ contract_owner_profile_id: value === NONE ? null : value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4" /> Plaatsingen
        </CardTitle>
        <CardDescription>
          Payrollers die je organisatie gebruikt (kiesbaar in de plaatsingswizard) en wie de
          contract-taak krijgt bij een nieuwe plaatsing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Actieve payrollers</Label>
          {ALL_PAYROLLERS.map((key) => (
            <div key={key} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <span className="text-sm font-medium">{payrollerLabel[key]}</span>
                <p className="text-xs text-muted-foreground">
                  {JA_WERKT_PAYROLLERS.includes(key) ? 'Facturatie via ja werkt' : 'Externe facturatie (loonmotor)'}
                </p>
              </div>
              <Switch
                checked={payrollers.enabled.includes(key)}
                disabled={save.isPending}
                onCheckedChange={(on) => togglePayroller(key, on)}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <Label>Standaard payroller</Label>
            <p className="text-xs text-muted-foreground">Vooringevuld bij een nieuwe plaatsing</p>
          </div>
          <Select value={payrollers.default ?? NONE} disabled={save.isPending} onValueChange={setDefaultPayroller}>
            <SelectTrigger className="w-56 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Geen — per plaatsing kiezen</SelectItem>
              {payrollers.enabled.map((key) => (
                <SelectItem key={key} value={key}>{payrollerLabel[key]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <Label>Contract-eigenaar</Label>
            <p className="text-xs text-muted-foreground">
              Krijgt bij elke plaatsing de taak "Contract aanmaken". Leeg = accountmanager, anders backoffice/admin.
            </p>
          </div>
          <Select value={contractOwnerId ?? NONE} disabled={save.isPending} onValueChange={setContractOwner}>
            <SelectTrigger className="w-56 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Automatisch (accountmanager)</SelectItem>
              {users.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
};

export default PlacementSettings;
