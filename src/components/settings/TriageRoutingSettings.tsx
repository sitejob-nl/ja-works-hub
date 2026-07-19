import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// De `key` is de opgeslagen sleutel in settings.triage_routing en moet gelijk blijven
// aan de labels uit EmailInbox.tsx → classifyEmailMessage. Alleen `label` is zichtbaar.
const TRIAGE_LABELS: { key: string; label: string; hint: string }[] = [
  { key: 'CV', label: 'Sollicitatie of cv', hint: 'Iemand solliciteert of stuurt een cv' },
  { key: 'Klantvraag', label: 'Vraag van een opdrachtgever', hint: 'Een klant vraagt of meldt iets' },
  { key: 'Partner', label: 'Partner of bureau', hint: 'Samenwerkingspartners en andere bureaus' },
  { key: 'Ruis', label: 'Niet relevant', hint: 'Nieuwsbrieven, reclame en spam' },
  { key: 'Review', label: 'Weet het niet zeker', hint: 'De AI kon dit niet met zekerheid indelen' },
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
      toast.success('Opgeslagen — nieuwe e-mails gaan naar de gekozen persoon');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" /> Wie pakt welke e-mail op?
        </CardTitle>
        <CardDescription>
          Verwerk je een e-mail in het Postvak, dan maakt het systeem daar een taak van. Hier kies je per
          soort e-mail wie die taak krijgt — bijvoorbeeld: sollicitaties altijd naar de recruiter, vragen
          van opdrachtgevers naar de accountmanager. Staat er <strong>“Wie de e-mail verwerkt”</strong>, dan
          blijft de taak bij degene die hem op dat moment oppakt.
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
                <SelectItem value={SELF}>Wie de e-mail verwerkt</SelectItem>
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
