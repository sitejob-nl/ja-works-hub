import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Clock } from 'lucide-react';
import { toast } from 'sonner';

const SlaTab = ({ companyId }: { companyId: string }) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ description: '', response_time_hours: '', notes: '' });

  const { data: slas = [] } = useQuery({
    queryKey: ['sla', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_sla').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('company_sla').insert({
        company_id: companyId,
        organization_id: orgId,
        description: form.description,
        response_time_hours: form.response_time_hours ? parseInt(form.response_time_hours) : null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sla', companyId] });
      setAdding(false);
      setForm({ description: '', response_time_hours: '', notes: '' });
      toast.success('SLA toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">SLA afspraken</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nieuwe SLA</Button>
      </div>

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div><Label>Beschrijving *</Label><Input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div><Label>Responstijd (uren)</Label><Input type="number" value={form.response_time_hours} onChange={(e) => setForm(f => ({ ...f, response_time_hours: e.target.value }))} /></div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => add.mutate()} disabled={!form.description}>Opslaan</Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {slas.map((s: any) => (
          <div key={s.id} className="bg-card rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <p className="font-medium text-sm">{s.description}</p>
              {s.response_time_hours && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{s.response_time_hours} uur</span>
              )}
            </div>
            {s.notes && <p className="text-sm text-muted-foreground mt-1">{s.notes}</p>}
          </div>
        ))}
        {slas.length === 0 && !adding && (
          <p className="text-center text-muted-foreground py-8">Nog geen SLA afspraken</p>
        )}
      </div>
    </div>
  );
};

export default SlaTab;
