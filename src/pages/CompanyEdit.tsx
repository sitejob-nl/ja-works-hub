import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useExactActive } from '@/hooks/useExactActive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import KvkNameSearchInput from '@/components/companies/KvkNameSearchInput';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';

const CompanyEdit = () => {
  const { id } = useParams<{ id: string }>();
  const exactActive = useExactActive();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const [form, setForm] = useState({
    name: '', kvk_number: '', btw_number: '',
    address_street: '', address_postal: '', address_city: '',
    address_lat: null as number | null, address_lng: null as number | null,
    phone: '', email: '', website: '', notes: '',
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name ?? '',
        kvk_number: company.kvk_number ?? '',
        btw_number: company.btw_number ?? '',
        address_street: company.address_street ?? '',
        address_postal: company.address_postal ?? '',
        address_city: company.address_city ?? '',
        address_lat: company.address_lat ?? null,
        address_lng: company.address_lng ?? null,
        phone: company.phone ?? '',
        email: company.email ?? '',
        website: company.website ?? '',
        notes: company.notes ?? '',
      });
    }
  }, [company]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const address = await resolveAddressCoordinates({
        street: form.address_street,
        postal: form.address_postal,
        city: form.address_city,
        lat: form.address_lat,
        lng: form.address_lng,
      });
      const { error } = await supabase.from('companies').update({
        name: form.name,
        kvk_number: form.kvk_number || null,
        btw_number: form.btw_number || null,
        address_street: form.address_street || null,
        address_postal: form.address_postal || null,
        address_city: form.address_city || null,
        address_lat: address.lat,
        address_lng: address.lng,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        notes: form.notes || null,
      }).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', id] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      logAudit({ action: 'update', tableName: 'companies', recordId: id!, newValues: form });
      toast.success('Opdrachtgever bijgewerkt');
      // Auto-sync naar Exact Online als koppeling actief is
      if (exactActive && id) {
        supabase.functions.invoke('exact-sync-account', { body: { company_id: id } })
          .then(({ data: res }) => { if (res?.success) toast.success('Relatie bijgewerkt in Exact'); })
          .catch(() => {}); // silent fail
      }
      navigate(`/opdrachtgevers/${id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!company) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/opdrachtgevers" className="hover:text-foreground transition-colors">Opdrachtgevers</Link>
        <ChevronRight className="h-3 w-3" />
        <Link to={`/opdrachtgevers/${id}`} className="hover:text-foreground transition-colors">{company.name}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Bewerken</span>
      </div>

      <h1 className="text-2xl font-semibold">Opdrachtgever bewerken</h1>

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
              placeholder="Typ om te zoeken in KVK..."
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
            <Button variant="ghost" onClick={() => navigate(`/opdrachtgevers/${id}`)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyEdit;
