import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LanguageToggle } from '@/components/translation/LanguageToggle';
import { useTranslation } from '@/hooks/useTranslation';
import { isPasswordValid } from '@/lib/password-policy';
import { PasswordChecklist } from '@/components/auth/PasswordChecklist';

const copy = {
  nl: {
    title: 'Nieuw wachtwoord instellen',
    subtitle: 'Kies een nieuw wachtwoord voor je account',
    verifying: 'Link controleren...',
    invalidTitle: 'Link ongeldig of verlopen',
    invalidBody: 'Deze herstel-link is ongeldig of verlopen. Vraag via het inlogscherm een nieuwe link aan.',
    toLogin: 'Naar inloggen',
    password: 'Nieuw wachtwoord',
    passwordPlaceholder: 'Minimaal 8 tekens',
    pwLength: 'Minimaal 8 tekens',
    pwLower: 'Een kleine letter',
    pwUpper: 'Een hoofdletter',
    pwDigit: 'Een cijfer',
    pwSymbol: 'Een symbool (bijv. !?@#)',
    confirmPassword: 'Wachtwoord bevestigen',
    confirmPlaceholder: 'Herhaal wachtwoord',
    passwordsMismatch: 'Wachtwoorden komen niet overeen',
    saving: 'Opslaan...',
    save: 'Wachtwoord opslaan',
    successTitle: 'Wachtwoord gewijzigd',
    successBody: 'Je wachtwoord is gewijzigd. Log opnieuw in met je nieuwe wachtwoord.',
    genericError: 'Er ging iets mis. Probeer het opnieuw.',
  },
  en: {
    title: 'Set a new password',
    subtitle: 'Choose a new password for your account',
    verifying: 'Checking link...',
    invalidTitle: 'Link invalid or expired',
    invalidBody: 'This reset link is invalid or expired. Request a new link from the login screen.',
    toLogin: 'Go to login',
    password: 'New password',
    passwordPlaceholder: 'At least 8 characters',
    pwLength: 'At least 8 characters',
    pwLower: 'A lowercase letter',
    pwUpper: 'An uppercase letter',
    pwDigit: 'A digit',
    pwSymbol: 'A symbol (e.g. !?@#)',
    confirmPassword: 'Confirm password',
    confirmPlaceholder: 'Repeat password',
    passwordsMismatch: 'Passwords do not match',
    saving: 'Saving...',
    save: 'Save password',
    successTitle: 'Password changed',
    successBody: 'Your password has been changed. Log in again with your new password.',
    genericError: 'Something went wrong. Please try again.',
  },
};

// next-param whitelist — voorkomt dat de link naar een willekeurig pad stuurt.
const ALLOWED_NEXT = ['/login', '/portaal/login', '/klantportaal/login'];

type PageState = 'verifying' | 'ready' | 'invalid' | 'done';

const PasswordReset = () => {
  const [searchParams] = useSearchParams();
  const { language } = useTranslation();
  const t = copy[language];
  const tokenHash = searchParams.get('token_hash') || '';
  const nextParam = searchParams.get('next') || '';
  const next = ALLOWED_NEXT.includes(nextParam) ? nextParam : '/login';

  const [state, setState] = useState<PageState>('verifying');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
        if (cancelled) return;
        if (!error) {
          setState('ready');
          return;
        }
      }
      // Fallback: sessie kan al bestaan (bv. GoTrue-redirect-flow met hash-tokens,
      // of een herlaad van de pagina nadat de token al verzilverd is).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setState(data.session ? 'ready' : 'invalid');
    };
    verify();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValid = isPasswordValid(password) && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error(t.invalidBody);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'update', password, language }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result?.error) throw new Error(result?.error || t.genericError);

      // Alle sessies (ook op andere apparaten) uitloggen na een reset.
      await supabase.auth.signOut();
      setState('done');
    } catch (err: any) {
      toast.error(err.message || t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'verifying') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t.verifying}</p>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">{t.invalidTitle}</h1>
          <p className="text-muted-foreground text-sm">{t.invalidBody}</p>
          <Button asChild className="w-full">
            <Link to={next}>{t.toLogin}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-stat-green mx-auto" />
          <h1 className="text-xl font-semibold">{t.successTitle}</h1>
          <p className="text-muted-foreground text-sm">{t.successBody}</p>
          <Button asChild className="w-full">
            <Link to={next}>{t.toLogin}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">JA</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{t.password}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.passwordPlaceholder}
                minLength={8}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password.length > 0 && (
              <PasswordChecklist
                password={password}
                labels={{ length: t.pwLength, lower: t.pwLower, upper: t.pwUpper, digit: t.pwDigit, symbol: t.pwSymbol }}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">{t.confirmPassword}</Label>
            <Input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t.confirmPlaceholder}
              required
              autoComplete="new-password"
            />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p className="text-xs text-destructive">{t.passwordsMismatch}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={!isValid || submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t.saving}
              </>
            ) : (
              t.save
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PasswordReset;
