import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { usePayrollers } from '@/hooks/usePayrollers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toFriendlyError } from '@/lib/errorMessages';
import type { Payroller } from '@/lib/payroller';

const NONE = '__none__';

// Instellingen voor de plaatsingswizard: welke payrollers de organisatie gebruikt
// (nu een eigen tabel, dus zelf uit te breiden) en wie de contract-taak krijgt bij
// een nieuwe plaatsing (PlacementTriggers).
const PlacementSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newInvoicedByUs, setNewInvoicedByUs] = useState(true);

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

  const { data: payrollers = [] } = usePayrollers();

  const settings = (org?.settings as any) ?? {};
  const contractOwnerId: string | null = settings.contract_owner_profile_id ?? null;
  const defaultPayroller = payrollers.find((p) => p.is_default) ?? null;
  const activeCount = payrollers.filter((p) => p.is_active).length;

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
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  const payrollerMutation = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => { await fn(); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payrollers', orgId] });
    },
    onError: (e: any) => toast.error(toFriendlyError(e)),
  });

  // legacy_key bewust niet bewerkbaar: die koppelt de rij aan de oude enum-waarde.
  type PayrollerPatch = Partial<Pick<Payroller, 'name' | 'invoiced_by_us' | 'is_active' | 'is_default' | 'sort_order'>>;

  const updatePayroller = (id: string, patch: PayrollerPatch) =>
    payrollerMutation.mutate(() => unwrap(supabase.from('payrollers').update(patch).eq('id', id)));

  const togglePayroller = (payroller: Payroller, on: boolean) => {
    if (!on && activeCount <= 1) {
      toast.warning('Minimaal één payroller moet actief blijven');
      return;
    }
    // Een uitgezette payroller kan niet de standaard blijven.
    updatePayroller(payroller.id, on ? { is_active: true } : { is_active: false, is_default: false });
  };

  const setDefaultPayroller = (value: string) => {
    // Partiële unique index staat één default per org toe — eerst de oude vrijgeven.
    payrollerMutation.mutate(async () => {
      await unwrap(supabase.from('payrollers').update({ is_default: false }).eq('organization_id', orgId).eq('is_default', true));
      if (value !== NONE) {
        await unwrap(supabase.from('payrollers').update({ is_default: true }).eq('id', value));
      }
    });
  };

  const addPayroller = () => {
    const name = newName.trim();
    if (!name) return;
    if (payrollers.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast.warning('Er bestaat al een payroller met deze naam');
      return;
    }
    payrollerMutation.mutate(async () => {
      await unwrap(supabase.from('payrollers').insert({
        organization_id: orgId,
        name,
        invoiced_by_us: newInvoicedByUs,
        sort_order: (payrollers.at(-1)?.sort_order ?? 0) + 1,
      }));
      setNewName('');
      setNewInvoicedByUs(true);
      toast.success(`${name} toegevoegd`);
    });
  };

  const removePayroller = (payroller: Payroller) => {
    payrollerMutation.mutate(async () => {
      const { count } = await supabase
        .from('placements')
        .select('id', { count: 'exact', head: true })
        .eq('payroller_id', payroller.id);
      if ((count ?? 0) > 0) {
        // Verwijderen zou de payroller van bestaande plaatsingen loskoppelen; die
        // historie (en de facturatie erachter) moet kloppen. Uitzetten kan wel.
        throw new Error(
          `${payroller.name} is aan ${count} plaatsing${count === 1 ? '' : 'en'} gekoppeld. Zet 'm uit in plaats van verwijderen.`,
        );
      }
      await unwrap(supabase.from('payrollers').delete().eq('id', payroller.id));
      toast.success(`${payroller.name} verwijderd`);
    });
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
          <Label>Payrollers</Label>
          {payrollers.map((payroller) => (
            <div key={payroller.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <span className="text-sm font-medium">{payroller.name}</span>
                <div className="mt-1 flex items-center gap-2">
                  <Switch
                    id={`invoiced-${payroller.id}`}
                    checked={payroller.invoiced_by_us}
                    disabled={payrollerMutation.isPending}
                    onCheckedChange={(on) => updatePayroller(payroller.id, { invoiced_by_us: on })}
                  />
                  <label htmlFor={`invoiced-${payroller.id}`} className="text-xs text-muted-foreground cursor-pointer">
                    {payroller.invoiced_by_us
                      ? 'Wij factureren deze uren'
                      : 'Payroller factureert zelf aan de eindklant'}
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={payroller.is_active}
                  disabled={payrollerMutation.isPending}
                  onCheckedChange={(on) => togglePayroller(payroller, on)}
                  aria-label={`${payroller.name} actief`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  disabled={payrollerMutation.isPending}
                  onClick={() => removePayroller(payroller)}
                  aria-label={`${payroller.name} verwijderen`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex items-end gap-2 rounded-md border border-dashed p-3">
            <div className="flex-1 min-w-0">
              <Label htmlFor="new-payroller" className="text-xs text-muted-foreground">Payroller toevoegen</Label>
              <Input
                id="new-payroller"
                className="mt-1"
                placeholder="Naam van de payroller"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addPayroller(); }}
              />
              <div className="mt-2 flex items-center gap-2">
                <Switch id="new-invoiced" checked={newInvoicedByUs} onCheckedChange={setNewInvoicedByUs} />
                <label htmlFor="new-invoiced" className="text-xs text-muted-foreground cursor-pointer">
                  Wij factureren deze uren
                </label>
              </div>
            </div>
            <Button onClick={addPayroller} disabled={!newName.trim() || payrollerMutation.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Toevoegen
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <Label>Standaard payroller</Label>
            <p className="text-xs text-muted-foreground">Vooringevuld bij een nieuwe plaatsing</p>
          </div>
          <Select
            value={defaultPayroller?.id ?? NONE}
            disabled={payrollerMutation.isPending}
            onValueChange={setDefaultPayroller}
          >
            <SelectTrigger className="w-56 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Geen — per plaatsing kiezen</SelectItem>
              {payrollers.filter((p) => p.is_active).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
