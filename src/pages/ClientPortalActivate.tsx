import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, AlertTriangle, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { LanguageToggle } from '@/components/translation/LanguageToggle';

async function inspectClientPortalInvite(token: string) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${supabaseUrl}/functions/v1/client-portal-activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ action: 'inspect', token }),
  });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || 'Niet gevonden');
  return data as { email: string; full_name?: string; company_id?: string };
}

const ClientPortalActivate = () => {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activated, setActivated] = useState(false);

  const { data: invite, isLoading, error } = useQuery({
    queryKey: ['client-portal-invite', token],
    queryFn: async () => {
      if (!token) throw new Error('Geen token');
      return inspectClientPortalInvite(token);
    },
    enabled: !!token,
    retry: false,
  });

  const isValid = password.length >= 6 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !token) return;

    setSubmitting(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/client-portal-activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || 'Activatie mislukt');

      setActivated(true);
      toast.success('Account aangemaakt!');
    } catch (err: any) {
      toast.error(err.message || 'Er ging iets mis bij het activeren');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Link ongeldig of verlopen</h1>
          <p className="text-muted-foreground text-sm">
            Deze activatielink is ongeldig of verlopen. Neem contact op met het uitzendbureau voor een nieuwe uitnodiging.
          </p>
        </div>
      </div>
    );
  }

  if (activated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-stat-green mx-auto" />
          <h1 className="text-xl font-semibold">Je account is aangemaakt!</h1>
          <p className="text-muted-foreground text-sm">Je kunt nu inloggen op het opdrachtgeverportaal.</p>
          <Button asChild className="w-full">
            <Link to="/klantportaal/login">Naar inloggen</Link>
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
            <h1 className="text-xl font-semibold">Portaal activeren</h1>
            <p className="text-sm text-muted-foreground">Opdrachtgeverportaal</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mailadres</Label>
            <Input id="email" type="email" value={invite.email} readOnly className="bg-muted" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Wachtwoord</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimaal 6 tekens"
                minLength={6}
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password.length > 0 && password.length < 6 && (
              <p className="text-xs text-destructive">Minimaal 6 tekens vereist</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Wachtwoord bevestigen</Label>
            <Input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Herhaal wachtwoord"
              required
            />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p className="text-xs text-destructive">Wachtwoorden komen niet overeen</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={!isValid || submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Account aanmaken...</> : 'Account aanmaken'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ClientPortalActivate;
