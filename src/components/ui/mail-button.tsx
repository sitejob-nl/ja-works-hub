import { useState, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import EmailCompose from '@/components/email/EmailCompose';

const stop = (enabled: boolean) => (e: { stopPropagation: () => void }) => {
  if (enabled) e.stopPropagation();
};

interface MailButtonProps {
  email?: string | null;
  subject?: string;
  /** Toon als klikbare tekst (de naam/e-mail) i.p.v. een icoonknop. */
  asText?: boolean;
  /** Tekst bij asText; default het e-mailadres. */
  label?: ReactNode;
  className?: string;
  stopPropagation?: boolean;
}

/**
 * Mail-actie die de IN-SYSTEEM compose opent (Outlook-koppeling) met afzender-keuze
 * tussen je persoonlijke mailbox en de bedrijfsmailbox — de keuze zit in EmailCompose.
 *
 * Bewust GEEN `mailto:` wanneer er een mailbox gekoppeld is: mailen loopt via het
 * systeem zodat het bericht gelogd wordt en met de juiste afzender verstuurd wordt.
 * Valt alleen terug op `mailto:` als er nog géén bruikbare mailbox gekoppeld is.
 */
export function MailButton({ email, subject, asText, label, className, stopPropagation = true }: MailButtonProps) {
  const [open, setOpen] = useState(false);
  const { hasUsableAccounts, defaultAccountId, isLoading } = useOutlookAccounts('mail_send');

  if (!email) return asText ? <span className="text-muted-foreground">—</span> : null;

  // Graceful degradation: geen gekoppelde mailbox → klassieke mailto:.
  if (!isLoading && !hasUsableAccounts) {
    const href = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
    if (asText) {
      return (
        <a href={href} onClick={stop(stopPropagation)} className={cn('hover:underline', className)}>
          {label ?? email}
        </a>
      );
    }
    return (
      <Button asChild variant="ghost" size="icon" className={className} title={`Mail ${email}`}>
        <a href={href} onClick={stop(stopPropagation)}>
          <Mail className="h-4 w-4" />
        </a>
      </Button>
    );
  }

  const openCompose = (e: { stopPropagation: () => void }) => {
    stop(stopPropagation)(e);
    setOpen(true);
  };

  return (
    <>
      {asText ? (
        <button
          type="button"
          onClick={openCompose}
          className={cn('hover:underline underline-offset-2', className)}
        >
          {label ?? email}
        </button>
      ) : (
        <Button variant="ghost" size="icon" onClick={openCompose} className={className} title={`Mail ${email}`}>
          <Mail className="h-4 w-4" />
        </Button>
      )}
      {open && (
        <EmailCompose
          open={open}
          onOpenChange={setOpen}
          defaultTo={email}
          defaultSubject={subject}
          selectedAccount={defaultAccountId}
        />
      )}
    </>
  );
}

export default MailButton;
