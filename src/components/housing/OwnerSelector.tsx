import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

const NEW_OWNER = '__new__';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type OwnerForm = { name: string; contact_person: string; email: string; phone: string; notes: string };
type OwnerErrors = { name?: string; email?: string; phone?: string };

const validateOwner = (f: OwnerForm): OwnerErrors => {
  const errors: OwnerErrors = {};
  if (!f.name.trim()) errors.name = 'Naam is verplicht';
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) errors.email = 'Ongeldig e-mailadres';
  if (f.phone.trim()) {
    const digits = f.phone.replace(/[\s\-+()]/g, '');
    if (digits.length < 8 || !/^\d+$/.test(digits)) {
      errors.phone = 'Vul een geldig telefoonnummer in (min. 8 cijfers)';
    }
  }
  return errors;
};

interface Props {
  value: string | null;
  onChange: (ownerId: string | null) => void;
  showManageLink?: boolean;
}

const OwnerSelector = ({ value, onChange, showManageLink }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<OwnerForm>({ name: '', contact_person: '', email: '', phone: '', notes: '' });
  const [touched, setTouched] = useState<{ [k: string]: boolean }>({});
  const errors = validateOwner(form);
  const hasErrors = Object.keys(errors).length > 0;

  const { data: owners = [] } = useQuery({
    queryKey: ['property-owners', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_owners')
        .select('id, name, contact_person, email, phone')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const createOwner = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('property_owners')
        .insert({
          organization_id: orgId,
          name: form.name.trim(),
          contact_person: form.contact_person.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          notes: form.notes.trim() || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['property-owners'] });
      onChange(newId);
      setCreating(false);
      setForm({ name: '', contact_person: '', email: '', phone: '', notes: '' });
      setTouched({});
      toast.success('Eigenaar aangemaakt');
    },
    onError: (e: any) => toast.error(e.message ?? 'Aanmaken mislukt'),
  });

  const handleSelect = (v: string) => {
    if (v === NEW_OWNER) {
      setCreating(true);
      return;
    }
    onChange(v || null);
  };

  return (
    <>
      <div className="space-y-1">
        <Select value={value ?? undefined} onValueChange={handleSelect}>
          <SelectTrigger>
            <SelectValue placeholder={owners.length ? 'Kies eigenaar' : 'Geen eigenaren — maak aan'} />
          </SelectTrigger>
          <SelectContent>
            {owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
                {o.contact_person && <span className="text-muted-foreground"> — {o.contact_person}</span>}
              </SelectItem>
            ))}
            <SelectItem value={NEW_OWNER}>
              <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Nieuwe eigenaar</span>
            </SelectItem>
          </SelectContent>
        </Select>
        {showManageLink && (
          <a href="/instellingen?tab=eigenaren" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <Settings2 className="h-3 w-3" /> Eigenaren beheren
          </a>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nieuwe eigenaar</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-4">
            <div>
              <Label>Naam *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              />
              {touched.name && errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>
            <div><Label>Contactpersoon</Label><Input value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Telefoon</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                />
                {touched.phone && errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                />
                {touched.email && errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
              </div>
            </div>
            <div><Label>Notities</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Annuleren</Button>
            <Button onClick={() => createOwner.mutate()} disabled={hasErrors || createOwner.isPending}>
              {createOwner.isPending ? 'Opslaan...' : 'Aanmaken'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default OwnerSelector;
