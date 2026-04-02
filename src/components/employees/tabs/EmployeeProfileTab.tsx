import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { Send } from 'lucide-react';
import PortalActivateSheet from '@/components/employees/PortalActivateSheet';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import SensitiveField from '@/components/ui/sensitive-field';

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const contractLabels: Record<string, string> = {
  bepaalde_tijd: 'Bepaalde tijd',
  onbepaalde_tijd: 'Onbepaalde tijd',
  oproep: 'Oproep',
  payroll: 'Payroll',
};

const statusLabel: Record<string, string> = {
  onboarding: 'Onboarding', actief: 'Actief', ziek: 'Ziek', uit_dienst: 'Uit dienst',
};

const EmployeeProfileTab = ({ candidateId, candidate, employment }: { candidateId: string; candidate: any; employment?: any }) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const c = candidate;
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidateId);
  const address = [c?.address_street, c?.address_postal, c?.address_city].filter(Boolean).join(', ') || null;
  const portalEnabled = candidate?.portal_enabled === true;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Persoonsgegevens */}
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <Field label="Voornaam" value={c?.first_name} />
        <Field label="Achternaam" value={c?.last_name} />
        <Field label="Geboortedatum" value={formatDate(c?.date_of_birth)} />
        <Field label="Nationaliteit" value={c?.nationality} />
        <SensitiveField label="BSN" value={sensitive?.decrypted_bsn} loading={sensitiveLoading} />
        <SensitiveField label="IBAN" value={sensitive?.decrypted_iban} loading={sensitiveLoading} />
      </div>

      {/* Contactgegevens */}
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Contactgegevens</h3>
        <Field label="E-mail" value={c?.email} />
        <Field label="Telefoon" value={c?.phone} />
        <Field label="Adres" value={address} />
      </div>

      {/* Dienstverband */}
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Dienstverband</h3>
        <Field label="Medewerkernummer" value={candidate?.employee_number} />
        <Field label="Startdatum" value={formatDate(employment?.start_date)} />
        <Field label="Einddatum" value={formatDate(employment?.end_date)} />
        <Field label="Contracttype" value={contractLabels[employment?.contract_type] ?? employment?.contract_type} />
        <Field label="Contracturen" value={employment?.contract_hours != null ? `${employment.contract_hours} uur/week` : null} />
        <Field label="Status" value={statusLabel[candidate?.employee_status] ?? candidate?.employee_status} />
      </div>

      {/* Vaardigheden */}
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Vaardigheden & certificaten</h3>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Vaardigheden</p>
          <div className="flex flex-wrap gap-1">
            {(c?.skills ?? []).length > 0
              ? c.skills.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Talen</p>
          <div className="flex flex-wrap gap-1">
            {(c?.languages ?? []).length > 0
              ? c.languages.map((l: string) => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Rijbewijs</p>
          <p className="text-sm mt-0.5">
            {c?.has_drivers_license ? 'Ja' : 'Nee'}
            {c?.has_drivers_license && c?.drivers_license_expiry && ` — verloopt ${formatDate(c.drivers_license_expiry)}`}
          </p>
        </div>
      </div>

      {/* Medewerkerportaal */}
      <div className="bg-card rounded-lg border p-6 space-y-4 md:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Medewerkerportaal</h3>
          <Badge variant="secondary" className={portalEnabled ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-muted text-muted-foreground border-0'}>
            {portalEnabled ? 'Portaal actief' : 'Portaal niet actief'}
          </Badge>
        </div>
        {portalEnabled ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Geactiveerd op" value={formatDate(candidate?.portal_activated_at)} />
              <Field label="Taal" value={candidate?.portal_language === 'en' ? 'English' : 'Nederlands'} />
              <Field label="Laatste login" value={formatDate(candidate?.portal_last_login) || 'Nog niet ingelogd'} />
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setSheetOpen(true)}>
              <Send className="h-4 w-4" /> Nieuwe uitnodiging versturen
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            Portaal activeren
          </Button>
        )}
      </div>

      <PortalActivateSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        employeeId={candidateId}
        candidateEmail={c?.email}
      />
    </div>
  );
};

export default EmployeeProfileTab;
