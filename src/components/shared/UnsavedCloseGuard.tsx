import { useCallback, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
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
import { Sheet } from '@/components/ui/sheet';
import { Dialog } from '@/components/ui/dialog';

/**
 * Tegenhanger van UnsavedChangesGuard voor panelen en dialogen.
 *
 * UnsavedChangesGuard hangt aan de router en vangt alleen paginawissels. Het geval
 * uit punt 21 is een ander: je bent aan het bewerken in het zijpaneel en klikt het
 * weg — dat is geen navigatie, dus daar greep niets in. Deze hook zit tussen het
 * sluiten en de onOpenChange van het paneel.
 *
 * Gebruik:
 *   const guard = useUnsavedCloseGuard(isDirty, onOpenChange);
 *   <Sheet open={open} onOpenChange={guard.handleOpenChange}> ...
 *   {guard.dialog}
 */
export function useUnsavedCloseGuard(
  isDirty: boolean,
  onOpenChange: (open: boolean) => void,
  options?: { title?: string; description?: string },
) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next && dirtyRef.current) {
      setConfirmOpen(true);
      return;
    }
    onOpenChange(next);
  }, [onOpenChange]);

  /** Sluiten zonder te vragen — voor het pad ná een geslaagde opslag. */
  const closeWithoutPrompt = useCallback(() => {
    setConfirmOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Bewust een element en geen component: een component uit een hook krijgt bij elke
  // statuswijziging een nieuwe identiteit, waardoor React hem opnieuw aankoppelt en
  // de open/dicht-animatie van de dialoog hapert.
  const dialog = useMemo(() => (
    <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setConfirmOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title ?? 'Je bent nog aan het bewerken.'}</AlertDialogTitle>
          <AlertDialogDescription>
            {options?.description ?? 'Sluit je dit paneel, dan raak je de wijzigingen kwijt die je nog niet hebt opgeslagen.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Rollen bewust ongewijzigd: Radix zet de focus op Cancel en laat Escape daarop
              uitkomen, dus "Verder bewerken" moet de Cancel blijven — anders gooit één keer
              Enter of Escape je werk weg. Alleen het accent verschuift: weggooien krijgt de
              rode omlijning in plaats van de uitnodigende primaire knop. */}
          <AlertDialogCancel onClick={() => setConfirmOpen(false)}>Verder bewerken</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { setConfirmOpen(false); onOpenChange(false); }}
            className="bg-transparent border border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Sluiten zonder opslaan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ), [confirmOpen, onOpenChange, options?.title, options?.description]);

  return { handleOpenChange, closeWithoutPrompt, dialog };
}


/**
 * `useState` voor een formulier, met een dirty-vlag erbij.
 *
 * De vlag leunt op een patroon dat overal in deze codebase geldt: een formulier
 * *vullen* gebeurt met een kant-en-klaar object (`setForm(emptyForm)`,
 * `setForm({ ...uit de database })`), terwijl een gebruiker die iets *wijzigt* altijd
 * via de functievorm gaat (`setForm(f => ({ ...f, naam: waarde }))`). Het eerste zet de
 * vlag dus terug op schoon, het tweede zet hem aan.
 *
 * Daarmee hoeft een scherm geen aparte kopie van de begintoestand bij te houden en
 * blijft de rest van de component ongewijzigd: alleen de regel met `useState` verandert.
 */
export function useDirtyForm<T>(initial: T): [T, Dispatch<SetStateAction<T>>, boolean, () => void] {
  const [form, setFormState] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);

  const setForm = useCallback<Dispatch<SetStateAction<T>>>((value) => {
    setDirty(typeof value === 'function');
    setFormState(value);
  }, []);

  const markClean = useCallback(() => setDirty(false), []);

  return [form, setForm, dirty, markClean];
}

/**
 * Een `Sheet` die niet zomaar dichtgaat terwijl je nog aan het typen bent.
 *
 * Vangt de wegen waarlangs een paneel per ongeluk sluit — naast het paneel klikken,
 * Escape, het kruisje. Opslaan en Annuleren roepen `onOpenChange` rechtstreeks aan en
 * lopen hier dus bewust langs: dat zijn bedoelde acties, die horen niet te vragen.
 */
export function GuardedSheet({
  open,
  onOpenChange,
  dirty,
  children,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirty: boolean;
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  const guard = useUnsavedCloseGuard(dirty, onOpenChange, { title, description });
  return (
    <>
      <Sheet open={open} onOpenChange={guard.handleOpenChange}>{children}</Sheet>
      {guard.dialog}
    </>
  );
}

/** Zelfde bescherming als {@link GuardedSheet}, voor schermen die een dialoog gebruiken. */
export function GuardedDialog({
  open,
  onOpenChange,
  dirty,
  children,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirty: boolean;
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  const guard = useUnsavedCloseGuard(dirty, onOpenChange, { title, description });
  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>{children}</Dialog>
      {guard.dialog}
    </>
  );
}
