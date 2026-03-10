import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

const VehicleInfoTab = ({ vehicle, activeAssignment }: { vehicle: any; activeAssignment: any }) => {
  const assignee = activeAssignment?.employees?.candidates as any;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Voertuiggegevens</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Kenteken</span><span className="font-medium">{vehicle.license_plate}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Merk</span><span>{vehicle.brand ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span>{vehicle.model ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Bouwjaar</span><span>{vehicle.year ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Brandstof</span><span>{vehicle.fuel_type ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Kilometerstand</span><span>{vehicle.current_mileage != null ? vehicle.current_mileage.toLocaleString('nl-NL') + ' km' : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tankcapaciteit</span><span>{vehicle.tank_capacity_liters != null ? vehicle.tank_capacity_liters + ' liter' : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tankpas referentie</span><span>{vehicle.fuel_card_reference ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Gem. verbruik</span><span>{vehicle.avg_consumption_per_100km != null ? vehicle.avg_consumption_per_100km + ' l/100km' : '—'}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Huidige toewijzing</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {activeAssignment ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Medewerker</span>
                <Link to={`/medewerkers/${activeAssignment.employees?.id}`} className="text-primary hover:underline">
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
  );
};

export default VehicleInfoTab;
