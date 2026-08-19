import { useCallback, useMemo, useRef, useState } from 'react';
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
          <AlertDialogCancel onClick={() => setConfirmOpen(false)}>Verder bewerken</AlertDialogCancel>
          <AlertDialogAction onClick={() => { setConfirmOpen(false); onOpenChange(false); }}>
            Sluiten zonder opslaan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ), [confirmOpen, onOpenChange, options?.title, options?.description]);

  return { handleOpenChange, closeWithoutPrompt, dialog };
}
