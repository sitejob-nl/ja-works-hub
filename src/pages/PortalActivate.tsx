import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, AlertTriangle, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

async function inspectPortalInvite(token: string) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${supabaseUrl}/functions/v1/portal-activate`, {
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
  return data as { email: string; full_name?: string };
}

const PortalActivate = () => {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [language, setLanguage] = useState('nl');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activated, setActivated] = useState(false);

  // Validate token and fetch invite data
  const { data: invite, isLoading, error } = useQuery({
    queryKey: ['portal-invite', token],
    queryFn: async () => {
      if (!token) throw new Error('Geen token');
      return inspectPortalInvite(token);
    },
    enabled: !!token,
    retry: false,
  });

  const fullName = invite?.full_name || invite?.email || '';

  const isValid = password.length >= 6 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !token) return;

    setSubmitting(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/portal-activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ token, password, language }),
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

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error / invalid token
  if (error || !invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Link ongeldig of verlopen</h1>
          <p className="text-muted-foreground text-sm">
            Deze activatielink is ongeldig of verlopen. Neem contact op met je werkgever voor een nieuwe uitnodiging.
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (activated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-stat-green mx-auto" />
          <h1 className="text-xl font-semibold">Je account is aangemaakt!</h1>
          <p className="text-muted-foreground text-sm">
            Je kunt nu inloggen op het medewerkerportaal.
          </p>
          <Button asChild className="w-full">
            <Link to="/portaal">Naar portaal</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Activation form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-xl border shadow-sm p-8 max-w-md w-full space-y-6">
        {/* Logo + org name */}
          <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">JA</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold">Portaal activeren</h1>
            <p className="text-sm text-muted-foreground">Medewerkerportaal</p>
          </div>
        </div>

        {/* Welcome */}
        <div className="bg-muted/50 rounded-lg p-4 text-center">
          <p className="text-sm text-muted-foreground">Welkom,</p>
          <p className="font-medium">{fullName}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email (readonly) */}
          <div className="space-y-2">
            <Label htmlFor="email">E-mailadres</Label>
            <Input id="email" type="email" value={invite.email} readOnly className="bg-muted" />
          </div>

          {/* Password */}
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
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password.length > 0 && password.length < 6 && (
              <p className="text-xs text-destructive">Minimaal 6 tekens vereist</p>
            )}
          </div>

          {/* Confirm password */}
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

          {/* Language */}
          <div className="space-y-2">
            <Label htmlFor="lang">Taal</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="lang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nl">Nederlands</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full" disabled={!isValid || submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Account aanmaken...
              </>
            ) : (
              'Account aanmaken'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PortalActivate;
