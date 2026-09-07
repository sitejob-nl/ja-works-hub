import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VEHICLE_LOCATION_MAX_LENGTH, vehicleLocationText } from '@/lib/vehicle-location';

export interface VehicleLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Het voertuig waarvan de locatie wordt bijgewerkt; vult het veld voor. */
  vehicle: { license_plate?: string | null; last_known_location?: string | null } | null;
  pending: boolean;
  /** De nieuwe locatie; een lege string betekent "wissen". */
  onConfirm: (location: string) => void;
}

/**
 * Bijwerken van de laatste bekende locatie. Eén vrij tekstveld: bewust geen keuzelijst,
 * want een auto staat net zo goed bij een garage, op een adres of bij een medewerker thuis.
 *
 * Leegmaken en opslaan wist de locatie — inclusief tijdstip en naam, zodat er nooit een
 * datum zonder plek overblijft. De knop blijft uit zolang er niets te wijzigen valt, zodat
 * een klik op Opslaan niet stilletjes een nieuw tijdstip zet zonder dat er iets veranderde.
 *
 * De dialoog sluit zichzelf niet na bevestigen: de aanroeper houdt hem open tijdens de
 * mutatie en sluit in `onSuccess` (het ConfirmDialog-patroon).
 */
export function VehicleLocationDialog({ open, onOpenChange, vehicle, pending, onConfirm }: VehicleLocationDialogProps) {
  const current = vehicleLocationText(vehicle) ?? '';
  const [location, setLocation] = useState(current);

  // Vers veld bij elke opening, ook als de dialoog gemount blijft tussen twee openingen.
  useEffect(() => {
    if (open) setLocation(current);
  }, [open, current]);

  const trimmed = location.trim();
  const changed = trimmed !== current;
  const clearing = changed && trimmed === '';

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="default"
      title="Laatste bekende locatie"
      description={
        <>
          Waar staat {vehicle?.license_plate ? <strong>{vehicle.license_plate}</strong> : 'dit voertuig'} voor
          zover bekend? De datum en jouw naam worden automatisch vastgelegd.
        </>
      }
      confirmLabel={clearing ? 'Wissen' : 'Opslaan'}
      pendingLabel={clearing ? 'Wissen...' : 'Opslaan...'}
      pending={pending}
      confirmDisabled={!changed}
      onConfirm={() => {
        if (!changed) return;
        onConfirm(trimmed);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="vehicle-last-known-location">Locatie</Label>
        <Input
          id="vehicle-last-known-location"
          value={location}
          maxLength={VEHICLE_LOCATION_MAX_LENGTH}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Bijv. Parkeerterrein Mierlo of Garage Van Dijk"
        />
        <p className="text-xs text-muted-foreground">
          {clearing
            ? 'Leeg opslaan wist de locatie, de datum en de naam.'
            : 'Laat leeg als de locatie onbekend is — dat is een geldige staat.'}
        </p>
      </div>
    </ConfirmDialog>
  );
}

export default VehicleLocationDialog;
