import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: any;
}

const PropertySlideOver = ({ open, onOpenChange, property }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const isEdit = !!property;

  const [form, setForm] = useState({
    name: '', address_street: '', address_postal: '', address_city: '',
    owner_name: '', monthly_rent: '', cost_price: '', total_capacity: '',
    notes: '',
  });

  useEffect(() => {
    if (property) {
      setForm({
        name: property.name ?? '', address_street: property.address_street ?? '',
        address_postal: property.address_postal ?? '', address_city: property.address_city ?? '',
        owner_name: property.owner_name ?? '',
        monthly_rent: property.monthly_rent != null ? String(property.monthly_rent) : '',
        cost_price: property.cost_price != null ? String(property.cost_price) : '',
        total_capacity: property.total_capacity != null ? String(property.total_capacity) : '',
        notes: property.notes ?? '',
      });
    } else {
      setForm({ name: '', address_street: '', address_postal: '', address_city: '', owner_name: '', monthly_rent: '', cost_price: '', total_capacity: '', notes: '' });
    }
  }, [property, open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        address_street: form.address_street,
        address_postal: form.address_postal,
        address_city: form.address_city,
        owner_name: form.owner_name || null,
        monthly_rent: form.monthly_rent ? Number(form.monthly_rent) : null,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        total_capacity: form.total_capacity ? Number(form.total_capacity) : 0,
        notes: form.notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from('properties').update(payload).eq('id', property.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('properties').insert({ ...payload, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      toast.success(isEdit ? 'Pand bijgewerkt' : 'Pand aangemaakt');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>{isEdit ? 'Pand bewerken' : 'Nieuw pand'}</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div><Label>Pandnaam *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1"><Label>Straat *</Label><Input value={form.address_street} onChange={(e) => set('address_street', e.target.value)} /></div>
            <div><Label>Postcode *</Label><Input value={form.address_postal} onChange={(e) => set('address_postal', e.target.value)} /></div>
            <div><Label>Stad *</Label><Input value={form.address_city} onChange={(e) => set('address_city', e.target.value)} /></div>
          </div>
          <div><Label>Eigenaar</Label><Input value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Maandelijkse huur (€)</Label><Input type="number" value={form.monthly_rent} onChange={(e) => set('monthly_rent', e.target.value)} /></div>
            <div><Label>Kostprijs (€)</Label><Input type="number" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} /></div>
          </div>
          <div><Label>Totale capaciteit</Label><Input type="number" value={form.total_capacity} onChange={(e) => set('total_capacity', e.target.value)} /></div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.name || !form.address_street || !form.address_postal || !form.address_city || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PropertySlideOver;
