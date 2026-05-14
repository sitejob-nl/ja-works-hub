import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';
import OwnerSelector from '@/components/housing/OwnerSelector';
import { Upload } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: any;
}

const num = (v: any) => (v != null ? String(v) : '');
const toNum = (v: string) => (v ? Number(v) : null);

const PropertySlideOver = ({ open, onOpenChange, property }: Props) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!property;

  const defaults = {
    name: '', address_street: '', address_postal: '', address_city: '',
    address_lat: null as number | null, address_lng: null as number | null,
    // owner
    owner_id: null as string | null,
    rental_contract_start_date: '', rental_contract_end_date: '', rental_contract_notes: '',
    // permits
    has_rental_permit: false, rental_permit_number: '', rental_permit_expiry: '',
    has_snf_certificate: false, snf_certificate_number: '', snf_certificate_expiry: '',
    max_persons_permit: '',
    // costs
    monthly_rent: '', cost_gas: '', cost_water: '', cost_electra: '',
    cost_municipal_tax: '', cost_other: '',
    // energy
    energy_wizard_id: '', energy_wizard_linked: false,
    // other
    total_capacity: '', notes: '',
  };

  const [form, setForm] = useState(defaults);
  const [rentalContractFile, setRentalContractFile] = useState<File | null>(null);

  useEffect(() => {
    if (property) {
      setForm({
        name: property.name ?? '', address_street: property.address_street ?? '',
        address_postal: property.address_postal ?? '', address_city: property.address_city ?? '',
        address_lat: property.address_lat ?? null, address_lng: property.address_lng ?? null,
        owner_id: property.owner_id ?? null,
        rental_contract_start_date: property.rental_contract_start_date ?? '',
        rental_contract_end_date: property.rental_contract_end_date ?? '',
        rental_contract_notes: property.rental_contract_notes ?? '',
        has_rental_permit: property.has_rental_permit ?? false,
        rental_permit_number: property.rental_permit_number ?? '',
        rental_permit_expiry: property.rental_permit_expiry ?? '',
        has_snf_certificate: property.has_snf_certificate ?? false,
        snf_certificate_number: property.snf_certificate_number ?? '',
        snf_certificate_expiry: property.snf_certificate_expiry ?? '',
        max_persons_permit: num(property.max_persons_permit),
        monthly_rent: num(property.monthly_rent),
        cost_gas: num(property.cost_gas), cost_water: num(property.cost_water),
        cost_electra: num(property.cost_electra),
        cost_municipal_tax: num(property.cost_municipal_tax),
        cost_other: num(property.cost_other),
        energy_wizard_id: property.energy_wizard_id ?? '',
        energy_wizard_linked: property.energy_wizard_linked ?? false,
        total_capacity: num(property.total_capacity),
        notes: property.notes ?? '',
      });
    } else {
      setForm(defaults);
    }
    setRentalContractFile(null);
  }, [property, open]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const totalCosts = useMemo(() => {
    const vals = [form.monthly_rent, form.cost_gas, form.cost_water, form.cost_electra, form.cost_municipal_tax, form.cost_other];
    return vals.reduce((s, v) => s + (v ? Number(v) : 0), 0);
  }, [form.monthly_rent, form.cost_gas, form.cost_water, form.cost_electra, form.cost_municipal_tax, form.cost_other]);

  const uploadRentalContract = async (propertyId: string) => {
    if (!rentalContractFile) return false;

    const ext = rentalContractFile.name.split('.').pop()?.toLowerCase() || 'pdf';
    const path = `${orgId}/${propertyId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('property-contracts')
      .upload(path, rentalContractFile, { upsert: false });

    if (uploadError) throw uploadError;

    const { error: contractError } = await supabase.from('property_contracts' as any).insert({
      organization_id: orgId,
      property_id: propertyId,
      file_path: path,
      original_name: rentalContractFile.name,
      contract_type: 'inhuur',
      start_date: form.rental_contract_start_date || null,
      end_date: form.rental_contract_end_date || null,
      notes: form.rental_contract_notes || null,
      uploaded_by: user?.id ?? null,
    });

    if (contractError) {
      await supabase.storage.from('property-contracts').remove([path]);
      throw contractError;
    }

    return true;
  };

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
        name: form.name?.trim() || null,
        address_street: form.address_street,
        address_postal: form.address_postal,
        address_city: form.address_city,
        address_lat: address.lat,
        address_lng: address.lng,
        owner_id: form.owner_id,
        rental_contract_start_date: form.rental_contract_start_date || null,
        rental_contract_end_date: form.rental_contract_end_date || null,
        rental_contract_notes: form.rental_contract_notes || null,
        has_rental_permit: form.has_rental_permit,
        rental_permit_number: form.has_rental_permit ? (form.rental_permit_number || null) : null,
        rental_permit_expiry: form.has_rental_permit ? (form.rental_permit_expiry || null) : null,
        has_snf_certificate: form.has_snf_certificate,
        snf_certificate_number: form.has_snf_certificate ? (form.snf_certificate_number || null) : null,
        snf_certificate_expiry: form.has_snf_certificate ? (form.snf_certificate_expiry || null) : null,
        max_persons_permit: toNum(form.max_persons_permit),
        monthly_rent: toNum(form.monthly_rent),
        cost_gas: toNum(form.cost_gas),
        cost_water: toNum(form.cost_water),
        cost_electra: toNum(form.cost_electra),
        cost_municipal_tax: toNum(form.cost_municipal_tax),
        cost_other: toNum(form.cost_other),
        cost_price: totalCosts || null,
        energy_wizard_id: form.energy_wizard_id || null,
        energy_wizard_linked: form.energy_wizard_linked,
        total_capacity: form.total_capacity ? Number(form.total_capacity) : 0,
        notes: form.notes || null,
      };
      let propertyId: string;
      if (isEdit) {
        const { error } = await supabase.from('properties').update(payload).eq('id', property.id);
        if (error) throw error;
        propertyId = property.id as string;
      } else {
        const { data, error } = await supabase.from('properties').insert({ ...payload, organization_id: orgId }).select('id').single();
        if (error) throw error;
        propertyId = data.id as string;
      }

      const uploadedContract = await uploadRentalContract(propertyId);
      return { propertyId, uploadedContract };
    },
    onSuccess: ({ propertyId, uploadedContract }: { propertyId: string; uploadedContract: boolean }) => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      qc.invalidateQueries({ queryKey: ['property-contracts'] });
      qc.invalidateQueries({ queryKey: ['property-contracts-recent'] });
      toast.success(uploadedContract
        ? (isEdit ? 'Pand bijgewerkt en contract geüpload' : 'Pand aangemaakt en contract geüpload')
        : (isEdit ? 'Pand bijgewerkt' : 'Pand aangemaakt'));
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? 'Opslaan of uploaden mislukt'),
  });

  const SectionHeader = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-foreground tracking-wide uppercase">{children}</h3>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>{isEdit ? 'Pand bewerken' : 'Nieuw pand'}</SheetTitle></SheetHeader>
        <div className="space-y-6 mt-6">

          {/* Section 1: Address */}
          <div className="space-y-3">
            <SectionHeader>Adresgegevens</SectionHeader>
            <AddressAutocomplete
              value={{
                street: form.address_street,
                postal: form.address_postal,
                city: form.address_city,
                lat: form.address_lat,
                lng: form.address_lng,
              }}
              onChange={(address) => setForm((f) => ({
                ...f,
                address_street: address.street,
                address_postal: address.postal,
                address_city: address.city,
                address_lat: address.lat ?? null,
                address_lng: address.lng ?? null,
              }))}
              gridClassName="grid-cols-3 gap-3"
              required
              streetLabel="Straat"
            />
            <div>
              <Label className="text-xs text-muted-foreground">Bijnaam (optioneel)</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Laat leeg om adres als naam te tonen" />
            </div>
          </div>

          <Separator />

          {/* Section 2: Owner */}
          <div className="space-y-3">
            <SectionHeader>Eigenaar / Verhuurder</SectionHeader>
            <div>
              <Label>Eigenaar</Label>
              <OwnerSelector value={form.owner_id} onChange={(id) => set('owner_id', id)} showManageLink />
            </div>
            <div>
              <Label>Huurcontractbestand</Label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => setRentalContractFile(e.target.files?.[0] ?? null)}
              />
              {rentalContractFile && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  <Upload className="mr-1 inline h-3 w-3" />
                  {rentalContractFile.name}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Huurcontract begindatum</Label><Input type="date" value={form.rental_contract_start_date} onChange={(e) => set('rental_contract_start_date', e.target.value)} /></div>
              <div><Label>Huurcontract einddatum</Label><Input type="date" value={form.rental_contract_end_date} onChange={(e) => set('rental_contract_end_date', e.target.value)} /></div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Notities huurcontract</Label>
              <Textarea value={form.rental_contract_notes} onChange={(e) => set('rental_contract_notes', e.target.value)} rows={2} placeholder="Bijv. opzegtermijn, kosten bij verlenging..." />
            </div>
          </div>

          <Separator />

          {/* Section 3: Permits */}
          <div className="space-y-3">
            <SectionHeader>Vergunningen</SectionHeader>
            <div className="flex items-center justify-between">
              <Label>Kamerverhuurvergunning</Label>
              <Switch checked={form.has_rental_permit} onCheckedChange={(v) => set('has_rental_permit', v)} />
            </div>
            {form.has_rental_permit && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Vergunningsnummer</Label><Input value={form.rental_permit_number} onChange={(e) => set('rental_permit_number', e.target.value)} /></div>
                <div><Label>Verloopdatum</Label><Input type="date" value={form.rental_permit_expiry} onChange={(e) => set('rental_permit_expiry', e.target.value)} /></div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label>SNF Certificaat</Label>
              <Switch checked={form.has_snf_certificate} onCheckedChange={(v) => set('has_snf_certificate', v)} />
            </div>
            {form.has_snf_certificate && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Certificaatnummer</Label><Input value={form.snf_certificate_number} onChange={(e) => set('snf_certificate_number', e.target.value)} /></div>
                <div><Label>Verloopdatum</Label><Input type="date" value={form.snf_certificate_expiry} onChange={(e) => set('snf_certificate_expiry', e.target.value)} /></div>
              </div>
            )}
            <div><Label>Max personen vergunning</Label><Input type="number" value={form.max_persons_permit} onChange={(e) => set('max_persons_permit', e.target.value)} /></div>
          </div>

          <Separator />

          {/* Section 4: Monthly costs */}
          <div className="space-y-3">
            <SectionHeader>Maandelijkse lasten</SectionHeader>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Huur (€)</Label><Input type="number" value={form.monthly_rent} onChange={(e) => set('monthly_rent', e.target.value)} /></div>
              <div><Label>Gas (€)</Label><Input type="number" value={form.cost_gas} onChange={(e) => set('cost_gas', e.target.value)} /></div>
              <div><Label>Water (€)</Label><Input type="number" value={form.cost_water} onChange={(e) => set('cost_water', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Elektra (€)</Label><Input type="number" value={form.cost_electra} onChange={(e) => set('cost_electra', e.target.value)} /></div>
              <div><Label>Gemeentelijke belasting (€)</Label><Input type="number" value={form.cost_municipal_tax} onChange={(e) => set('cost_municipal_tax', e.target.value)} /></div>
              <div><Label>Overige kosten (€)</Label><Input type="number" value={form.cost_other} onChange={(e) => set('cost_other', e.target.value)} /></div>
            </div>
            <div className="flex items-center justify-between rounded-md bg-muted px-4 py-2">
              <span className="text-sm font-medium text-foreground">Totale maandlasten</span>
              <span className="text-sm font-bold text-foreground">€ {totalCosts.toFixed(2)}</span>
            </div>
          </div>

          <Separator />

          {/* Section 5: EnergyWizard */}
          <div className="space-y-3">
            <SectionHeader>EnergyWizard</SectionHeader>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div><Label>EnergyWizard ID</Label><Input value={form.energy_wizard_id} onChange={(e) => set('energy_wizard_id', e.target.value)} /></div>
              <div className="flex items-center gap-3 pb-1">
                <Label>Gekoppeld</Label>
                <Switch checked={form.energy_wizard_linked} onCheckedChange={(v) => set('energy_wizard_linked', v)} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Section 6: Other */}
          <div className="space-y-3">
            <SectionHeader>Overig</SectionHeader>
            <div><Label>Totale capaciteit</Label><Input type="number" value={form.total_capacity} onChange={(e) => set('total_capacity', e.target.value)} /></div>
            <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.address_street || !form.address_postal || !form.address_city || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PropertySlideOver;
