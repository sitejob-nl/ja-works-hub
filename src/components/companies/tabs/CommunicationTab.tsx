import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, MessageSquare, Mail, Phone, StickyNote } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type Channel = Database['public']['Enums']['communication_channel'];

const channelIcons: Record<Channel, any> = {
  whatsapp: MessageSquare,
  email: Mail,
  voip: Phone,
  notitie: StickyNote,
  sms: MessageSquare,
};

const channelLabels: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  voip: 'Telefoongesprek',
  notitie: 'Notitie',
  sms: 'SMS',
};

const CommunicationTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ channel: 'notitie' as Channel, subject: '', body: '' });

  const { data: comms = [] } = useQuery({
    queryKey: ['communications', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communications')
        .select('*, profiles:sent_by(full_name)')
        .eq('company_id', companyId)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('communications').insert({
        company_id: companyId,
        organization_id: orgId,
        channel: form.channel,
        subject: form.subject || null,
        body: form.body || null,
        sent_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['communications', companyId] });
      setAdding(false);
      setForm({ channel: 'notitie', subject: '', body: '' });
      toast.success('Communicatie toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Communicatie</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuwe notitie</Button>
      </div>

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div>
            <Label>Kanaal</Label>
            <Select value={form.channel} onValueChange={(v) => setForm(f => ({ ...f, channel: v as Channel }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(channelLabels) as Channel[]).map(c => (
                  <SelectItem key={c} value={c}>{channelLabels[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Onderwerp</Label><Input value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} /></div>
          <div><Label>Bericht</Label><Textarea value={form.body} onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))} rows={3} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => add.mutate()}>Opslaan</Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {comms.map((c: any) => {
          const Icon = channelIcons[c.channel as Channel] ?? MessageSquare;
          return (
            <div key={c.id} className="bg-card rounded-lg border p-4 flex gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{c.subject || channelLabels[c.channel as Channel]}</p>
                  <span className="text-xs text-muted-foreground">
                    {c.sent_at ? format(parseISO(c.sent_at), 'dd-MM-yyyy HH:mm') : ''}
                  </span>
                </div>
                {c.body && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{c.body}</p>}
                {c.profiles?.full_name && <p className="text-xs text-muted-foreground mt-1">Door: {c.profiles.full_name}</p>}
              </div>
            </div>
          );
        })}
        {comms.length === 0 && !adding && (
          <p className="text-center text-muted-foreground py-8">Nog geen communicatie vastgelegd</p>
        )}
      </div>
    </div>
  );
};

export default CommunicationTab;
