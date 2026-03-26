import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, X, Check, Search, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import TagInput from '@/components/ui/tag-input';
import { logAudit } from '@/lib/audit';

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const legalFormOptions = ['BV', 'NV', 'VOF', 'Eenmanszaak', 'Stichting', 'Coöperatie', 'Maatschap', 'CV', 'Overig'];

const CompanyInfoTab = ({ company }: { company: any }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(company);
  const [sameAddress, setSameAddress] = useState(false);
  const [kvkPreview, setKvkPreview] = useState<any>(null);
  const qc = useQueryClient();

  const kvkLookup = useMutation({
    mutationFn: async (kvkNumber: string) => {
      const { data, error } = await supabase.functions.invoke('kvk-lookup', {
        body: { kvk_number: kvkNumber },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setKvkPreview(data);
      toast.success('KVK-gegevens opgehaald');
    },
    onError: (e: any) => {
      setKvkPreview(null);
      toast.error(e.message || 'KVK-lookup mislukt');
    },
  });

  const applyKvkData = useMutation({
    mutationFn: async () => {
      if (!kvkPreview) return;
      const payload: any = {};
      if (kvkPreview.name) payload.name = kvkPreview.name;
      if (kvkPreview.sbi_codes?.length) payload.sbi_codes = kvkPreview.sbi_codes;
      if (kvkPreview.visit_address?.street) payload.visit_address_street = kvkPreview.visit_address.street;
      if (kvkPreview.visit_address?.postal) payload.visit_address_postal = kvkPreview.visit_address.postal;
      if (kvkPreview.visit_address?.city) payload.visit_address_city = kvkPreview.visit_address.city;
      if (kvkPreview.visit_address?.country) payload.visit_address_country = kvkPreview.visit_address.country;
      // Sync old address fields too
      if (kvkPreview.visit_address?.street) payload.address_street = kvkPreview.visit_address.street;
      if (kvkPreview.visit_address?.postal) payload.address_postal = kvkPreview.visit_address.postal;
      if (kvkPreview.visit_address?.city) payload.address_city = kvkPreview.visit_address.city;
      if (kvkPreview.visit_address?.country) payload.address_country = kvkPreview.visit_address.country;
      const { error } = await supabase.from('companies').update(payload).eq('id', company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', company.id] });
      logAudit({ action: 'update', tableName: 'companies', recordId: company.id, newValues: { source: 'kvk_enrichment', kvk_number: company.kvk_number } });
      setKvkPreview(null);
      toast.success('KVK-gegevens overgenomen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: form.name, kvk_number: form.kvk_number, btw_number: form.btw_number,
        language: form.language, legal_form: form.legal_form, sbi_codes: form.sbi_codes,
        cao: form.cao,
        visit_address_street: form.visit_address_street, visit_address_postal: form.visit_address_postal,
        visit_address_city: form.visit_address_city, visit_address_country: form.visit_address_country,
        invoice_address_street: form.invoice_address_street, invoice_address_postal: form.invoice_address_postal,
        invoice_address_city: form.invoice_address_city, invoice_address_country: form.invoice_address_country,
        iban: form.iban, bank_account_holder: form.bank_account_holder,
        authorized_signatory: form.authorized_signatory, vat_rate: form.vat_rate ? parseFloat(form.vat_rate) : null,
        invoice_email: form.invoice_email, invoice_cc: form.invoice_cc,
        invoice_company_name: form.invoice_company_name,
        phone: form.phone, email: form.email, website: form.website, notes: form.notes,
        // Keep old address fields synced with visit address
        address_street: form.visit_address_street, address_postal: form.visit_address_postal,
        address_city: form.visit_address_city, address_country: form.visit_address_country,
      };
      const { error } = await supabase.from('companies').update(payload).eq('id', company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', company.id] });
      setEditing(false);
      toast.success('Gegevens bijgewerkt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSameAddress = (checked: boolean) => {
    setSameAddress(checked);
    if (checked) {
      setForm((f: any) => ({
        ...f,
        invoice_address_street: f.visit_address_street,
        invoice_address_postal: f.visit_address_postal,
        invoice_address_city: f.visit_address_city,
        invoice_address_country: f.visit_address_country,
      }));
    }
  };

  const startEdit = () => {
    setForm({ ...company, vat_rate: company.vat_rate?.toString() ?? '21' });
    setSameAddress(false);
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">Bewerken</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Check className="h-4 w-4 mr-1" />Opslaan</Button>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Bedrijfsgegevens</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Bedrijfsnaam *</Label><Input value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><Label>KVK-nummer</Label><Input value={form.kvk_number ?? ''} onChange={e => set('kvk_number', e.target.value)} /></div>
            <div><Label>BTW-nummer</Label><Input value={form.btw_number ?? ''} onChange={e => set('btw_number', e.target.value)} /></div>
            <div><Label>Taal</Label><Input value={form.language ?? ''} onChange={e => set('language', e.target.value)} /></div>
            <div><Label>Rechtsvorm</Label>
              <Select value={form.legal_form ?? ''} onValueChange={v => set('legal_form', v)}>
                <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
                <SelectContent>{legalFormOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>CAO</Label><Input value={form.cao ?? ''} onChange={e => set('cao', e.target.value)} /></div>
          </div>
          <div>
            <Label>SBI-codes</Label>
            <TagInput value={form.sbi_codes ?? []} onChange={v => set('sbi_codes', v)} placeholder="Voeg SBI-code toe..." />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card rounded-lg border p-6 space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Bezoekadres</h4>
            <div className="space-y-3">
              <div><Label>Straat + nr</Label><Input value={form.visit_address_street ?? ''} onChange={e => { set('visit_address_street', e.target.value); if (sameAddress) set('invoice_address_street', e.target.value); }} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Postcode</Label><Input value={form.visit_address_postal ?? ''} onChange={e => { set('visit_address_postal', e.target.value); if (sameAddress) set('invoice_address_postal', e.target.value); }} /></div>
                <div><Label>Stad</Label><Input value={form.visit_address_city ?? ''} onChange={e => { set('visit_address_city', e.target.value); if (sameAddress) set('invoice_address_city', e.target.value); }} /></div>
              </div>
              <div><Label>Land</Label><Input value={form.visit_address_country ?? ''} onChange={e => { set('visit_address_country', e.target.value); if (sameAddress) set('invoice_address_country', e.target.value); }} /></div>
            </div>
          </div>

          <div className="bg-card rounded-lg border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">Factuuradres</h4>
              <div className="flex items-center gap-2">
                <Checkbox checked={sameAddress} onCheckedChange={handleSameAddress} id="same-addr" />
                <label htmlFor="same-addr" className="text-xs text-muted-foreground cursor-pointer">Gelijk aan bezoekadres</label>
              </div>
            </div>
            <div className="space-y-3">
              <div><Label>Straat + nr</Label><Input value={form.invoice_address_street ?? ''} onChange={e => set('invoice_address_street', e.target.value)} disabled={sameAddress} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Postcode</Label><Input value={form.invoice_address_postal ?? ''} onChange={e => set('invoice_address_postal', e.target.value)} disabled={sameAddress} /></div>
                <div><Label>Stad</Label><Input value={form.invoice_address_city ?? ''} onChange={e => set('invoice_address_city', e.target.value)} disabled={sameAddress} /></div>
              </div>
              <div><Label>Land</Label><Input value={form.invoice_address_country ?? ''} onChange={e => set('invoice_address_country', e.target.value)} disabled={sameAddress} /></div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Financieel</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>IBAN</Label><Input value={form.iban ?? ''} onChange={e => set('iban', e.target.value)} /></div>
            <div><Label>Rekeninghouder</Label><Input value={form.bank_account_holder ?? ''} onChange={e => set('bank_account_holder', e.target.value)} /></div>
            <div><Label>Tekenbevoegde</Label><Input value={form.authorized_signatory ?? ''} onChange={e => set('authorized_signatory', e.target.value)} /></div>
            <div><Label>BTW-tarief (%)</Label><Input type="number" step="0.01" value={form.vat_rate ?? '21'} onChange={e => set('vat_rate', e.target.value)} /></div>
            <div><Label>Factuur e-mail</Label><Input type="email" value={form.invoice_email ?? ''} onChange={e => set('invoice_email', e.target.value)} /></div>
            <div><Label>Factuur CC</Label><Input type="email" value={form.invoice_cc ?? ''} onChange={e => set('invoice_cc', e.target.value)} /></div>
            <div><Label>Factuurnaam (afwijkend)</Label><Input value={form.invoice_company_name ?? ''} onChange={e => set('invoice_company_name', e.target.value)} /></div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Contact</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><Label>Telefoon</Label><Input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></div>
            <div><Label>Website</Label><Input value={form.website ?? ''} onChange={e => set('website', e.target.value)} /></div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-2">
          <Label>Notities</Label>
          <Textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={3} />
        </div>
      </div>
    );
  }

  const visitAddr = [company.visit_address_street, company.visit_address_postal, company.visit_address_city, company.visit_address_country].filter(Boolean).join(', ') || null;
  const invoiceAddr = [company.invoice_address_street, company.invoice_address_postal, company.invoice_address_city, company.invoice_address_country].filter(Boolean).join(', ') || null;
  const legacyAddr = [company.address_street, company.address_postal, company.address_city].filter(Boolean).join(', ') || null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <h3 className="font-medium">Bedrijfsgegevens</h3>
        <div className="flex gap-2">
          {company.kvk_number && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => kvkLookup.mutate(company.kvk_number)}
              disabled={kvkLookup.isPending}
            >
              <Building2 className="h-3.5 w-3.5 mr-1" />
              {kvkLookup.isPending ? 'Ophalen...' : 'KVK Verrijken'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {kvkPreview && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-start">
            <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300">KVK-gegevens gevonden</h4>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setKvkPreview(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" onClick={() => applyKvkData.mutate()} disabled={applyKvkData.isPending}>
                <Check className="h-3.5 w-3.5 mr-1" />
                {applyKvkData.isPending ? 'Overnemen...' : 'Overnemen'}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {kvkPreview.name && <div><span className="text-muted-foreground">Naam:</span> {kvkPreview.name}</div>}
            {kvkPreview.kvk_number && <div><span className="text-muted-foreground">KVK:</span> {kvkPreview.kvk_number}</div>}
            {kvkPreview.visit_address?.street && (
              <div><span className="text-muted-foreground">Adres:</span> {kvkPreview.visit_address.street}, {kvkPreview.visit_address.postal} {kvkPreview.visit_address.city}</div>
            )}
            {kvkPreview.sbi_codes?.length > 0 && (
              <div><span className="text-muted-foreground">SBI:</span> {kvkPreview.sbi_codes.join(', ')}</div>
            )}
            {kvkPreview.total_employees != null && (
              <div><span className="text-muted-foreground">Werkzame personen:</span> {kvkPreview.total_employees}</div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Algemeen</h4>
          <Field label="Bedrijfsnaam" value={company.name} />
          <Field label="KVK-nummer" value={company.kvk_number} />
          <Field label="BTW-nummer" value={company.btw_number} />
          <Field label="Rechtsvorm" value={company.legal_form} />
          <Field label="CAO" value={company.cao} />
          <Field label="Taal" value={company.language} />
          {(company.sbi_codes?.length > 0) && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">SBI-codes</p>
              <div className="flex flex-wrap gap-1">
                {company.sbi_codes.map((s: string) => (
                  <span key={s} className="text-xs bg-muted px-2 py-0.5 rounded">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-card rounded-lg border p-6 space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Bezoekadres</h4>
            <Field label="Adres" value={visitAddr || legacyAddr} />
          </div>
          <div className="bg-card rounded-lg border p-6 space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Factuuradres</h4>
            <Field label="Adres" value={invoiceAddr} />
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Financieel</h4>
          <Field label="IBAN" value={company.iban} />
          <Field label="Rekeninghouder" value={company.bank_account_holder} />
          <Field label="Tekenbevoegde" value={company.authorized_signatory} />
          <Field label="BTW-tarief" value={company.vat_rate != null ? `${company.vat_rate}%` : '21%'} />
          <Field label="Factuur e-mail" value={company.invoice_email} />
          <Field label="Factuur CC" value={company.invoice_cc} />
          {company.invoice_company_name && <Field label="Factuurnaam" value={company.invoice_company_name} />}
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Contact</h4>
          <Field label="Telefoon" value={company.phone} />
          <Field label="E-mail" value={company.email} />
          <Field label="Website" value={company.website} />
        </div>
      </div>

      {company.notes && (
        <div className="bg-card rounded-lg border p-6">
          <p className="text-xs text-muted-foreground mb-1">Notities</p>
          <p className="text-sm whitespace-pre-wrap">{company.notes}</p>
        </div>
      )}
    </div>
  );
};

export default CompanyInfoTab;
