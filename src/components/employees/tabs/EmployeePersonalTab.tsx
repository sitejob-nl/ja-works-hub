import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import SensitiveField from '@/components/ui/sensitive-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, X, Check, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { differenceInDays, parseISO } from 'date-fns';

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const genderOptions = [
  { value: 'man', label: 'Man' },
  { value: 'vrouw', label: 'Vrouw' },
  { value: 'anders', label: 'Anders' },
  { value: 'onbekend', label: 'Onbekend' },
];

const maritalOptions = [
  { value: 'ongehuwd', label: 'Ongehuwd' },
  { value: 'gehuwd', label: 'Gehuwd' },
  { value: 'geregistreerd_partner', label: 'Geregistreerd partner' },
  { value: 'gescheiden', label: 'Gescheiden' },
  { value: 'weduwe_weduwnaar', label: 'Weduwe/weduwnaar' },
];

const idDocTypes = [
  { value: 'paspoort', label: 'Paspoort' },
  { value: 'id_kaart', label: 'ID-kaart' },
  { value: 'rijbewijs', label: 'Rijbewijs' },
  { value: 'verblijfsdocument', label: 'Verblijfsdocument' },
];

const genderLabel: Record<string, string> = { man: 'Man', vrouw: 'Vrouw', anders: 'Anders', onbekend: 'Onbekend' };
const maritalLabel: Record<string, string> = { ongehuwd: 'Ongehuwd', gehuwd: 'Gehuwd', geregistreerd_partner: 'Geregistreerd partner', gescheiden: 'Gescheiden', weduwe_weduwnaar: 'Weduwe/weduwnaar' };
const idDocLabel: Record<string, string> = { paspoort: 'Paspoort', id_kaart: 'ID-kaart', rijbewijs: 'Rijbewijs', verblijfsdocument: 'Verblijfsdocument' };

