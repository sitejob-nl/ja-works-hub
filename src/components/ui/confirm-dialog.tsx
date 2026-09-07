import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  /** Radix' open-change: sluiten gebeurt via Annuleren, Escape en een klik buiten de dialoog. */
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Wat er precies gebeurt — bij een onomkeerbare actie ook wát er verdwijnt. */
  description?: ReactNode;
  /**
   * Extra velden tussen de uitleg en de knoppen (bv. een uitcheckdatum of
   * eindkilometerstand). Valideer ze in de aanroeper en zet `confirmDisabled`
   * zolang de invoer niet klopt.
   */
  children?: ReactNode;
  /**
   * `destructive` (default) kleurt de bevestigknop rood — voor verwijderen en
   * andere onomkeerbare acties. `default` voor een neutrale bevestiging, zoals
   * het omzetten van een status.
   */
  variant?: 'destructive' | 'default';
  confirmLabel?: string;
  cancelLabel?: string;
  /** Label zolang `pending` waar is; valt terug op `confirmLabel`. */
  pendingLabel?: string;
  /** Mutatie loopt: bevestigen is geblokkeerd en toont `pendingLabel`. */
  pending?: boolean;
  /** Bevestigen blokkeren omdat er eerst iets anders moet gebeuren. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  /**
   * Default `false`: de dialoog blijft na bevestigen staan, zodat de aanroeper
   * hem tijdens de mutatie open kan houden en pas in `onSuccess`/`onError`
   * sluit. Zet op `true` voor een bevestiging zonder eigen laadstaat.
   */
  closeOnConfirm?: boolean;
  className?: string;
}

/**
 * Gedeelde bevestigingsdialoog voor onomkeerbare (of anderszins zware) acties:
 * titel, uitleg van wat er gebeurt, annuleren en een bevestigknop in de juiste
 * stijl. Vervangt de per-scherm hand-gerolde AlertDialogs, zodat verwijderen
 * overal hetzelfde aanvoelt.
 *
 * Toegankelijkheid komt van Radix' AlertDialog: focus verspringt naar de
 * dialoog en blijft erin, Escape annuleert, en titel + omschrijving worden als
 * label/beschrijving aan de dialoog gekoppeld.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  variant = 'destructive',
  confirmLabel = 'Bevestigen',
  cancelLabel = 'Annuleren',
  pendingLabel,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  closeOnConfirm = false,
  className,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={className}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children ? <div className="space-y-3">{children}</div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Radix sluit de dialoog bij een klik op Action. Standaard houden we
              // hem open zodat de aanroeper de laadstaat kan tonen en zelf sluit.
              if (!closeOnConfirm) e.preventDefault();
              onConfirm();
            }}
            disabled={pending || confirmDisabled}
            className={cn(
              variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDialog;
