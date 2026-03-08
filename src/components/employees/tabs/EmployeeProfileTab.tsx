import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';

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

const EmployeeProfileTab = ({ employee }: { employee: any }) => {
  const c = employee.candidates;
  const maskedBsn = c?.bsn ? `****${c.bsn.slice(-4)}` : '—';
  const address = [c?.address_street, c?.address_postal, c?.address_city].filter(Boolean).join(', ') || null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Persoonsgegevens */}
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <Field label="Voornaam" value={c?.first_name} />
        <Field label="Achternaam" value={c?.last_name} />
        <Field label="Geboortedatum" value={formatDate(c?.date_of_birth)} />
        <Field label="Nationaliteit" value={c?.nationality} />
        <Field label="BSN" value={maskedBsn} />
        <Field label="IBAN" value={c?.iban} />
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
        <Field label="Medewerkernummer" value={employee.employee_number} />
        <Field label="Startdatum" value={formatDate(employee.start_date)} />
        <Field label="Einddatum" value={formatDate(employee.end_date)} />
        <Field label="Contracttype" value={contractLabels[employee.contract_type] ?? employee.contract_type} />
        <Field label="Contracturen" value={employee.contract_hours != null ? `${employee.contract_hours} uur/week` : null} />
        <Field label="Status" value={statusLabel[employee.status] ?? employee.status} />
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
    </div>
  );
};

export default EmployeeProfileTab;
