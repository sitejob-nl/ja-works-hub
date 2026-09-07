import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkOutDateProblem, defaultCheckOutDate } from '@/lib/housing-availability';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/tasks';

export type CheckOutAssignment = {
  id: string;
  check_in_date?: string | null;
};

type HousingCheckOutDialogProps = {
  /** De toewijzing die uitgecheckt wordt; `null` houdt de dialoog dicht. */
  assignment: CheckOutAssignment | null;
  residentName: string;
  unitName?: string | null;
  /** Mutatie loopt: bevestigen is geblokkeerd en toont het laadlabel. */
  pending: boolean;
  onConfirm: (checkOutDate: string) => void;
  onClose: () => void;
};

/**
 * Bevestiging voor het uitchecken van een bewoner, met een uitcheckdatum die in
 * het verleden of de toekomst mag liggen maar nooit vóór de incheckdatum. De
 * aanroeper doet de mutatie en sluit de dialoog in `onSuccess`, zodat de laadstaat
 * zichtbaar blijft; annuleren raakt niets aan.
 */
export function HousingCheckOutDialog({
  assignment,
  residentName,
  unitName,
  pending,
  onConfirm,
  onClose,
}: HousingCheckOutDialogProps) {
  const assignmentId = assignment?.id ?? null;
  const checkInDate = assignment?.check_in_date ?? null;
  const [checkOutDate, setCheckOutDate] = useState(() => defaultCheckOutDate(checkInDate, todayISO()));

  // Bij elke volgende toewijzing opnieuw op vandaag zetten. De dialoog blijft
  // gemount (open=false) zodat Radix' sluit-animatie intact blijft.
  useEffect(() => {
    if (assignmentId) setCheckOutDate(defaultCheckOutDate(checkInDate, todayISO()));
  }, [assignmentId, checkInDate]);

  const problem = checkOutDateProblem(checkOutDate, checkInDate);

  return (
    <ConfirmDialog
      open={!!assignment}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Bewoner uitchecken?"
      description={
        <>
          {residentName} wordt uitgecheckt uit kamer {unitName || '—'}. De toewijzing blijft als historie
          bij de kamer en de medewerker staan; de kamer telt vanaf de uitcheckdatum weer als vrij.
        </>
      }
      variant="default"
      confirmLabel="Uitchecken"
      pendingLabel="Uitchecken..."
      pending={pending}
      confirmDisabled={!!problem}
      onConfirm={() => { if (!problem) onConfirm(checkOutDate); }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="housing-check-out-date">Uitcheckdatum</Label>
        <Input
          id="housing-check-out-date"
          type="date"
          value={checkOutDate}
          min={checkInDate ?? undefined}
          onChange={(e) => setCheckOutDate(e.target.value)}
        />
        <p className={problem ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {problem ?? `Ingecheckt op ${formatDate(checkInDate)}. De datum mag in het verleden of de toekomst liggen.`}
        </p>
      </div>
    </ConfirmDialog>
  );
}

export default HousingCheckOutDialog;
