import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useExactActive } from '@/hooks/useExactActive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const CompanyNew = () => {
  const orgId = useOrganizationId();
  const exactActive = useExactActive();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '', kvk_number: '', btw_number: '',
    address_street: '', address_postal: '', address_city: '',
    phone: '', email: '', website: '', notes: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('companies').insert({ ...form, organization_id: orgId }).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      logAudit({ action: 'create', tableName: 'companies', recordId: data.id, newValues: form });
      toast.success('Opdrachtgever aangemaakt');
      // Auto-sync naar Exact Online als koppeling actief is
      if (exactActive) {
        supabase.functions.invoke('exact-sync-account', { body: { company_id: data.id } })
          .then(({ data: res }) => { if (res?.success) toast.success('Relatie gesynchroniseerd naar Exact'); })
          .catch(() => {}); // silent fail
      }
      navigate(`/opdrachtgevers/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/opdrachtgevers" className="hover:text-foreground transition-colors">Opdrachtgevers</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Nieuwe opdrachtgever</span>
      </div>

      <h1 className="text-2xl font-semibold">Nieuwe opdrachtgever</h1>

      <div className="bg-card rounded-lg border p-6 max-w-3xl">
        <div className="space-y-5">
          <div className="space-y-1.5"><Label>Bedrijfsnaam *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>KVK-nummer</Label><Input value={form.kvk_number} onChange={(e) => set('kvk_number', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>BTW-nummer</Label><Input value={form.btw_number} onChange={(e) => set('btw_number', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label>Straat</Label><Input value={form.address_street} onChange={(e) => set('address_street', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Postcode</Label><Input value={form.address_postal} onChange={(e) => set('address_postal', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Stad</Label><Input value={form.address_city} onChange={(e) => set('address_city', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Telefoon</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Website</Label><Input value={form.website} onChange={(e) => set('website', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/opdrachtgevers')}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opdrachtgever aanmaken'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyNew;
