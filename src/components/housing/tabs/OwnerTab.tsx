import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ExternalLink, Phone, Mail, ShieldCheck, ShieldX, Zap, AlertTriangle, FileText } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { differenceInDays, parseISO } from 'date-fns';

const OwnerTab = ({ property }: { property: any }) => {
  const { data: contracts = [] } = useQuery({
    queryKey: ['property-contracts-recent', property.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_contracts' as any)
        .select('id, file_path, original_name, start_date, end_date, created_at')
        .eq('property_id', property.id)
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; file_path: string; original_name: string; start_date: string | null; end_date: string | null; created_at: string }>;
    },
    enabled: !!property?.id,
  });

  const openContract = async (path: string) => {
    const { data, error } = await supabase.storage.from('property-contracts').createSignedUrl(path, 60);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const contractPeriod = (start: string | null, end: string | null) => {
    if (start && end) return `Van ${formatDate(start)} tot ${formatDate(end)}`;
    if (start) return `Van ${formatDate(start)}`;
    if (end) return `Tot ${formatDate(end)}`;
    return null;
  };

  const permitExpiry = (dateStr: string | null) => {
    if (!dateStr) return null;
    const days = differenceInDays(parseISO(dateStr), new Date());
    if (days < 0) return { label: 'Verlopen', className: 'bg-red-100 text-red-700 border-0' };
    if (days < 30) return { label: `Verloopt over ${days}d`, className: 'bg-orange-100 text-orange-700 border-0' };
    return null;
  };

  const currentOccupancy = useMemo(() => {
    const units = property.units ?? [];
    return units.reduce((s: number, u: any) =>
      s + ((u.housing_assignments ?? []).filter((a: any) => a.status === 'ingecheckt').length), 0);
  }, [property]);

  const rentalExpiry = permitExpiry(property.rental_permit_expiry);
  const snfExpiry = permitExpiry(property.snf_certificate_expiry);
  const overCapacity = property.max_persons_permit && currentOccupancy > property.max_persons_permit;

  const ownershipLabels: Record<string, string> = { huur: 'Huur', eigendom: 'Eigendom', beheer: 'Beheer' };
  const owner = property.property_owners ?? null;

  return (
    <div className="space-y-6">
      {/* Owner info */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Eigenaar / Verhuurder</h3>
        {!owner ? (
          <p className="text-sm text-muted-foreground">Geen eigenaar gekoppeld.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoRow label="Naam" value={owner.name} />
            <InfoRow label="Contactpersoon" value={owner.contact_person} />
            {owner.phone && (
              <div>
                <p className="text-xs text-muted-foreground">Telefoon</p>
                <a href={`tel:${owner.phone}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {owner.phone}
                </a>
              </div>
            )}
            {owner.email && (
              <div>
                <p className="text-xs text-muted-foreground">E-mail</p>
                <a href={`mailto:${owner.email}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {owner.email}
                </a>
              </div>
            )}
            {property.ownership_type && (
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <Badge variant="secondary" className="mt-1">{ownershipLabels[property.ownership_type] ?? property.ownership_type}</Badge>
              </div>
            )}
            <div className="md:col-span-2">
              <Separator className="my-2" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Huurcontracten</p>
              {contracts.length === 0 && !property.rental_contract_url ? (
                <p className="text-sm text-muted-foreground italic">Nog geen huurcontracten</p>
              ) : (
                <div className="space-y-2">
                  {contracts.map((c) => {
                    const period = contractPeriod(c.start_date, c.end_date);
                    return (
                      <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                        <div className="min-w-0 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.original_name}</p>
                            {period && <p className="text-xs text-muted-foreground">{period}</p>}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => openContract(c.file_path)} className="gap-1 shrink-0">
                          <ExternalLink className="h-3.5 w-3.5" /> Open
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              {property.rental_contract_url && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">Externe contractlink (legacy)</p>
                  <a href={property.rental_contract_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 mt-1">
                    <ExternalLink className="h-3.5 w-3.5" /> Bekijk contract
                  </a>
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <Separator className="my-2" />
              <p className="text-xs text-muted-foreground mb-1">Notities</p>
              {owner.notes ? (
                <p className="text-sm whitespace-pre-wrap">{owner.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Geen notities</p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Permits */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Vergunningen</h3>

        <div className="space-y-3">
          {/* Kamerverhuurvergunning */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {property.has_rental_permit ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldX className="h-4 w-4 text-muted-foreground" />}
                <p className="text-sm font-medium">Kamerverhuurvergunning</p>
                <Badge variant="secondary" className={`text-xs ${property.has_rental_permit ? 'bg-green-100 text-green-700 border-0' : 'bg-muted text-muted-foreground border-0'}`}>
                  {property.has_rental_permit ? 'Ja' : 'Nee'}
                </Badge>
                {rentalExpiry && <Badge variant="secondary" className={`text-xs ${rentalExpiry.className}`}>{rentalExpiry.label}</Badge>}
              </div>
              {property.has_rental_permit && (
                <div className="flex gap-4 text-xs text-muted-foreground ml-6">
                  {property.rental_permit_number && <span>Nr: {property.rental_permit_number}</span>}
                  {property.rental_permit_expiry && <span>Geldig tot: {formatDate(property.rental_permit_expiry)}</span>}
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* SNF */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {property.has_snf_certificate ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldX className="h-4 w-4 text-muted-foreground" />}
              <p className="text-sm font-medium">SNF Certificaat</p>
              <Badge variant="secondary" className={`text-xs ${property.has_snf_certificate ? 'bg-green-100 text-green-700 border-0' : 'bg-muted text-muted-foreground border-0'}`}>
                {property.has_snf_certificate ? 'Ja' : 'Nee'}
              </Badge>
              {snfExpiry && <Badge variant="secondary" className={`text-xs ${snfExpiry.className}`}>{snfExpiry.label}</Badge>}
            </div>
            {property.has_snf_certificate && (
              <div className="flex gap-4 text-xs text-muted-foreground ml-6">
                {property.snf_certificate_number && <span>Nr: {property.snf_certificate_number}</span>}
                {property.snf_certificate_expiry && <span>Geldig tot: {formatDate(property.snf_certificate_expiry)}</span>}
              </div>
            )}
          </div>

          <Separator />

          {/* Max persons */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Max personen vergunning</p>
              <span className="text-sm">{property.max_persons_permit ?? '—'}</span>
            </div>
            <div className="flex items-center gap-2 ml-0">
              <p className="text-xs text-muted-foreground">Huidige bezetting: {currentOccupancy}</p>
              {overCapacity && (
                <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 border-0 gap-1">
                  <AlertTriangle className="h-3 w-3" /> Boven max
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* EnergyWizard */}
      <Card className="p-5 space-y-2">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">EnergyWizard</h3>
        <div className="flex items-center gap-3">
          <Zap className={`h-4 w-4 ${property.energy_wizard_linked ? 'text-yellow-500' : 'text-muted-foreground'}`} />
          <Badge variant="secondary" className={`text-xs ${property.energy_wizard_linked ? 'bg-green-100 text-green-700 border-0' : 'bg-muted text-muted-foreground border-0'}`}>
            {property.energy_wizard_linked ? 'Gekoppeld' : 'Niet gekoppeld'}
          </Badge>
          {property.energy_wizard_id && <span className="text-xs text-muted-foreground">ID: {property.energy_wizard_id}</span>}
        </div>
      </Card>
    </div>
  );
};

const InfoRow = ({ label, value }: { label: string; value: string | null }) => {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
};

export default OwnerTab;
