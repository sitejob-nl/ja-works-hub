import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toFriendlyError } from '@/lib/errorMessages';

interface ErrorStateProps {
  title?: string;
  /** Foutmelding of -object; objecten worden via toFriendlyError naar NL vertaald. */
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Consistente fout-staat voor mislukte queries/laad-acties: vriendelijke melding +
 * optionele "Opnieuw proberen". Gebruik in plaats van een lege/halve pagina bij isError.
 */
export default function ErrorState({ title = 'Er is iets misgegaan', error, message, onRetry, className }: ErrorStateProps) {
  const text = message ?? (error != null ? toFriendlyError(error) : 'Het laden is mislukt.');
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <AlertTriangle className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p className="text-lg font-medium text-muted-foreground">{title}</p>
      {text && <p className="text-sm text-muted-foreground mt-1 max-w-md">{text}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Opnieuw proberen
        </Button>
      )}
    </div>
  );
}
