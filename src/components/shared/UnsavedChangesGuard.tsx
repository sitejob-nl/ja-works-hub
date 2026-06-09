import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext as NavigationContext } from 'react-router-dom';
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

type UnsavedChangesGuardProps = {
  when: boolean;
  title?: string;
  description?: string;
};

const DEFAULT_TITLE = 'Hé, je hebt het nog niet opgeslagen.';
const DEFAULT_DESCRIPTION = 'Sla je wijzigingen op voordat je deze pagina verlaat, anders raak je ze kwijt.';

const UnsavedChangesGuard = ({
  when,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
}: UnsavedChangesGuardProps) => {
  const { navigator } = useContext(NavigationContext) as any;
  const pendingTransition = useRef<any>(null);
  const unblockRef = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!when) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [when]);

  useEffect(() => {
    if (!when || typeof navigator?.block !== 'function') return undefined;

    const unblock = navigator.block((transition: any) => {
      pendingTransition.current = transition;
      setOpen(true);
    });
    unblockRef.current = unblock;

    return () => {
      unblock();
      if (unblockRef.current === unblock) unblockRef.current = null;
    };
  }, [navigator, when, version]);

  const stay = () => {
    pendingTransition.current = null;
    setOpen(false);
  };

  const leave = () => {
    const transition = pendingTransition.current;
    pendingTransition.current = null;
    setOpen(false);
    unblockRef.current?.();
    unblockRef.current = null;
    transition?.retry?.();
    window.setTimeout(() => setVersion((current) => current + 1), 0);
  };

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) stay(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={stay}>Blijf hier</AlertDialogCancel>
          <AlertDialogAction onClick={leave}>Toch weggaan</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default UnsavedChangesGuard;
