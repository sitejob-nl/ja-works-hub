import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Loader2, AlertTriangle, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const Onboarding = () => {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitted' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    bsn: '', iban: '', date_of_birth: '', nationality: '', phone: '', email: '',
    address_street: '', address_postal: '', address_city: '', address_country: 'NL',
  });
  const [reglementAccepted, setReglementAccepted] = useState(false);

  useEffect(() => {
    // Validate token exists
    if (!token) { setStatus('error'); setErrorMsg('Geen token opgegeven'); return; }
    setStatus('ready');
  }, [token]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.bsn || !form.iban || !form.date_of_birth) {
      toast.error('Vul alle verplichte velden in (BSN, IBAN, geboortedatum)');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          personal_data: form,
          documents_accepted: reglementAccepted,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fout bij indienen');

      setStatus('submitted');
      toast.success('Gegevens succesvol ingediend!');
    } catch (err: any) {
      toast.error(err.message);
      if (err.message.includes('verlopen') || err.message.includes('gebruikt') || err.message.includes('Ongeldig')) {
        setStatus('error');
        setErrorMsg(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12">
            <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-lg font-semibold mb-2">Link ongeldig</h2>
            <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Bedankt!</h2>
            <p className="text-sm text-muted-foreground text-center">Je gegevens zijn succesvol ingediend. Je kunt dit venster sluiten.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <FileCheck className="h-10 w-10 text-primary mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">Vul je persoonlijke gegevens in om je onboarding af te ronden</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Persoonlijke gegevens</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>BSN *</Label><Input value={form.bsn} onChange={e => set('bsn', e.target.value)} placeholder="123456789" /></div>
            <div><Label>IBAN *</Label><Input value={form.iban} onChange={e => set('iban', e.target.value)} placeholder="NL00BANK0123456789" /></div>
            <div><Label>Geboortedatum *</Label><Input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></div>
            <div><Label>Nationaliteit</Label><Input value={form.nationality} onChange={e => set('nationality', e.target.value)} placeholder="Nederlands" /></div>
            <div><Label>Telefoonnummer</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+31 6 12345678" /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Adresgegevens</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Straat + huisnummer</Label><Input value={form.address_street} onChange={e => set('address_street', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Postcode</Label><Input value={form.address_postal} onChange={e => set('address_postal', e.target.value)} /></div>
              <div><Label>Stad</Label><Input value={form.address_city} onChange={e => set('address_city', e.target.value)} /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Reglement</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-start gap-3">
              <Checkbox
                id="reglement"
                checked={reglementAccepted}
                onCheckedChange={(v) => setReglementAccepted(v === true)}
              />
              <label htmlFor="reglement" className="text-sm leading-5">
                Ik heb het bedrijfsreglement gelezen en ga hiermee akkoord.
              </label>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full" size="lg">
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Indienen...</> : 'Gegevens indienen'}
        </Button>
      </div>
    </div>
  );
};

export default Onboarding;
