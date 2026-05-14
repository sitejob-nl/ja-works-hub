import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagInput from '@/components/ui/tag-input';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';

const sources = [
  { value: 'website', label: 'Website' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'indeed', label: 'Indeed' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referral' },
  { value: 'overig', label: 'Overig' },
];

const CandidateEdit = () => {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, date_of_birth, nationality, email, phone, address_street, address_postal, address_city, address_lat, address_lng, has_drivers_license, drivers_license_expiry, skills, languages, source, notes')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
  const { data: sensitiveData, isLoading: sensitiveLoading } = useDecryptedCandidate(id);

  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '', nationality: '',
    email: '', phone: '', address_street: '', address_postal: '', address_city: '',
    address_lat: null as number | null, address_lng: null as number | null,
    bsn: '', iban: '', has_drivers_license: false, drivers_license_expiry: '',
    skills: [] as string[], languages: [] as string[], source: '', notes: '',
  });

  useEffect(() => {
    if (candidate) {
      setForm({
        first_name: candidate.first_name ?? '',
        last_name: candidate.last_name ?? '',
        date_of_birth: candidate.date_of_birth ?? '',
        nationality: candidate.nationality ?? '',
        email: candidate.email ?? '',
        phone: candidate.phone ?? '',
        address_street: candidate.address_street ?? '',
        address_postal: candidate.address_postal ?? '',
        address_city: candidate.address_city ?? '',
        address_lat: (candidate as any).address_lat ?? null,
        address_lng: (candidate as any).address_lng ?? null,
        bsn: sensitiveData?.decrypted_bsn ?? '',
        iban: sensitiveData?.decrypted_iban ?? '',
        has_drivers_license: candidate.has_drivers_license ?? false,
        drivers_license_expiry: candidate.drivers_license_expiry ?? '',
        skills: candidate.skills ?? [],
        languages: candidate.languages ?? [],
        source: candidate.source ?? '',
        notes: candidate.notes ?? '',
      });
    }
  }, [candidate, sensitiveData]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const address = await resolveAddressCoordinates({
        street: form.address_street,
        postal: form.address_postal,
        city: form.address_city,
        lat: form.address_lat,
        lng: form.address_lng,
      });
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        date_of_birth: form.date_of_birth || null,
        nationality: form.nationality || null,
        email: form.email || null,
        phone: form.phone || null,
        address_street: form.address_street || null,
        address_postal: form.address_postal || null,
        address_city: form.address_city || null,
        address_lat: address.lat,
        address_lng: address.lng,
        bsn: form.bsn || null,
        iban: form.iban || null,
        has_drivers_license: form.has_drivers_license,
        drivers_license_expiry: form.has_drivers_license && form.drivers_license_expiry ? form.drivers_license_expiry : null,
        skills: form.skills.length ? form.skills : null,
        languages: form.languages.length ? form.languages : null,
        source: form.source || null,
        notes: form.notes || null,
      };
      const { error } = await supabase.from('candidates').update(payload as any).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', id] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      logAudit({ action: 'update', tableName: 'candidates', recordId: id!, newValues: form });
      toast.success('Kandidaat bijgewerkt');
      navigate(`/kandidaten/${id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || sensitiveLoading) return <div className="p-8 text-muted-foreground">Laden...</div>;
  if (!candidate) return <div className="p-8 text-muted-foreground">Niet gevonden</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/kandidaten" className="hover:text-foreground transition-colors">Kandidaten</Link>
        <ChevronRight className="h-3 w-3" />
        <Link to={`/kandidaten/${id}`} className="hover:text-foreground transition-colors">{candidate.first_name} {candidate.last_name}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Bewerken</span>
      </div>

      <h1 className="text-2xl font-semibold">Kandidaat bewerken</h1>

      <div className="bg-card rounded-lg border p-6 max-w-3xl">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Voornaam *</Label><Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Achternaam *</Label><Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Geboortedatum</Label><Input type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Nationaliteit</Label><Input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Telefoon</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
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
            <div className="space-y-1.5"><Label>BSN</Label><Input value={form.bsn} onChange={(e) => set('bsn', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>IBAN</Label><Input value={form.iban} onChange={(e) => set('iban', e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={form.has_drivers_license} onCheckedChange={(v) => set('has_drivers_license', !!v)} id="dl" />
              <Label htmlFor="dl">Rijbewijs</Label>
            </div>
            {form.has_drivers_license && (
              <div className="max-w-xs space-y-1.5"><Label>Verloopdatum rijbewijs</Label><Input type="date" value={form.drivers_license_expiry} onChange={(e) => set('drivers_license_expiry', e.target.value)} /></div>
            )}
          </div>
          <div className="space-y-1.5"><Label>Vaardigheden</Label><TagInput value={form.skills} onChange={(v) => set('skills', v)} placeholder="Typ vaardigheid + Enter" /></div>
          <div className="space-y-1.5"><Label>Talen</Label><TagInput value={form.languages} onChange={(v) => set('languages', v)} placeholder="Typ taal + Enter" /></div>
          <div className="space-y-1.5">
            <Label>Bron</Label>
            <Select value={form.source} onValueChange={(v) => set('source', v)}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Selecteer bron" /></SelectTrigger>
              <SelectContent>
                {sources.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate(`/kandidaten/${id}`)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.first_name || !form.last_name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CandidateEdit;
