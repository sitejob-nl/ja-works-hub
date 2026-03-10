import { useState, useEffect } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const PortalProfile = () => {
  const { employee, candidate } = usePortal();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [postal, setPostal] = useState('');
  const [city, setCity] = useState('');
  const [lang, setLang] = useState('nl');

  useEffect(() => {
    if (candidate) {
      setPhone(candidate.phone ?? '');
      setEmail(candidate.email ?? '');
      setStreet(candidate.address_street ?? '');
      setPostal(candidate.address_postal ?? '');
      setCity(candidate.address_city ?? '');
    }
    if (employee) {
      setLang(employee.portal_language ?? 'nl');
    }
  }, [candidate, employee]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!candidate?.id || !employee?.id) throw new Error('Geen profiel gevonden');

      const { error: cErr } = await supabase
        .from('candidates')
        .update({
          phone: phone || null,
          email: email || null,
          address_street: street || null,
          address_postal: postal || null,
          address_city: city || null,
        })
        .eq('id', candidate.id);
      if (cErr) throw cErr;

      const { error: eErr } = await supabase
        .from('employees')
        .update({ portal_language: lang })
        .eq('id', employee.id);
      if (eErr) throw eErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-employee'] });
      toast.success('Profiel opgeslagen');
    },
    onError: (err: any) => toast.error(err.message || 'Opslaan mislukt'),
  });

  if (!candidate || !employee) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mijn profiel</h1>

      {/* Readonly section */}
      <div className="bg-card rounded-xl border p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Persoonlijke gegevens</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Voornaam</Label>
            <p className="text-sm font-medium">{candidate.first_name}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Achternaam</Label>
            <p className="text-sm font-medium">{candidate.last_name}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Geboortedatum</Label>
            <p className="text-sm font-medium">
              {candidate.date_of_birth ? format(new Date(candidate.date_of_birth), 'dd-MM-yyyy') : '—'}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">BSN</Label>
            <p className="text-sm font-medium">{candidate.bsn ? '••••' + candidate.bsn.slice(-3) : '—'}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Personeelsnummer</Label>
            <p className="text-sm font-medium">{employee.employee_number ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Editable section */}
      <div className="bg-card rounded-xl border p-4 space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contactgegevens</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Telefoon</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Straat + huisnummer</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Postcode</Label>
              <Input value={postal} onChange={(e) => setPostal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Stad</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Taal portaal</Label>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nl">Nederlands</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full gap-2"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? 'Opslaan...' : 'Opslaan'}
        </Button>
      </div>
    </div>
  );
};

export default PortalProfile;
