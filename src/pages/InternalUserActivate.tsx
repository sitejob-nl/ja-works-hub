import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PasswordChecklist } from '@/components/auth/PasswordChecklist';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isPasswordValid } from '@/lib/password-policy';
import { ROLE_LABELS, type UserRole } from '@/lib/permissions';

type InviteInspect = {
  email: string;
  full_name: string;
  role: UserRole;
  organization_name: string;
  expires_at: string;
};

async function callActivationFunction<T>(body: Record<string, unknown>): Promise<T> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${supabaseUrl}/functions/v1/internal-user-activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || 'Activatie mislukt');
  return data as T;
}

const InternalUserActivate = () => {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activated, setActivated] = useState(false);

  const inviteQuery = useQuery({
    queryKey: ['internal-user-activate', token],
    queryFn: async () => {
      if (!token) throw new Error('Geen token gevonden');
      return callActivationFunction<InviteInspect>({ action: 'inspect', token });
    },
    enabled: !!token,
    retry: false,
  });

  const valid = isPasswordValid(password) && password === confirmPassword;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !valid) return;
    setSubmitting(true);
    try {
      await callActivationFunction({ token, password });
      setActivated(true);
      toast.success('Account aangemaakt');
    } catch (error: any) {
      toast.error(error?.message || 'Activatie mislukt');
    } finally {
      setSubmitting(false);
    }
  };

  if (inviteQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (inviteQuery.error || !inviteQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
            <CardTitle>Link ongeldig of verlopen</CardTitle>
            <CardDescription>Vraag je organisatie-admin om een nieuwe uitnodiging.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (activated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CheckCircle2 className="mx-auto h-12 w-12 text-stat-green" />
            <CardTitle>Je account is aangemaakt</CardTitle>
            <CardDescription>Je kunt nu inloggen in JA Werkt.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/login">Naar login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const invite = inviteQuery.data;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Account activeren</CardTitle>
          <CardDescription>{invite.organization_name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border bg-muted/40 p-3 text-center">
            <div className="font-medium">{invite.full_name}</div>
            <div className="text-sm text-muted-foreground">{invite.email}</div>
            <div className="mt-2 text-xs text-muted-foreground">Rol: {ROLE_LABELS[invite.role]}</div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Wachtwoord</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimaal 8 tekens"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {password.length > 0 && (
                <PasswordChecklist
                  password={password}
                  labels={{
                    length: 'Minimaal 8 tekens',
                    lower: 'Een kleine letter',
                    upper: 'Een hoofdletter',
                    digit: 'Een cijfer',
                    symbol: 'Een symbool',
                  }}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Wachtwoord bevestigen</Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Herhaal wachtwoord"
                autoComplete="new-password"
                required
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-xs text-destructive">Wachtwoorden komen niet overeen</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={!valid || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Account aanmaken...
                </>
              ) : (
                'Account aanmaken'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default InternalUserActivate;
