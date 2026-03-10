import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

const fuelTypes = ['benzine', 'diesel', 'elektrisch', 'hybride', 'lpg'];

const VehicleNew = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    license_plate: '', brand: '', model: '', year: '', fuel_type: '',
    current_mileage: '', tank_capacity_liters: '', fuel_card_reference: '',
    avg_consumption_per_100km: '', notes: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: orgId,
        license_plate: form.license_plate.toUpperCase(),
        brand: form.brand || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year) : null,
        fuel_type: form.fuel_type || null,
        current_mileage: form.current_mileage ? parseInt(form.current_mileage) : null,
        tank_capacity_liters: form.tank_capacity_liters ? parseFloat(form.tank_capacity_liters) : null,
        fuel_card_reference: form.fuel_card_reference || null,
        avg_consumption_per_100km: form.avg_consumption_per_100km ? parseFloat(form.avg_consumption_per_100km) : null,
        status: 'beschikbaar' as const,
        notes: form.notes || null,
      };
      const { data, error } = await supabase.from('vehicles').insert(payload).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Voertuig aangemaakt');
      navigate(`/transport/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/transport" className="hover:text-foreground transition-colors">Transport</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Nieuw voertuig</span>
      </div>

      <h1 className="text-2xl font-semibold">Nieuw voertuig</h1>

      <div className="bg-card rounded-lg border p-6 max-w-3xl">
        <div className="space-y-5">
          <div className="space-y-1.5"><Label>Kenteken *</Label><Input value={form.license_plate} onChange={(e) => set('license_plate', e.target.value.toUpperCase())} className="max-w-xs" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Merk</Label><Input value={form.brand} onChange={(e) => set('brand', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Model</Label><Input value={form.model} onChange={(e) => set('model', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Bouwjaar</Label><Input type="number" value={form.year} onChange={(e) => set('year', e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Brandstof</Label>
              <Select value={form.fuel_type} onValueChange={(v) => set('fuel_type', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer" /></SelectTrigger>
                <SelectContent>
                  {fuelTypes.map((f) => <SelectItem key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Kilometerstand</Label><Input type="number" value={form.current_mileage} onChange={(e) => set('current_mileage', e.target.value)} className="max-w-xs" /></div>

          <div className="pt-2">
            <p className="text-sm font-medium text-muted-foreground mb-3">Tankgegevens</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Tankcapaciteit (liter)</Label><Input type="number" value={form.tank_capacity_liters} onChange={(e) => set('tank_capacity_liters', e.target.value)} placeholder="bijv. 50" /></div>
                <div className="space-y-1.5"><Label>Gem. verbruik (l/100km)</Label><Input type="number" step="0.1" value={form.avg_consumption_per_100km} onChange={(e) => set('avg_consumption_per_100km', e.target.value)} placeholder="bijv. 6.5" /></div>
              </div>
              <div className="space-y-1.5"><Label>Tankpas referentie</Label><Input value={form.fuel_card_reference} onChange={(e) => set('fuel_card_reference', e.target.value)} placeholder="Q8 pasnummer" className="max-w-xs" /></div>
            </div>
          </div>

          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/transport')}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.license_plate || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Voertuig aanmaken'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleNew;
