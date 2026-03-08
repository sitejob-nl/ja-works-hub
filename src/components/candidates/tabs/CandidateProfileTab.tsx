import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const CandidateProfileTab = ({ candidate }: { candidate: any }) => {
  const maskedBsn = candidate.bsn ? `****${candidate.bsn.slice(-4)}` : '—';
  const address = [candidate.address_street, candidate.address_postal, candidate.address_city].filter(Boolean).join(', ') || null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <Field label="Voornaam" value={candidate.first_name} />
        <Field label="Achternaam" value={candidate.last_name} />
        <Field label="Geboortedatum" value={formatDate(candidate.date_of_birth)} />
        <Field label="Nationaliteit" value={candidate.nationality} />
        <Field label="BSN" value={maskedBsn} />
        <Field label="IBAN" value={candidate.iban} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Contactgegevens</h3>
        <Field label="E-mail" value={candidate.email} />
        <Field label="Telefoon" value={candidate.phone} />
        <Field label="Adres" value={address} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Vaardigheden & certificaten</h3>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Vaardigheden</p>
          <div className="flex flex-wrap gap-1">
            {(candidate.skills ?? []).length > 0
              ? candidate.skills.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Certificaten</p>
          <div className="flex flex-wrap gap-1">
            {(candidate.certifications ?? []).length > 0
              ? candidate.certifications.map((c: string) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Talen</p>
          <div className="flex flex-wrap gap-1">
            {(candidate.languages ?? []).length > 0
              ? candidate.languages.map((l: string) => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Beschikbaarheid</h3>
        <Field label="Beschikbaarheid notities" value={candidate.availability_notes} />
        <div>
          <p className="text-xs text-muted-foreground">Rijbewijs</p>
          <p className="text-sm mt-0.5">
            {candidate.has_drivers_license ? 'Ja' : 'Nee'}
            {candidate.has_drivers_license && candidate.drivers_license_expiry && ` — verloopt ${formatDate(candidate.drivers_license_expiry)}`}
          </p>
        </div>
        <Field label="Bron" value={candidate.source} />
        {candidate.notes && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">Notities</p>
            <p className="text-sm whitespace-pre-wrap">{candidate.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CandidateProfileTab;
