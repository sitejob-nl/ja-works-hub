import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: any;
}

const CompanySlideOver = ({ open, onOpenChange, company }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const isEdit = !!company;

  const [form, setForm] = useState({
    name: company?.name ?? '',
    kvk_number: company?.kvk_number ?? '',
    btw_number: company?.btw_number ?? '',
    address_street: company?.address_street ?? '',
    address_postal: company?.address_postal ?? '',
    address_city: company?.address_city ?? '',
    address_lat: (company?.address_lat ?? null) as number | null,
    address_lng: (company?.address_lng ?? null) as number | null,
    phone: company?.phone ?? '',
    email: company?.email ?? '',
    website: company?.website ?? '',
    notes: company?.notes ?? '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    setForm({
      name: company?.name ?? '',
      kvk_number: company?.kvk_number ?? '',
      btw_number: company?.btw_number ?? '',
      address_street: company?.address_street ?? '',
      address_postal: company?.address_postal ?? '',
      address_city: company?.address_city ?? '',
      address_lat: company?.address_lat ?? null,
      address_lng: company?.address_lng ?? null,
      phone: company?.phone ?? '',
      email: company?.email ?? '',
      website: company?.website ?? '',
      notes: company?.notes ?? '',
    });
  }, [company, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const address = await resolveAddressCoordinates({
        street: form.address_street,
        postal: form.address_postal,
        city: form.address_city,
        lat: form.address_lat,
        lng: form.address_lng,
      });
      const payload = { ...form, address_lat: address.lat, address_lng: address.lng };
      if (isEdit) {
        const { error } = await supabase.from('companies').update(payload).eq('id', company.id);
        if (error) throw error;
        return company.id as string;
      } else {
        const { data, error } = await supabase.from('companies').insert({ ...payload, organization_id: orgId }).select('id').single();
        if (error) throw error;
        return data.id as string;
      }
    },
    onSuccess: (savedId: string) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      logAudit({
        action: isEdit ? 'update' : 'create',
        tableName: 'companies',
        recordId: savedId,
        newValues: form,
      });
      toast.success(isEdit ? 'Opdrachtgever bijgewerkt' : 'Opdrachtgever aangemaakt');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Opdrachtgever bewerken' : 'Nieuwe opdrachtgever'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Bedrijfsnaam *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>KVK-nummer</Label><Input value={form.kvk_number} onChange={(e) => set('kvk_number', e.target.value)} /></div>
            <div><Label>BTW-nummer</Label><Input value={form.btw_number} onChange={(e) => set('btw_number', e.target.value)} /></div>
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
            <div><Label>Telefoon</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </div>
          <div>
            <Label>Website</Label>
            <Input value={form.website} onChange={(e) => set('website', e.target.value)} />
          </div>
          <div>
            <Label>Notities</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CompanySlideOver;
