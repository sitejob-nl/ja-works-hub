import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import CustomFieldsSection from '@/components/shared/CustomFieldsSection';
import { Button } from '@/components/ui/button';
import { Pencil, X, Save, Loader2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import UnsavedChangesGuard from '@/components/shared/UnsavedChangesGuard';
import { resolveAddressCoordinates, type AddressValue } from '@/lib/pdok';
import {
  InlineTextField,
  InlineTagsField,
  InlineSelectField,
  fieldShellClass,
} from '@/components/shared/InlineFields';

const legalFormOptions = ['BV', 'NV', 'VOF', 'Eenmanszaak', 'Stichting', 'Coöperatie', 'Maatschap', 'CV', 'Overig'];
const timesheetFlowOptions = [
  { value: 'medewerker', label: 'Medewerker voert uren in' },
  { value: 'opdrachtgever', label: 'Opdrachtgever geeft uren door' },
  { value: 'kloksysteem', label: 'Kloksysteem opdrachtgever' },
];
const timesheetFlowLabel: Record<string, string> = Object.fromEntries(
  timesheetFlowOptions.map((o) => [o.value, o.label]),
);

const InlineAddressField = ({
  id,
  label,
  address,
  displayValue,
  onSave,
  onDirtyChange,
  onPrefill,
  prefillLabel,
}: {
  id: string;
  label: string;
  address: AddressValue;
  displayValue: string | null;
  onSave: (address: AddressValue) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onPrefill?: () => AddressValue;
  prefillLabel?: string;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AddressValue>(address);
  const [saving, setSaving] = useState(false);

  const open = () => {
    setDraft(address);
    setEditing(true);
    onDirtyChange(id, true);
  };

  const cancel = () => {
    setDraft(address);
    setEditing(false);
    onDirtyChange(id, false);
  };

  const commit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className={fieldShellClass}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {onPrefill && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-7 gap-1.5 px-2 text-xs"
            onClick={() => setDraft(onPrefill())}
          >
            <Copy className="h-3 w-3" />
            {prefillLabel ?? 'Overnemen'}
          </Button>
        )}
        <div className="mt-2">
          <AddressAutocomplete
            value={draft}
            onChange={(next) => setDraft({
              street: next.street,
              postal: next.postal,
              city: next.city,
              country: next.country ?? draft.country ?? '',
              lat: next.lat ?? null,
              lng: next.lng ?? null,
            })}
            gridClassName="grid-cols-2 gap-3"
            streetClassName="col-span-2"
            countryClassName="col-span-2"
            showCountry
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void commit()}>
            <Save className="h-3.5 w-3.5" />
            Opslaan
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" disabled={saving} onClick={cancel}>
            <X className="h-3.5 w-3.5" />
            Annuleren
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={open} className={`group w-full text-left ${fieldShellClass}`}>
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Pencil className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="block min-h-5 text-sm mt-1 whitespace-pre-wrap">{displayValue || '—'}</span>
    </button>
  );
};

