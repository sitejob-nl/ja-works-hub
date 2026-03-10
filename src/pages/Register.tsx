import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const Register = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    companyName: '',
    fullName: '',
    email: '',
    password: '',
    phone: '',
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName || !form.fullName || !form.email || !form.password) {
      toast.error('Vul alle verplichte velden in');
      return;
    }
    if (form.password.length < 6) {
      toast.error('Wachtwoord moet minimaal 6 tekens bevatten');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/register-organization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.companyName,
          full_name: form.fullName,
          email: form.email,
          password: form.password,
          phone: form.phone || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registratie mislukt');

      // Auto-login
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      if (loginError) {
        toast.success('Account aangemaakt! Je kunt nu inloggen.');
        navigate('/login');
      } else {
        toast.success('Welkom bij SiteJob!');
        navigate('/');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">SJ</span>
            </div>
            <span className="text-xl font-semibold text-heading">SiteJob</span>
          </div>
          <p className="text-sm text-muted-foreground">Registreer je uitzendbureau</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="companyName">Bedrijfsnaam *</Label>
            <Input id="companyName" value={form.companyName} onChange={e => set('companyName', e.target.value)} placeholder="Mijn Uitzendbureau B.V." required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName">Jouw naam *</Label>
            <Input id="fullName" value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="Jan de Vries" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regEmail">E-mailadres *</Label>
            <Input id="regEmail" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jan@bedrijf.nl" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regPhone">Telefoonnummer</Label>
            <Input id="regPhone" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+31 6 12345678" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="regPassword">Wachtwoord *</Label>
            <Input id="regPassword" type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Minimaal 6 tekens" required autoComplete="new-password" />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registreren...</> : 'Gratis starten'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Al een account?{' '}
          <a href="/login" className="text-primary hover:underline font-medium">Inloggen</a>
        </p>
      </div>
    </div>
  );
};

export default Register;
