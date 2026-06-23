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
import { useFormDraft } from '@/hooks/useFormDraft';
import KvkNameSearchInput from '@/components/companies/KvkNameSearchInput';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';

const CompanyNew = () => {
  const orgId = useOrganizationId();
  const exactActive = useExactActive();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '', kvk_number: '', btw_number: '',
    address_street: '', address_postal: '', address_city: '',
    address_lat: null as number | null, address_lng: null as number | null,
    phone: '', email: '', website: '', notes: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Bewaar invoer tegen per ongeluk weg-navigeren / refresh; wissen na succesvol aanmaken.
  const { clearDraft } = useFormDraft('draft:company-new', form, setForm);

  const mutation = useMutation({
    mutationFn: async () => {
      const address = await resolveAddressCoordinates({
        street: form.address_street,
        postal: form.address_postal,
        city: form.address_city,
        lat: form.address_lat,
        lng: form.address_lng,
      });
      const { data, error } = await supabase.from('companies').insert({
        ...form,
        address_lat: address.lat,
        address_lng: address.lng,
        organization_id: orgId,
      }).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      clearDraft();
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
          <div className="space-y-1.5">
            <Label>Bedrijfsnaam *</Label>
            <KvkNameSearchInput
              value={form.name}
              onChange={(v) => {
                set('name', v);
                if (form.kvk_number) set('kvk_number', '');
              }}
              onSelect={(p) => setForm((f) => ({
                ...f,
                name: p.name,
                kvk_number: p.kvk_number,
                address_street: p.address_street ?? f.address_street,
                address_postal: p.address_postal ?? f.address_postal,
                address_city: p.address_city ?? f.address_city,
                address_lat: null,
                address_lng: null,
              }))}
              placeholder="Begin te typen om te zoeken in KVK..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>KVK-nummer</Label><Input value={form.kvk_number} onChange={(e) => set('kvk_number', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>BTW-nummer</Label><Input value={form.btw_number} onChange={(e) => set('btw_number', e.target.value)} /></div>
          </div>
          <AddressAutocomplete
            value={{ street: form.address_street, postal: form.address_postal, city: form.address_city, lat: form.address_lat, lng: form.address_lng }}
            onChange={(address) => setForm((f) => ({
              ...f,
              address_street: address.street,
              address_postal: address.postal,
              address_city: address.city,
              address_lat: address.lat ?? null,
              address_lng: address.lng ?? null,
            }))}
            gridClassName="grid-cols-1 sm:grid-cols-3 gap-4"
            streetLabel="Straat"
          />
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
