import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Categorie-labels uit de mail-triage (EmailInbox.tsx → classifyEmailMessage). Per categorie
// kun je een vaste eigenaar kiezen; leeg = de triagetaak gaat naar de gebruiker die triëert.
const TRIAGE_LABELS: { key: string; label: string; hint: string }[] = [
  { key: 'CV', label: 'CV / sollicitatie', hint: 'Inkomende cv’s en sollicitaties' },
  { key: 'Klantvraag', label: 'Klantvraag', hint: 'Vragen/verzoeken van opdrachtgevers' },
  { key: 'Partner', label: 'Partner', hint: 'Recruitment- en samenwerkingspartners' },
  { key: 'Ruis', label: 'Ruis', hint: 'Nieuwsbrieven, spam, niet-relevant' },
  { key: 'Review', label: 'Overig / review', hint: 'Niet automatisch te classificeren' },
];

const SELF = '__self__';

const TriageRoutingSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ['triage-routing-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['org-users-for-routing', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const routing: Record<string, string> = ((org?.settings as any)?.triage_routing ?? {}) as Record<string, string>;

  const setRoute = useMutation({
    mutationFn: async ({ key, userId }: { key: string; userId: string | null }) => {
      const nextRouting = { ...routing };
      if (userId) nextRouting[key] = userId;
      else delete nextRouting[key];
      const nextSettings = { ...((org?.settings as any) ?? {}), triage_routing: nextRouting };
      const { error } = await supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['triage-routing-settings', orgId] });
      toast.success('Triage-routering bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" /> Mail-triage routering
        </CardTitle>
        <CardDescription>
          Bepaal per categorie wie de triagetaak krijgt wanneer je een inkomende e-mail triëert in het
          Postvak. Laat een categorie op <strong>“De triërende gebruiker”</strong> staan om de taak (zoals nu)
          aan jezelf toe te wijzen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {TRIAGE_LABELS.map((cat) => (
          <div key={cat.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <Label>{cat.label}</Label>
              <p className="text-xs text-muted-foreground">{cat.hint}</p>
            </div>
            <Select
              value={routing[cat.key] ?? SELF}
              disabled={setRoute.isPending}
              onValueChange={(v) => setRoute.mutate({ key: cat.key, userId: v === SELF ? null : v })}
            >
              <SelectTrigger className="w-56 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SELF}>De triërende gebruiker</SelectItem>
                {users.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default TriageRoutingSettings;
