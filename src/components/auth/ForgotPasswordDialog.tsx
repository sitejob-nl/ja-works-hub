import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PlatformLanguage } from '@/contexts/translation-context';

const copy = {
  nl: {
    linkLabel: 'Wachtwoord vergeten?',
    title: 'Wachtwoord vergeten',
    description: 'Vul je e-mailadres in, dan sturen we je een link om een nieuw wachtwoord in te stellen.',
    email: 'E-mailadres',
    emailPlaceholder: 'naam@voorbeeld.nl',
    send: 'Verstuur herstel-link',
    sending: 'Versturen...',
    sentBody: 'Als dit e-mailadres bij ons bekend is, is er een herstel-link verstuurd. Check ook je spamfolder.',
    close: 'Sluiten',
    genericError: 'Er ging iets mis. Probeer het later opnieuw.',
  },
  en: {
    linkLabel: 'Forgot password?',
    title: 'Forgot password',
    description: "Enter your email address and we'll send you a link to set a new password.",
    email: 'Email address',
    emailPlaceholder: 'you@example.com',
    send: 'Send reset link',
    sending: 'Sending...',
    sentBody: "If this email address is known to us, a reset link has been sent. Don't forget to check your spam folder.",
    close: 'Close',
    genericError: 'Something went wrong. Please try again later.',
  },
  pl: {
    linkLabel: 'Nie pamiętasz hasła?',
    title: 'Nie pamiętasz hasła',
    description: 'Podaj swój adres e-mail, a wyślemy Ci link do ustawienia nowego hasła.',
    email: 'Adres e-mail',
    emailPlaceholder: 'imie@przyklad.pl',
    send: 'Wyślij link do resetowania',
    sending: 'Wysyłanie...',
    sentBody: 'Jeśli ten adres e-mail jest nam znany, link do resetowania został wysłany. Sprawdź także folder ze spamem.',
    close: 'Zamknij',
    genericError: 'Coś poszło nie tak. Spróbuj ponownie później.',
  },
  ro: {
    linkLabel: 'Ai uitat parola?',
    title: 'Ai uitat parola',
    description: 'Introdu adresa ta de e-mail și îți vom trimite un link pentru a seta o parolă nouă.',
    email: 'Adresă de e-mail',
    emailPlaceholder: 'nume@exemplu.ro',
    send: 'Trimite linkul de resetare',
    sending: 'Se trimite...',
    sentBody: 'Dacă această adresă de e-mail este cunoscută de noi, a fost trimis un link de resetare. Verifică și folderul de spam.',
    close: 'Închide',
    genericError: 'A apărut o eroare. Încearcă din nou mai târziu.',
  },
};

interface ForgotPasswordDialogProps {
  zone: 'app' | 'portaal' | 'klantportaal';
  defaultEmail?: string;
  language?: PlatformLanguage;
}

export const ForgotPasswordDialog = ({ zone, defaultEmail, language = 'nl' }: ForgotPasswordDialogProps) => {
  const t = copy[language] ?? copy.nl;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setEmail(defaultEmail || '');
      setSent(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ action: 'request', email, zone, language }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t.genericError);
      setSent(true);
    } catch (err: any) {
      toast.error(err.message || t.genericError);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        {t.linkLabel}
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>

          {sent ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
                <CheckCircle2 className="h-5 w-5 text-stat-green shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">{t.sentBody}</p>
              </div>
              <Button className="w-full" variant="outline" onClick={() => handleOpenChange(false)}>
                {t.close}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">{t.email}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  required
                  autoFocus
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t.sending}
                  </>
                ) : (
                  t.send
                )}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