const CompanyInfoTab = ({ company }: { company: any }) => {
  const qc = useQueryClient();
  const [dirtyEditors, setDirtyEditors] = useState<Record<string, boolean>>({});
  const hasDirtyEditor = Object.values(dirtyEditors).some(Boolean);
  const setEditorDirty = (id: string, dirty: boolean) => {
    setDirtyEditors((current) => ({ ...current, [id]: dirty }));
  };

  const updateCompany = useMutation({
    mutationFn: async ({ patch }: { patch: Record<string, any>; label: string }) => {
      const { error } = await supabase.from('companies').update(patch as any).eq('id', company.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['company', company.id] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      logAudit({
        action: 'update',
        tableName: 'companies',
        recordId: company.id,
        newValues: variables.patch,
      });
      toast.success(`${variables.label} opgeslagen`);
    },
    onError: (e: any) => toast.error(e.message || 'Opslaan mislukt'),
  });

  const saveField = (label: string, patch: Record<string, any>) =>
    updateCompany.mutateAsync({ label, patch });

  const visitAddress: AddressValue = {
    street: company.visit_address_street ?? company.address_street ?? '',
    postal: company.visit_address_postal ?? company.address_postal ?? '',
    city: company.visit_address_city ?? company.address_city ?? '',
    country: company.visit_address_country ?? company.address_country ?? '',
    lat: company.visit_address_lat ?? company.address_lat ?? null,
    lng: company.visit_address_lng ?? company.address_lng ?? null,
  };
  const invoiceAddress: AddressValue = {
    street: company.invoice_address_street ?? '',
    postal: company.invoice_address_postal ?? '',
    city: company.invoice_address_city ?? '',
    country: company.invoice_address_country ?? '',
    lat: company.invoice_address_lat ?? null,
    lng: company.invoice_address_lng ?? null,
  };

  const formatAddress = (address: AddressValue) =>
    [address.street, address.postal, address.city, address.country].filter(Boolean).join(', ') || null;

  const visitAddr = formatAddress(visitAddress);
  const invoiceAddr = formatAddress(invoiceAddress);

  const saveVisitAddress = async (draft: AddressValue) => {
    const resolved = await resolveAddressCoordinates({
      street: draft.street, postal: draft.postal, city: draft.city, lat: draft.lat, lng: draft.lng,
    });
    await saveField('Bezoekadres', {
      visit_address_street: draft.street || null,
      visit_address_postal: draft.postal || null,
      visit_address_city: draft.city || null,
      visit_address_country: draft.country || null,
      visit_address_lat: resolved.lat,
      visit_address_lng: resolved.lng,
      // Keep legacy address fields synced with the visit address
      address_street: draft.street || null,
      address_postal: draft.postal || null,
      address_city: draft.city || null,
      address_country: draft.country || null,
      address_lat: resolved.lat,
      address_lng: resolved.lng,
    });
  };

  const saveInvoiceAddress = async (draft: AddressValue) => {
    const resolved = await resolveAddressCoordinates({
      street: draft.street, postal: draft.postal, city: draft.city, lat: draft.lat, lng: draft.lng,
    });
    await saveField('Factuuradres', {
      invoice_address_street: draft.street || null,
      invoice_address_postal: draft.postal || null,
      invoice_address_city: draft.city || null,
      invoice_address_country: draft.country || null,
      invoice_address_lat: resolved.lat,
      invoice_address_lng: resolved.lng,
    });
  };

  return (
    <div className="space-y-6">
      <UnsavedChangesGuard when={hasDirtyEditor} />
      <div className="flex justify-between items-start">
        <h3 className="font-medium">Bedrijfsgegevens</h3>
        <div className="flex items-center gap-2">
          {updateCompany.isPending && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Opslaan...
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Algemeen</h4>
          <InlineTextField id="name" label="Bedrijfsnaam" value={company.name} onSave={(value) => saveField('Bedrijfsnaam', { name: value || '' })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="kvk_number" label="KVK-nummer" value={company.kvk_number} inputMode="numeric" onSave={(value) => saveField('KVK-nummer', { kvk_number: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="btw_number" label="BTW-nummer" value={company.btw_number} onSave={(value) => saveField('BTW-nummer', { btw_number: value })} onDirtyChange={setEditorDirty} />
          <InlineSelectField
            label="Rechtsvorm"
            value={company.legal_form}
            options={legalFormOptions.map((o) => ({ value: o, label: o }))}
            onSave={(value) => saveField('Rechtsvorm', { legal_form: value })}
          />
          <InlineTextField id="cao" label="CAO" value={company.cao} onSave={(value) => saveField('CAO', { cao: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="language" label="Taal" value={company.language} onSave={(value) => saveField('Taal', { language: value })} onDirtyChange={setEditorDirty} />
          <InlineTagsField id="sbi_codes" label="SBI-codes" value={company.sbi_codes ?? []} onSave={(value) => saveField('SBI-codes', { sbi_codes: value.length ? value : null })} onDirtyChange={setEditorDirty} />
        </div>

        <div className="space-y-6">
          <div className="bg-card rounded-lg border p-6 space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Bezoekadres</h4>
            <InlineAddressField
              id="visit_address"
              label="Adres"
              address={visitAddress}
              displayValue={visitAddr}
              onSave={saveVisitAddress}
              onDirtyChange={setEditorDirty}
            />
          </div>
          <div className="bg-card rounded-lg border p-6 space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Factuuradres</h4>
            <InlineAddressField
              id="invoice_address"
              label="Adres"
              address={invoiceAddress}
              displayValue={invoiceAddr}
              onSave={saveInvoiceAddress}
              onDirtyChange={setEditorDirty}
              onPrefill={() => visitAddress}
              prefillLabel="Gelijk aan bezoekadres"
            />
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Financieel</h4>
          <InlineTextField id="iban" label="IBAN" value={company.iban} onSave={(value) => saveField('IBAN', { iban: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="bank_account_holder" label="Rekeninghouder" value={company.bank_account_holder} onSave={(value) => saveField('Rekeninghouder', { bank_account_holder: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="authorized_signatory" label="Tekenbevoegde" value={company.authorized_signatory} onSave={(value) => saveField('Tekenbevoegde', { authorized_signatory: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField
            id="vat_rate"
            label="BTW-tarief (%)"
            value={company.vat_rate != null ? String(company.vat_rate) : ''}
            displayValue={company.vat_rate != null ? `${company.vat_rate}%` : '21%'}
            type="number"
            inputMode="decimal"
            onSave={(value) => saveField('BTW-tarief', { vat_rate: value ? parseFloat(value) : null })}
            onDirtyChange={setEditorDirty}
          />
          <InlineTextField id="invoice_email" label="Factuur e-mail" value={company.invoice_email} type="email" inputMode="email" onSave={(value) => saveField('Factuur e-mail', { invoice_email: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="invoice_cc" label="Factuur CC" value={company.invoice_cc} type="email" inputMode="email" onSave={(value) => saveField('Factuur CC', { invoice_cc: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="invoice_company_name" label="Factuurnaam (afwijkend)" value={company.invoice_company_name} onSave={(value) => saveField('Factuurnaam', { invoice_company_name: value })} onDirtyChange={setEditorDirty} />
          <InlineSelectField
            label="Urenstroom"
            value={company.timesheet_entry_flow ?? 'medewerker'}
            displayValue={timesheetFlowLabel[company.timesheet_entry_flow ?? 'medewerker']}
            options={timesheetFlowOptions}
            onSave={(value) => saveField('Urenstroom', { timesheet_entry_flow: value })}
          />
        </div>

        <div className="bg-card rounded-lg border p-6 space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Contact</h4>
          <InlineTextField id="phone" label="Telefoon" value={company.phone} inputMode="tel" onSave={(value) => saveField('Telefoon', { phone: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="email" label="E-mail" value={company.email} type="email" inputMode="email" onSave={(value) => saveField('E-mail', { email: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="website" label="Website" value={company.website} inputMode="url" onSave={(value) => saveField('Website', { website: value })} onDirtyChange={setEditorDirty} />
        </div>
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-2">
        <InlineTextField id="notes" label="Notities" value={company.notes} multiline onSave={(value) => saveField('Notities', { notes: value })} onDirtyChange={setEditorDirty} />
      </div>

      {/* Custom fields */}
      <CustomFieldsSection entityType="company" entityId={company.id} />
    </div>
  );
};

export default CompanyInfoTab;
