import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageCircle, MessageSquare, Phone, Plus, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime, formatDuration } from '@/lib/format';

type CommunicationChannel = Database['public']['Enums']['communication_channel'];

const CHANNEL_ICONS: Record<CommunicationChannel, any> = {
  whatsapp: MessageSquare,
  email: Mail,
  voip: Phone,
  notitie: StickyNote,
  sms: MessageCircle,
};

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  voip: 'Telefoongesprek',
  notitie: 'Notitie',
  sms: 'SMS',
};

interface Props {
  placementId: string;
  organizationId: string;
  candidateId?: string | null;
  companyId?: string | null;
}

const PlacementCommunicationTab = ({ placementId, organizationId, candidateId, companyId }: Props) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    channel: 'notitie' as CommunicationChannel,
    direction: 'outbound',
    subject: '',
    body: '',
    duration: '',
  });

  const { data: communications = [] } = useQuery({
    queryKey: ['placement-communications', placementId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communications')
        .select('*, profiles:sent_by(full_name)')
        .eq('placement_id', placementId)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('communications').insert({
        organization_id: organizationId,
        placement_id: placementId,
        candidate_id: candidateId || null,
        company_id: companyId || null,
        channel: form.channel,
        direction: form.direction,
        subject: form.subject || null,
        body: form.body || null,
        call_duration_seconds: form.channel === 'voip' && form.duration ? Number(form.duration) : null,
        sent_by: user?.id ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['placement-communications', placementId] });
      qc.invalidateQueries({ queryKey: ['communications'] });
      setAdding(false);
      setForm({ channel: 'notitie', direction: 'outbound', subject: '', body: '', duration: '' });
      toast.success('Communicatie toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Communicatielog</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" />Nieuw contactmoment
        </Button>
      </div>

      {adding && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Kanaal</Label>
              <Select value={form.channel} onValueChange={(v) => setForm(f => ({ ...f, channel: v as CommunicationChannel }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABELS) as CommunicationChannel[]).map(channel => (
                    <SelectItem key={channel} value={channel}>{CHANNEL_LABELS[channel]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Richting</Label>
              <Select value={form.direction} onValueChange={(v) => setForm(f => ({ ...f, direction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">Uitgaand</SelectItem>
                  <SelectItem value="inbound">Inkomend</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.channel === 'voip' && (
              <div className="space-y-1.5">
                <Label>Gespreksduur in seconden</Label>
                <Input type="number" min="0" value={form.duration} onChange={(e) => setForm(f => ({ ...f, duration: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Onderwerp</Label>
            <Input value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Bericht / notitie</Label>
            <Textarea value={form.body} onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending}>Opslaan</Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {communications.map((item: any) => {
          const Icon = CHANNEL_ICONS[item.channel as CommunicationChannel] ?? MessageSquare;
          return (
            <div key={item.id} className="rounded-lg border bg-card p-4 flex gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{item.subject || CHANNEL_LABELS[item.channel as CommunicationChannel]}</p>
                    <Badge variant={item.direction === 'inbound' ? 'default' : 'secondary'} className="text-xs">
                      {item.direction === 'inbound' ? 'Inkomend' : 'Uitgaand'}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.sent_at)}</span>
                </div>
                {item.body && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{item.body}</p>}
                {item.channel === 'voip' && item.call_duration_seconds != null && (
                  <p className="text-xs text-muted-foreground mt-2">Gespreksduur: {formatDuration(item.call_duration_seconds)}</p>
                )}
                {item.profiles?.full_name && (
                  <p className="text-xs text-muted-foreground mt-2">Door: {item.profiles.full_name}</p>
                )}
              </div>
            </div>
          );
        })}
        {communications.length === 0 && !adding && (
          <p className="text-center text-muted-foreground py-8">Nog geen contactmomenten voor deze plaatsing</p>
        )}
      </div>
    </div>
  );
};

export default PlacementCommunicationTab;
