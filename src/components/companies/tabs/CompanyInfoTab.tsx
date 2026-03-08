import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, X, Check } from 'lucide-react';
import { toast } from 'sonner';

const Field = ({ label, value }: { label: string; value: string | null }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const CompanyInfoTab = ({ company }: { company: any }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(company);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('companies').update({
        name: form.name, kvk_number: form.kvk_number, btw_number: form.btw_number,
        address_street: form.address_street, address_postal: form.address_postal, address_city: form.address_city,
        phone: form.phone, email: form.email, website: form.website, notes: form.notes,
      }).eq('id', company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', company.id] });
      setEditing(false);
      toast.success('Gegevens bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  if (editing) {
    return (
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">Bewerken</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setForm(company); setEditing(false); }}><X className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Check className="h-4 w-4 mr-1" />Opslaan</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Bedrijfsnaam" />
          <Input value={form.kvk_number ?? ''} onChange={(e) => set('kvk_number', e.target.value)} placeholder="KVK" />
          <Input value={form.btw_number ?? ''} onChange={(e) => set('btw_number', e.target.value)} placeholder="BTW" />
          <Input value={form.address_street ?? ''} onChange={(e) => set('address_street', e.target.value)} placeholder="Straat" />
          <Input value={form.address_postal ?? ''} onChange={(e) => set('address_postal', e.target.value)} placeholder="Postcode" />
          <Input value={form.address_city ?? ''} onChange={(e) => set('address_city', e.target.value)} placeholder="Stad" />
          <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="Telefoon" />
          <Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="E-mail" />
          <Input value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="Website" />
        </div>
        <Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Notities" rows={3} />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-medium">Bedrijfsgegevens</h3>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Bedrijfsnaam" value={company.name} />
          <Field label="KVK-nummer" value={company.kvk_number} />
          <Field label="BTW-nummer" value={company.btw_number} />
          <Field label="Adres" value={[company.address_street, company.address_postal, company.address_city].filter(Boolean).join(', ') || null} />
        </div>
        <div className="space-y-4">
          <Field label="Telefoon" value={company.phone} />
          <Field label="E-mail" value={company.email} />
          <Field label="Website" value={company.website} />
        </div>
      </div>
      {company.notes && (
        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-muted-foreground mb-1">Notities</p>
          <p className="text-sm whitespace-pre-wrap">{company.notes}</p>
        </div>
      )}
    </div>
  );
};

export default CompanyInfoTab;
