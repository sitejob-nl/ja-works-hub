import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageSquare, PauseOctagon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface PauseState {
  email: boolean;
  whatsapp: boolean;
}

/** organizations.settings.outbound_paused: `true` | `{ email, whatsapp }` -> {email, whatsapp} */
function normalizePause(raw: any): PauseState {
  if (raw === true) return { email: true, whatsapp: true };
  if (raw && typeof raw === 'object') return { email: !!raw.email, whatsapp: !!raw.whatsapp };
  return { email: false, whatsapp: false };
}

const OutboundPauseSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ['outbound-pause-settings', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('settings').eq('id', orgId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const paused = normalizePause((org?.settings as any)?.outbound_paused);

  const setPause = useMutation({
    mutationFn: async (next: PauseState) => {
      const nextSettings = {
        ...((org?.settings as any) ?? {}),
        outbound_paused: next,
      };
      const { error } = await supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ['outbound-pause-settings', orgId] });
      const active = [next.email && 'e-mail', next.whatsapp && 'WhatsApp'].filter(Boolean);
      toast.success(active.length ? `Uitgaand gepauzeerd: ${active.join(' + ')}` : 'Uitgaande communicatie weer actief');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const anyPaused = paused.email || paused.whatsapp;

  return (
    <Card className={anyPaused ? 'border-amber-300' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PauseOctagon className="h-4 w-4" /> Uitgaande communicatie pauzeren
          {anyPaused && <Badge className="bg-amber-100 text-amber-800 border-0">Actief</Badge>}
        </CardTitle>
        <CardDescription>
          Noodrem voor uitgaande berichten — handig tijdens testen/ontwikkelen zodat kandidaten geen
          ongewenste e-mail of WhatsApp krijgen. Geblokkeerde berichten worden als <strong>concept</strong>
          {' '}gelogd (niet verzonden), niet stil weggegooid.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label>E-mail pauzeren</Label>
              <p className="text-xs text-muted-foreground">Blokkeert álle uitgaande e-mail (voorstellen, urenakkoord, portaal, campagnes, cron).</p>
            </div>
          </div>
          <Switch
            checked={paused.email}
            disabled={setPause.isPending}
            onCheckedChange={(v) => setPause.mutate({ ...paused, email: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label>WhatsApp pauzeren</Label>
              <p className="text-xs text-muted-foreground">Blokkeert handmatige WhatsApp-sends en bulk-campagnes.</p>
            </div>
          </div>
          <Switch
            checked={paused.whatsapp}
            disabled={setPause.isPending}
            onCheckedChange={(v) => setPause.mutate({ ...paused, whatsapp: v })}
          />
        </div>
        {anyPaused && (
          <p className="text-xs text-amber-700">
            Let op: zolang dit aan staat gaan er geen berichten uit. Zet het uit zodra je live wilt.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default OutboundPauseSettings;
