import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LanguageToggle } from '@/components/translation/LanguageToggle';
import { useTranslation } from '@/hooks/useTranslation';
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog';

const copy = {
  nl: {
    title: 'Opdrachtgeverportaal',
    subtitle: 'Log in met je account',
    email: 'E-mailadres',
    emailPlaceholder: 'je@bedrijf.nl',
    password: 'Wachtwoord',
    login: 'Inloggen',
    loggingIn: 'Inloggen...',
    loginFailed: 'Inloggen mislukt',
  },
  en: {
    title: 'Client portal',
    subtitle: 'Log in with your account',
    email: 'Email address',
    emailPlaceholder: 'you@company.com',
    password: 'Password',
    login: 'Log in',
    loggingIn: 'Logging in...',
    loginFailed: 'Login failed',
  },
};

const ClientPortalLogin = () => {
  const navigate = useNavigate();
  const { language } = useTranslation();
  // Opdrachtgevers zijn NL/EN; PL en RO vallen hier terug op Engels. Ná het inloggen
  // vertaalt het klantportaal wél runtime naar alle portaaltalen.
  const t = copy[language] ?? copy.en;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

      if (profile?.role === 'opdrachtgever') {
        navigate('/klantportaal', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err: any) {
      toast.error(err.message || t.loginFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <div className="bg-card rounded-xl border shadow-sm p-8 max-w-sm w-full space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">JA</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t.email}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t.password}</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" required autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t.loggingIn}</> : t.login}
          </Button>
        </form>

        <div className="text-center">
          {/* Deze pagina valt voor PL/RO terug op Engels; houd de dialoog daarmee in lijn. */}
          <ForgotPasswordDialog zone="klantportaal" defaultEmail={email} language={language === 'nl' ? 'nl' : 'en'} />
        </div>
      </div>
    </div>
  );
};

export default ClientPortalLogin;
