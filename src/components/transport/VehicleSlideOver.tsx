import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle?: any;
}

const fuelTypes = ['benzine', 'diesel', 'elektrisch', 'hybride', 'lpg'];

const emptyForm = {
  license_plate: '', brand: '', model: '', year: '', fuel_type: '',
  current_mileage: '', tank_capacity_liters: '', fuel_card_reference: '',
  avg_consumption_per_100km: '', status: 'beschikbaar', notes: '',
};

const VehicleSlideOver = ({ open, onOpenChange, vehicle }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const isEdit = !!vehicle;
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (vehicle) {
      setForm({
        license_plate: vehicle.license_plate ?? '',
        brand: vehicle.brand ?? '',
        model: vehicle.model ?? '',
        year: vehicle.year?.toString() ?? '',
        fuel_type: vehicle.fuel_type ?? '',
        current_mileage: vehicle.current_mileage?.toString() ?? '',
        tank_capacity_liters: vehicle.tank_capacity_liters?.toString() ?? '',
        fuel_card_reference: vehicle.fuel_card_reference ?? '',
        avg_consumption_per_100km: vehicle.avg_consumption_per_100km?.toString() ?? '',
        status: vehicle.status ?? 'beschikbaar',
        notes: vehicle.notes ?? '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [vehicle, open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        license_plate: form.license_plate.toUpperCase(),
        brand: form.brand || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year) : null,
        fuel_type: form.fuel_type || null,
        current_mileage: form.current_mileage ? parseInt(form.current_mileage) : null,
        tank_capacity_liters: form.tank_capacity_liters ? parseFloat(form.tank_capacity_liters) : null,
        fuel_card_reference: form.fuel_card_reference || null,
        avg_consumption_per_100km: form.avg_consumption_per_100km ? parseFloat(form.avg_consumption_per_100km) : null,
        status: form.status as any,
        notes: form.notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from('vehicles').update(payload).eq('id', vehicle.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vehicles').insert({ ...payload, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      if (isEdit) qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      toast.success(isEdit ? 'Voertuig bijgewerkt' : 'Voertuig aangemaakt');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>{isEdit ? 'Voertuig bewerken' : 'Nieuw voertuig'}</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div><Label>Kenteken *</Label><Input value={form.license_plate} onChange={(e) => set('license_plate', e.target.value.toUpperCase())} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Merk</Label><Input value={form.brand} onChange={(e) => set('brand', e.target.value)} /></div>
            <div><Label>Model</Label><Input value={form.model} onChange={(e) => set('model', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Bouwjaar</Label><Input type="number" value={form.year} onChange={(e) => set('year', e.target.value)} /></div>
            <div>
              <Label>Brandstof</Label>
              <Select value={form.fuel_type} onValueChange={(v) => set('fuel_type', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer" /></SelectTrigger>
                <SelectContent>
                  {fuelTypes.map((f) => <SelectItem key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Kilometerstand</Label><Input type="number" value={form.current_mileage} onChange={(e) => set('current_mileage', e.target.value)} /></div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="beschikbaar">Beschikbaar</SelectItem>
                <SelectItem value="onderhoud">Onderhoud</SelectItem>
                <SelectItem value="uit_dienst">Uit dienst</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.license_plate || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VehicleSlideOver;
