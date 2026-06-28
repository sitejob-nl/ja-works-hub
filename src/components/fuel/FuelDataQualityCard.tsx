import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FuelAnalysisDataQuality } from '@/lib/fuel-analysis';

export const FuelDataQualityCard = ({ stats, transactionsWithoutVehicle }: {
  stats: FuelAnalysisDataQuality | undefined;
  transactionsWithoutVehicle: number;
}) => {
  if (!stats) return null;

  const items = [
    { label: 'Tankpas ontbreekt', value: stats.withoutFuelCard },
    { label: 'Tankinhoud ontbreekt', value: stats.withoutTankCapacity },
    { label: 'Verbruik ontbreekt', value: stats.withoutConsumption },
    { label: 'Kilometerstand ontbreekt', value: stats.withoutMileage },
    { label: 'Aantal deuren ontbreekt', value: stats.withoutDoors },
    { label: 'Zitplaatsen ontbreken', value: stats.withoutSeats },
    { label: 'Transacties zonder voertuig', value: transactionsWithoutVehicle },
  ];
  const hasIssues = items.some((item) => item.value > 0);

  return (
    <Card className={`mb-6 ${hasIssues ? 'border-amber-200 bg-amber-50/50' : 'border-green-200 bg-green-50/50'}`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-3">
          {hasIssues ? <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5" /> : <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />}
          <div>
            <p className="text-sm font-semibold">Datakwaliteit voor analyse</p>
            <p className="text-xs text-muted-foreground">{stats.vehiclesTotal} voertuigen in fleetbeheer</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="rounded-md border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-lg font-semibold ${item.value > 0 ? 'text-amber-700' : 'text-green-700'}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
