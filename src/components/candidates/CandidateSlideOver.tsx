import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagInput from '@/components/ui/tag-input';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';
import NationalitySelect from '@/components/shared/NationalitySelect';
import SkillMultiSelect from '@/components/shared/SkillMultiSelect';
import LanguageMultiSelect from '@/components/shared/LanguageMultiSelect';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate?: any;
}

const sources = [
  { value: 'website', label: 'Website' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'indeed', label: 'Indeed' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referral' },
  { value: 'recruitment_partner', label: 'Recruitmentpartner' },
  { value: 'overig', label: 'Overig' },
];

const emptyForm = {
  first_name: '', last_name: '', date_of_birth: '', nationality: '',
  email: '', phone: '', phone_nl: '', emergency_contact_name: '', emergency_contact_phone: '',
  address_street: '', address_postal: '', address_city: '',
  address_lat: null as number | null, address_lng: null as number | null,
  bsn: '', iban: '', has_drivers_license: false, drivers_license_expiry: '',
  skills: [] as string[], languages: [] as string[], source: '', notes: '',
};

const CandidateSlideOver = ({ open, onOpenChange, candidate }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const isEdit = !!candidate;

  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (candidate) {
      setForm({
        first_name: candidate.first_name ?? '',
        last_name: candidate.last_name ?? '',
        date_of_birth: candidate.date_of_birth ?? '',
        nationality: candidate.nationality ?? '',
        email: candidate.email ?? '',
        phone: candidate.phone ?? '',
        phone_nl: candidate.phone_nl ?? '',
        emergency_contact_name: candidate.emergency_contact_name ?? '',
        emergency_contact_phone: candidate.emergency_contact_phone ?? '',
        address_street: candidate.address_street ?? '',
        address_postal: candidate.address_postal ?? '',
        address_city: candidate.address_city ?? '',
        address_lat: candidate.address_lat ?? null,
        address_lng: candidate.address_lng ?? null,
        bsn: candidate.bsn ?? '',
        iban: candidate.iban ?? '',
        has_drivers_license: candidate.has_drivers_license ?? false,
        drivers_license_expiry: candidate.drivers_license_expiry ?? '',
        skills: candidate.skills ?? [],
        languages: candidate.languages ?? [],
        source: candidate.source ?? '',
        notes: candidate.notes ?? '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [candidate, open]);

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
        ...form,
        date_of_birth: form.date_of_birth || null,
        drivers_license_expiry: form.has_drivers_license && form.drivers_license_expiry ? form.drivers_license_expiry : null,
        source: form.source || null,
        notes: form.notes || null,
        bsn: form.bsn || null,
        iban: form.iban || null,
        nationality: form.nationality || null,
        email: form.email || null,
        phone: form.phone || null,
        phone_nl: form.phone_nl || null,
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
        address_street: form.address_street || null,
        address_postal: form.address_postal || null,
        address_city: form.address_city || null,
        address_lat: address.lat,
        address_lng: address.lng,
      };
      if (isEdit) {
        const { error } = await supabase.from('candidates').update(payload as any).eq('id', candidate.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('candidates').insert({ ...payload, organization_id: orgId } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] });
      if (isEdit) qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
      logAudit({
        action: isEdit ? 'update' : 'create',
        tableName: 'candidates',
        recordId: candidate?.id ?? 'new',
        newValues: form,
      });
      toast.success(isEdit ? 'Kandidaat bijgewerkt' : 'Kandidaat aangemaakt');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Kandidaat bewerken' : 'Nieuwe kandidaat'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Voornaam *</Label><Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></div>
            <div><Label>Achternaam *</Label><Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Geboortedatum</Label><Input type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} /></div>
            <div><Label>Nationaliteit</Label><NationalitySelect value={form.nationality} onChange={(v) => set('nationality', v)} /></div>
          </div>
          <div><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Telefoon (EU / buitenland)</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+40 ..." /></div>
            <div><Label>Telefoon (NL)</Label><Input value={form.phone_nl} onChange={(e) => set('phone_nl', e.target.value)} placeholder="+31 6 ..." /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Noodcontact (ICE) — naam</Label><Input value={form.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} /></div>
            <div><Label>Noodcontact (ICE) — telefoon</Label><Input value={form.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', e.target.value)} /></div>
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
            gridClassName="grid-cols-3 gap-3"
            streetLabel="Straat"
          />
          <div className="grid grid-cols-2 gap-3">
            <div><Label>BSN</Label><Input value={form.bsn} onChange={(e) => set('bsn', e.target.value)} /></div>
            <div><Label>IBAN</Label><Input value={form.iban} onChange={(e) => set('iban', e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={form.has_drivers_license} onCheckedChange={(v) => set('has_drivers_license', !!v)} id="dl" />
              <Label htmlFor="dl">Rijbewijs</Label>
            </div>
            {form.has_drivers_license && (
              <div><Label>Verloopdatum rijbewijs</Label><Input type="date" value={form.drivers_license_expiry} onChange={(e) => set('drivers_license_expiry', e.target.value)} /></div>
            )}
          </div>
          <div><Label>Vaardigheden</Label><SkillMultiSelect value={form.skills} onChange={(v) => set('skills', v)} /></div>
          <div><Label>Talen</Label><LanguageMultiSelect value={form.languages} onChange={(v) => set('languages', v)} /></div>
          <div>
            <Label>Bron</Label>
            <Select value={form.source} onValueChange={(v) => set('source', v)}>
              <SelectTrigger><SelectValue placeholder="Selecteer bron" /></SelectTrigger>
              <SelectContent>
                {sources.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.first_name || !form.last_name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CandidateSlideOver;
