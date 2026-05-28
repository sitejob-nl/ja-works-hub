import { useState, useEffect } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useMyDecryptedData } from '@/hooks/useDecryptedCandidate';
import SensitiveField from '@/components/ui/sensitive-field';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';
import { useTranslation } from '@/hooks/useTranslation';
import type { PlatformLanguage } from '@/contexts/translation-context';

const PortalProfile = () => {
  const { employee, candidate } = usePortal();
  const { language, setLanguage } = useTranslation();
  const qc = useQueryClient();
  const { data: sensitive, isLoading: sensitiveLoading } = useMyDecryptedData();

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [postal, setPostal] = useState('');
  const [city, setCity] = useState('');
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);
  const [lang, setLang] = useState<PlatformLanguage>('nl');

  useEffect(() => {
    if (candidate) {
      setPhone(candidate.phone ?? '');
      setEmail(candidate.email ?? '');
      setStreet(candidate.address_street ?? '');
      setPostal(candidate.address_postal ?? '');
      setCity(candidate.address_city ?? '');
      setAddressLat(candidate.address_lat ?? null);
      setAddressLng(candidate.address_lng ?? null);
    }
    if (employee) {
      setLang(employee.portal_language === 'en' ? 'en' : 'nl');
    }
  }, [candidate, employee]);

  useEffect(() => {
    setLang(language);
  }, [language]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!candidate?.id) throw new Error('Geen profiel gevonden');
      const address = await resolveAddressCoordinates({ street, postal, city, lat: addressLat, lng: addressLng });

      const { error: cErr } = await supabase
        .from('candidates')
        .update({
          phone: phone || null,
          email: email || null,
          address_street: street || null,
          address_postal: postal || null,
          address_city: city || null,
          address_lat: address.lat,
          address_lng: address.lng,
          portal_language: lang,
        } as any)
        .eq('id', candidate.id);
      if (cErr) throw cErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-employee'] });
      toast.success('Profiel opgeslagen');
    },
    onError: (err: any) => toast.error(err.message || 'Opslaan mislukt'),
  });

  if (!candidate || !employee) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mijn profiel</h1>

      {/* Readonly section */}
      <div className="bg-card rounded-xl border p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Persoonlijke gegevens</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Voornaam</Label>
            <p className="text-sm font-medium">{candidate.first_name}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Achternaam</Label>
            <p className="text-sm font-medium">{candidate.last_name}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Geboortedatum</Label>
            <p className="text-sm font-medium">
              {candidate.date_of_birth ? format(new Date(candidate.date_of_birth), 'dd-MM-yyyy') : '—'}
            </p>
          </div>
          <div>
            <SensitiveField label="BSN" value={sensitive?.decrypted_bsn} loading={sensitiveLoading} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Personeelsnummer</Label>
            <p className="text-sm font-medium">{employee.employee_number ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Editable section */}
      <div className="bg-card rounded-xl border p-4 space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contactgegevens</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Telefoon</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <AddressAutocomplete
            value={{ street, postal, city, lat: addressLat, lng: addressLng }}
            onChange={(address) => {
              setStreet(address.street);
              setPostal(address.postal);
              setCity(address.city);
              setAddressLat(address.lat ?? null);
              setAddressLng(address.lng ?? null);
            }}
            gridClassName="grid-cols-1 sm:grid-cols-2 gap-3"
            streetClassName="sm:col-span-2"
          />
          <div className="space-y-1.5">
            <Label>Taal portaal</Label>
            <Select value={lang} onValueChange={(value) => {
              const nextLanguage = value === 'en' ? 'en' : 'nl';
              setLang(nextLanguage);
              setLanguage(nextLanguage);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nl">Nederlands</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full gap-2"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
        </Button>
      </div>
    </div>
  );
};

export default PortalProfile;