const EmployeePersonalTab = ({ candidateId, candidate }: { candidateId: string; candidate: any }) => {
  const c = candidate;
  const qc = useQueryClient();
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidateId);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  const idExpiryWarning = c?.id_document_valid_until
    ? differenceInDays(parseISO(c.id_document_valid_until), new Date()) <= 30 && differenceInDays(parseISO(c.id_document_valid_until), new Date()) >= 0
    : false;
  const idExpired = c?.id_document_valid_until
    ? differenceInDays(parseISO(c.id_document_valid_until), new Date()) < 0
    : false;

  const startEdit = () => {
    setForm({
      gender: c?.gender ?? '', first_name: c?.first_name ?? '', middle_name: c?.middle_name ?? '',
      last_name: c?.last_name ?? '', initials: c?.initials ?? '',
      marital_status: c?.marital_status ?? '', date_of_birth: c?.date_of_birth ?? '',
      birth_place: c?.birth_place ?? '', birth_country: c?.birth_country ?? '',
      address_street: c?.address_street ?? '', address_postal: c?.address_postal ?? '',
      address_city: c?.address_city ?? '', address_country: c?.address_country ?? '',
      phone: c?.phone ?? '', email: c?.email ?? '',
      id_document_type: c?.id_document_type ?? '', id_document_number: c?.id_document_number ?? '',
      id_document_valid_until: c?.id_document_valid_until ?? '',
      bank_account_holder: c?.bank_account_holder ?? '',
    });
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('candidates').update({
        gender: form.gender || null, first_name: form.first_name, middle_name: form.middle_name || null,
        last_name: form.last_name, initials: form.initials || null,
        marital_status: form.marital_status || null, date_of_birth: form.date_of_birth || null,
        birth_place: form.birth_place || null, birth_country: form.birth_country || null,
        address_street: form.address_street || null, address_postal: form.address_postal || null,
        address_city: form.address_city || null, address_country: form.address_country || null,
        phone: form.phone || null, email: form.email || null,
        id_document_type: form.id_document_type || null, id_document_number: form.id_document_number || null,
        id_document_valid_until: form.id_document_valid_until || null,
        bank_account_holder: form.bank_account_holder || null,
      }).eq('id', candidateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      setEditing(false);
      toast.success('Persoonsgegevens bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">Persoonsgegevens bewerken</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Check className="h-4 w-4 mr-1" />Opslaan</Button>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Naam & persoonlijk</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><Label>Geslacht</Label>
              <Select value={form.gender} onValueChange={v => set('gender', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>{genderOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Voornaam *</Label><Input value={form.first_name} onChange={e => set('first_name', e.target.value)} /></div>
            <div><Label>Tussenvoegsel</Label><Input value={form.middle_name} onChange={e => set('middle_name', e.target.value)} /></div>
            <div><Label>Achternaam *</Label><Input value={form.last_name} onChange={e => set('last_name', e.target.value)} /></div>
            <div><Label>Initialen</Label><Input value={form.initials} onChange={e => set('initials', e.target.value)} /></div>
            <div><Label>Burgerlijke staat</Label>
              <Select value={form.marital_status} onValueChange={v => set('marital_status', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>{maritalOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Geboortedatum</Label><Input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></div>
            <div><Label>Geboorteplaats</Label><Input value={form.birth_place} onChange={e => set('birth_place', e.target.value)} /></div>
            <div><Label>Geboorteland</Label><Input value={form.birth_country} onChange={e => set('birth_country', e.target.value)} /></div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Adres & contact</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2"><Label>Straat + huisnr</Label><Input value={form.address_street} onChange={e => set('address_street', e.target.value)} /></div>
            <div><Label>Postcode</Label><Input value={form.address_postal} onChange={e => set('address_postal', e.target.value)} /></div>
            <div><Label>Stad</Label><Input value={form.address_city} onChange={e => set('address_city', e.target.value)} /></div>
            <div><Label>Land</Label><Input value={form.address_country} onChange={e => set('address_country', e.target.value)} /></div>
            <div><Label>Telefoon</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Identiteitsdocument</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Type</Label>
              <Select value={form.id_document_type} onValueChange={v => set('id_document_type', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>{idDocTypes.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Documentnummer</Label><Input value={form.id_document_number} onChange={e => set('id_document_number', e.target.value)} /></div>
            <div><Label>Geldig tot</Label><Input type="date" value={form.id_document_valid_until} onChange={e => set('id_document_valid_until', e.target.value)} /></div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Bankgegevens</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>Rekeninghouder</Label><Input value={form.bank_account_holder} onChange={e => set('bank_account_holder', e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">BSN en IBAN zijn versleuteld en kunnen alleen via de beveiligde weergave bekeken worden.</p>
        </div>
      </div>
    );
  }

  const address = [c?.address_street, c?.address_postal, c?.address_city, c?.address_country].filter(Boolean).join(', ') || null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <Button size="sm" variant="ghost" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /></Button>
      </div>

      {(idExpiryWarning || idExpired) && (
        <div className={`flex items-center gap-2 p-3 rounded-lg border ${idExpired ? 'bg-red-50 border-red-200 text-red-700' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm">{idExpired ? 'ID document is verlopen!' : 'ID document verloopt binnen 30 dagen!'} Verloopt op {formatDate(c.id_document_valid_until)}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Naam & persoonlijk</h4>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Geslacht" value={genderLabel[c?.gender] ?? c?.gender} />
            <Field label="Initialen" value={c?.initials} />
            <Field label="Voornaam" value={c?.first_name} />
            <Field label="Tussenvoegsel" value={c?.middle_name} />
            <Field label="Achternaam" value={c?.last_name} />
            <Field label="Burgerlijke staat" value={maritalLabel[c?.marital_status] ?? c?.marital_status} />
            <Field label="Geboortedatum" value={formatDate(c?.date_of_birth)} />
            <Field label="Geboorteplaats" value={c?.birth_place} />
            <Field label="Geboorteland" value={c?.birth_country} />
            <Field label="Nationaliteit" value={c?.nationality} />
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Adres & contact</h4>
          <Field label="Adres" value={address} />
          <Field label="Telefoon" value={c?.phone} />
          <Field label="E-mail" value={c?.email} />
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Identiteitsdocument</h4>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type" value={idDocLabel[c?.id_document_type] ?? c?.id_document_type} />
            <Field label="Documentnummer" value={c?.id_document_number} />
            <Field label="Geldig tot" value={formatDate(c?.id_document_valid_until)} />
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Bankgegevens</h4>
          <SensitiveField label="BSN" value={sensitive?.decrypted_bsn} loading={sensitiveLoading} />
          <SensitiveField label="IBAN" value={sensitive?.decrypted_iban} loading={sensitiveLoading} />
          <Field label="Rekeninghouder" value={c?.bank_account_holder} />
        </div>
      </div>
    </div>
  );
};

export default EmployeePersonalTab;
