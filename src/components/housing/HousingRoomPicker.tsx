// Woning + kamer kiezen voor een kandidaat die (nog) geen eigen huisvesting heeft.
// Toont alleen panden/kamers met een vrij bed op de gekozen check-indatum.
// Geeft via onChange de selectie terug incl. het pandadres, zodat de aanroeper het
// kandidaatadres kan vullen én een gereserveerde housing_assignment kan aanmaken.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { roomHasFreeBedOn } from '@/lib/housing-availability';

export type HousingSelection = {
  unitId: string | null;
  propertyId: string | null;
  checkInDate: string;
  unitName?: string | null;
  propertyAddress?: {
    street: string;
    postal: string;
    city: string;
    lat: number | null;
    lng: number | null;
  } | null;
};

type HousingRoomPickerProps = {
  value: HousingSelection;
  onChange: (selection: HousingSelection) => void;
};

const HousingRoomPicker = ({ value, onChange }: HousingRoomPickerProps) => {
  const orgId = useOrganizationId();

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['housing-picker-units', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('units')
        .select('id, name, capacity, status, properties!units_property_id_fkey(id, name, address_street, address_postal, address_city, address_lat, address_lng), housing_assignments!housing_assignments_unit_id_fkey(id, status, check_in_date, check_out_date)')
        .eq('organization_id', orgId)
        .in('status', ['beschikbaar', 'gereserveerd', 'bezet'])
        .order('name');
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!orgId,
  });

  // Beschikbare kamers op de gekozen datum, gegroepeerd per pand.
  const availableUnits = useMemo(
    () => units.filter((u) => roomHasFreeBedOn(u, value.checkInDate)),
    [units, value.checkInDate],
  );

  const properties = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const u of availableUnits) {
      const p = u.properties;
      if (!p?.id) continue;
      if (!map.has(p.id)) {
        const label = p.name || [p.address_street, p.address_city].filter(Boolean).join(', ') || 'Pand';
        map.set(p.id, { id: p.id, label });
      }
    }
    return [...map.values()];
  }, [availableUnits]);

  const unitsForProperty = useMemo(
    () => availableUnits.filter((u) => u.properties?.id === value.propertyId),
    [availableUnits, value.propertyId],
  );

  const selectProperty = (propertyId: string) => {
    onChange({ ...value, propertyId, unitId: null, unitName: null, propertyAddress: null });
  };

  const selectUnit = (unitId: string) => {
    const unit = availableUnits.find((u) => u.id === unitId);
    const p = unit?.properties;
    onChange({
      ...value,
      unitId,
      unitName: unit?.name ?? null,
      propertyId: p?.id ?? value.propertyId,
      propertyAddress: p
        ? {
            street: p.address_street ?? '',
            postal: p.address_postal ?? '',
            city: p.address_city ?? '',
            lat: p.address_lat ?? null,
            lng: p.address_lng ?? null,
          }
        : null,
    });
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Check-in datum</Label>
          <Input
            type="date"
            value={value.checkInDate}
            onChange={(e) => onChange({ ...value, checkInDate: e.target.value, propertyId: null, unitId: null, unitName: null, propertyAddress: null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Woning</Label>
          <Select value={value.propertyId ?? ''} onValueChange={selectProperty} disabled={isLoading || properties.length === 0}>
            <SelectTrigger><SelectValue placeholder={properties.length === 0 ? 'Geen vrije kamers' : 'Kies woning'} /></SelectTrigger>
            <SelectContent>
              {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Kamer</Label>
          <Select value={value.unitId ?? ''} onValueChange={selectUnit} disabled={!value.propertyId || unitsForProperty.length === 0}>
            <SelectTrigger><SelectValue placeholder={!value.propertyId ? 'Kies eerst woning' : 'Kies kamer'} /></SelectTrigger>
            <SelectContent>
              {unitsForProperty.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {properties.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">Geen kamers met een vrij bed op deze datum. Kies een andere datum of voeg huisvesting toe.</p>
      )}
      {value.unitId && value.propertyAddress && (
        <p className="text-xs text-muted-foreground">
          Adres wordt overgenomen: {[value.propertyAddress.street, value.propertyAddress.postal, value.propertyAddress.city].filter(Boolean).join(', ')}
        </p>
      )}
    </div>
  );
};

export default HousingRoomPicker;
