import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { logAudit } from '@/lib/audit';
import { lookupRdw, normalizeRdwFuel, yearFromRdwDate } from '@/lib/rdw';
import { toast } from 'sonner';
import { Car, Check, X } from 'lucide-react';

const VehicleInfoTab = ({ vehicle, activeAssignment }: { vehicle: any; activeAssignment: any }) => {
  const assignee = activeAssignment?.employees?.candidates as any;
  const [rdwPreview, setRdwPreview] = useState<any>(null);
  const qc = useQueryClient();

  const rdwLookup = useMutation({
    mutationFn: (plate: string) => lookupRdw(plate),
    onSuccess: (data) => {
      setRdwPreview(data);
      toast.success('RDW-gegevens opgehaald');
    },
    onError: (e: any) => {
      setRdwPreview(null);
      toast.error(e.message || 'RDW-lookup mislukt');
    },
  });

  const applyRdwData = useMutation({
    mutationFn: async () => {
      if (!rdwPreview) return;
      const payload: any = {};
      if (rdwPreview.brand) payload.brand = rdwPreview.brand;
      if (rdwPreview.model) payload.model = rdwPreview.model;
      const fuel = normalizeRdwFuel(rdwPreview.fuel_type);
      if (fuel) payload.fuel_type = fuel;
      if (rdwPreview.color) payload.color = rdwPreview.color;
      const year = yearFromRdwDate(rdwPreview.first_registration);
      if (year) payload.year = year;
      if (rdwPreview.apk_expiry) payload.apk_expiry = rdwPreview.apk_expiry;
      if (rdwPreview.first_registration) payload.first_registration = rdwPreview.first_registration;
      const registrationDate = rdwPreview.last_registration ?? rdwPreview.first_registration_nl;
      if (registrationDate) payload.first_registration_nl = registrationDate;
      if (rdwPreview.seats) payload.seats = rdwPreview.seats;
      if (rdwPreview.doors != null) payload.doors = rdwPreview.doors;
      if (rdwPreview.weight) payload.weight = rdwPreview.weight;
      if (rdwPreview.fuel_consumption != null) payload.avg_consumption_per_100km = rdwPreview.fuel_consumption;
      await unwrap(supabase.from('vehicles').update(payload).eq('id', vehicle.id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.vehicles.detail(vehicle.id) });
      logAudit({ action: 'update', tableName: 'vehicles', recordId: vehicle.id, newValues: { source: 'rdw_enrichment', license_plate: vehicle.license_plate } });
      setRdwPreview(null);
      toast.success('RDW-gegevens overgenomen');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 mt-4">
      {rdwPreview && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-start">
            <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300">RDW-gegevens gevonden</h4>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRdwPreview(null)}><X className="h-3.5 w-3.5" /></Button>
              <Button size="sm" onClick={() => applyRdwData.mutate()} disabled={applyRdwData.isPending}>
                <Check className="h-3.5 w-3.5 mr-1" />{applyRdwData.isPending ? 'Overnemen...' : 'Overnemen'}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {rdwPreview.brand && <div><span className="text-muted-foreground">Merk:</span> {rdwPreview.brand}</div>}
            {rdwPreview.model && <div><span className="text-muted-foreground">Model:</span> {rdwPreview.model}</div>}
            {rdwPreview.color && <div><span className="text-muted-foreground">Kleur:</span> {rdwPreview.color}</div>}
            {rdwPreview.fuel_type && <div><span className="text-muted-foreground">Brandstof:</span> {rdwPreview.fuel_type}</div>}
            {rdwPreview.first_registration && <div><span className="text-muted-foreground">1e toelating:</span> {formatDate(rdwPreview.first_registration)}</div>}
            {rdwPreview.last_registration && <div><span className="text-muted-foreground">Laatste tenaamstelling:</span> {formatDate(rdwPreview.last_registration)}</div>}
            {!rdwPreview.last_registration && rdwPreview.first_registration_nl && <div><span className="text-muted-foreground">Tenaamstelling NL:</span> {formatDate(rdwPreview.first_registration_nl)}</div>}
            {rdwPreview.apk_expiry && <div><span className="text-muted-foreground">APK vervalt:</span> {formatDate(rdwPreview.apk_expiry)}</div>}
            {rdwPreview.fuel_consumption != null && <div><span className="text-muted-foreground">Gemengd verbruik:</span> {rdwPreview.fuel_consumption} l/100km</div>}
            {rdwPreview.seats && <div><span className="text-muted-foreground">Zitplaatsen:</span> {rdwPreview.seats}</div>}
            {rdwPreview.doors != null && <div><span className="text-muted-foreground">Deuren:</span> {rdwPreview.doors}</div>}
            {rdwPreview.co2_emission && <div><span className="text-muted-foreground">CO2:</span> {rdwPreview.co2_emission} g/km</div>}
            {rdwPreview.stolen && <div className="text-red-600 font-medium">Gestolen!</div>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-base">Voertuiggegevens</CardTitle>
            {vehicle.license_plate && (
              <Button size="sm" variant="outline" onClick={() => rdwLookup.mutate(vehicle.license_plate)} disabled={rdwLookup.isPending}>
                <Car className="h-3.5 w-3.5 mr-1" />{rdwLookup.isPending ? 'Ophalen...' : 'RDW Ophalen'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Kenteken</span><span className="font-medium">{vehicle.license_plate}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Merk</span><span>{vehicle.brand ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span>{vehicle.model ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Bouwjaar</span><span>{vehicle.year ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Laatste tenaamstelling</span><span>{vehicle.first_registration_nl ? formatDate(vehicle.first_registration_nl) : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Aantal deuren</span><span>{vehicle.doors ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Zitplaatsen</span><span>{vehicle.seats ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Brandstof</span><span>{vehicle.fuel_type ?? '—'}</span></div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">APK vervalt</span>
            {(() => {
              if (!vehicle.apk_expiry) return <span>—</span>;
              const days = (() => { try { return differenceInCalendarDays(parseISO(vehicle.apk_expiry), new Date()); } catch { return null; } })();
              const variant = days != null && days < 0 ? 'destructive' : days != null && days < 60 ? 'secondary' : null;
              return (
                <span className="flex items-center gap-2">
                  <span>{formatDate(vehicle.apk_expiry)}</span>
                  {variant && <Badge variant={variant} className="text-[10px]">{days! < 0 ? `${Math.abs(days!)}d verlopen` : `${days}d`}</Badge>}
                </span>
              );
            })()}
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">Kilometerstand</span><span>{vehicle.current_mileage != null ? vehicle.current_mileage.toLocaleString('nl-NL') + ' km' : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tankcapaciteit</span><span>{vehicle.tank_capacity_liters != null ? vehicle.tank_capacity_liters + ' liter' : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tankpas referentie</span><span>{vehicle.fuel_card_reference ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Gemengd verbruik</span><span>{vehicle.avg_consumption_per_100km != null ? vehicle.avg_consumption_per_100km + ' l/100km' : '—'}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Huidige toewijzing</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {activeAssignment ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Medewerker</span>
                <Link to={`/medewerkers/${activeAssignment.employees?.id}`} className="hover:underline">
                  {assignee?.first_name} {assignee?.last_name}
                </Link>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Startdatum</span><span>{formatDate(activeAssignment.assigned_date)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Begin km</span><span>{activeAssignment.start_mileage?.toLocaleString('nl-NL') ?? '—'}</span></div>
            </>
          ) : (
            <p className="text-muted-foreground">Niet toegewezen</p>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
};

export default VehicleInfoTab;
