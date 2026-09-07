import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/tasks';
import { parseVehicleMileage, vehicleReturnIssue, vehicleReturnReady } from '@/lib/assignments';

export interface VehicleReturnDialogProps {
  /** De lopende toewijzing; null sluit de dialoog. */
  assignment: { id: string; assigned_date?: string | null; start_mileage?: number | null } | null;
  /** Kenteken (of andere omschrijving) voor in de uitleg. */
  vehicleLabel?: string | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: (values: { returnedDate: string; endMileage: number }) => void;
}

/**
 * Inleverdialoog voor een voertuigtoewijzing, gedeeld door de voertuigkant en het
 * medewerkersdossier. Vraagt inleverdatum (standaard vandaag) en eindkilometerstand;
 * de validatie zit in `vehicleReturnIssue`, zodat beide kanten dezelfde grenzen hanteren.
 *
 * De dialoog sluit zichzelf niet na bevestigen: de aanroeper houdt hem open tijdens de
 * mutatie en sluit in `onSuccess` (het ConfirmDialog-patroon).
 */
export function VehicleReturnDialog({ assignment, vehicleLabel, onOpenChange, pending, onConfirm }: VehicleReturnDialogProps) {
  const [returnedDate, setReturnedDate] = useState(todayISO());
  const [endMileage, setEndMileage] = useState('');

  // Verse velden per toewijzing, ook als de dialoog gemount blijft tussen twee openingen.
  const assignmentId = assignment?.id ?? null;
  useEffect(() => {
    if (!assignmentId) return;
    setReturnedDate(todayISO());
    setEndMileage('');
  }, [assignmentId]);

  const input = {
    assignedDate: assignment?.assigned_date ?? null,
    startMileage: assignment?.start_mileage ?? null,
    returnedDate,
    endMileage,
  };
  const issue = vehicleReturnIssue(input);
  const ready = vehicleReturnReady(input);

  return (
    <ConfirmDialog
      open={!!assignment}
      onOpenChange={onOpenChange}
      variant="default"
      title="Voertuig inleveren"
      description={
        <>
          Beëindigt de toewijzing{vehicleLabel ? <> van <strong>{vehicleLabel}</strong></> : null} per de inleverdatum.
          Het voertuig komt weer op Beschikbaar zodra er geen lopende toewijzing meer is.
        </>
      }
      confirmLabel="Inleveren"
      pendingLabel="Inleveren..."
      pending={pending}
      confirmDisabled={!ready}
      onConfirm={() => {
        const km = parseVehicleMileage(endMileage);
        if (!ready || km == null) return;
        onConfirm({ returnedDate, endMileage: km });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="vehicle-return-date">Inleverdatum *</Label>
        <Input
          id="vehicle-return-date"
          type="date"
          value={returnedDate}
          min={assignment?.assigned_date ?? undefined}
          onChange={(e) => setReturnedDate(e.target.value)}
        />
        {assignment?.assigned_date && (
          <p className="text-xs text-muted-foreground">Toegewezen sinds {formatDate(assignment.assigned_date)}.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vehicle-return-km">Eind kilometerstand *</Label>
        <Input
          id="vehicle-return-km"
          type="number"
          inputMode="numeric"
          min={assignment?.start_mileage ?? 0}
          value={endMileage}
          onChange={(e) => setEndMileage(e.target.value)}
          placeholder="Huidige km-stand"
        />
        {assignment?.start_mileage != null && (
          <p className="text-xs text-muted-foreground">Beginstand {assignment.start_mileage.toLocaleString('nl-NL')} km.</p>
        )}
      </div>
      {issue && <p className="text-xs text-destructive">{issue}</p>}
    </ConfirmDialog>
  );
}

export default VehicleReturnDialog;
