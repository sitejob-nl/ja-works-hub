import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';
import EntityPicker, { type EntitySelection } from '@/components/shared/EntityPicker';

type ContactRole = Database['public']['Enums']['contact_role'];

const CONTACT_ROLES = [
  { value: 'administratie', label: 'Administratie' },
  { value: 'plaatsing', label: 'Plaatsing' },
  { value: 'hr', label: 'HR' },
  { value: 'overig', label: 'Overig' },
] as const;

interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bestaand contact → bewerk-modus. Verwacht optioneel `companies: { id, name }`. */
  contact?: any;
  /** Vaste opdrachtgever (bv. aangeroepen vanaf een opdrachtgever-detail). */
  lockedCompany?: { id: string; name?: string };
  onSaved?: () => void;
}

const emptyForm = {
  first_name: '',
  last_name: '',
  function_title: '',
  role: 'overig',
  phone: '',
  email: '',
  notes: '',
};

const ContactDialog = ({ open, onOpenChange, contact, lockedCompany, onSaved }: ContactDialogProps) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const isEdit = !!contact;

  const [form, setForm] = useState(emptyForm);
  const [company, setCompany] = useState<EntitySelection | null>(null);

  useEffect(() => {
    if (!open) return;
    if (contact) {
      setForm({
        first_name: contact.first_name ?? '',
        last_name: contact.last_name ?? '',
        function_title: contact.function_title ?? '',
        role: contact.role === 'admin' ? 'administratie' : (contact.role ?? 'overig'),
        phone: contact.phone ?? '',
        email: contact.email ?? '',
        notes: contact.notes ?? '',
      });
      setCompany(
        contact.company_id
          ? { id: contact.company_id, label: contact.companies?.name ?? '' }
          : null,
      );
    } else {
      setForm(emptyForm);
      setCompany(lockedCompany ? { id: lockedCompany.id, label: lockedCompany.name ?? '' } : null);
    }
  }, [open, contact, lockedCompany]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const buildPayload = () => {
    const full_name = [form.first_name, form.last_name].filter(Boolean).join(' ').trim();
    return {
      full_name: full_name || contact?.full_name || '',
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      function_title: form.function_title || null,
      role: (form.role || 'overig') as ContactRole,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (isEdit) {
        const { error } = await supabase
          .from('company_contacts')
          .update({ ...payload, company_id: company!.id })
          .eq('id', contact.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('company_contacts')
          .insert({ ...payload, company_id: company!.id, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      if (company?.id) qc.invalidateQueries({ queryKey: ['contacts', company.id] });
      if (contact?.id) qc.invalidateQueries({ queryKey: ['contact-detail', contact.id] });
      onSaved?.();
      onOpenChange(false);
      toast.success(isEdit ? 'Contact bijgewerkt' : 'Contact toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const hasName = form.first_name.trim() || form.last_name.trim();
  const canSave = !!hasName && !!company?.id && !save.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Contact bewerken' : 'Nieuw contact'}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Opdrachtgever</Label>
            <EntityPicker
              entityType="opdrachtgever"
              value={company}
              onChange={setCompany}
              disabled={!!lockedCompany}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Voornaam</Label><Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></div>
            <div><Label>Achternaam</Label><Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={(v) => set('role', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Functie</Label><Input value={form.function_title} onChange={(e) => set('function_title', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Telefoon</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </div>
          <div><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button onClick={() => save.mutate()} disabled={!canSave}>
              {save.isPending ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ContactDialog;
