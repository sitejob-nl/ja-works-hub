import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { unwrap, unwrapList } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Home } from 'lucide-react';
import { toast } from 'sonner';

const NONE = '__none__';

/**
 * Wie de taak krijgt bij een melding uit het medewerkersportaal ("Onderhoud melden").
 * De routering zelf zit in een DB-trigger (resolve_housing_owner) omdat de melder een
 * portaalgebruiker is en die geen recruiter_tasks mag aanmaken.
 */
const HousingSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ['organization-settings', orgId],
    queryFn: () => unwrap(supabase.from('organizations').select('id, settings').eq('id', orgId).single()),
    enabled: !!orgId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['org-active-profiles', orgId],
    queryFn: () => unwrapList(supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .in('role', ['admin', 'intercedent', 'backoffice', 'finance'])
      .order('full_name')),
    enabled: !!orgId,
  });

  const settings = (org?.settings as any) ?? {};
  const housingOwnerId: string | null = settings.housing_owner_profile_id ?? null;

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await unwrap(supabase
        .from('organizations')
        .update({ settings: { ...settings, ...patch } })
        .eq('id', orgId)
        .select('id')
        .single());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization-settings', orgId] });
      toast.success('Opgeslagen');
    },
    onError: (e: any) => toast.error(e.message ?? 'Opslaan mislukt'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Home className="h-4 w-4" /> Huisvesting
        </CardTitle>
        <CardDescription>
          Wie de taak krijgt als een bewoner via het portaal onderhoud meldt (kapotte verwarming,
          lekkage, …). Zonder keuze gaat de melding naar een beheerder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Label>Verantwoordelijke voor meldingen</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Krijgt de taak én ziet de melding met pand, kamer, melder en foto's erbij.
            </p>
          </div>
          <Select
            value={housingOwnerId ?? NONE}
            disabled={save.isPending}
            onValueChange={(value) => save.mutate({ housing_owner_profile_id: value === NONE ? null : value })}
          >
            <SelectTrigger className="w-56 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Automatisch (beheerder)</SelectItem>
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

export default HousingSettings;
