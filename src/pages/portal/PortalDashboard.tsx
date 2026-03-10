import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Clock, AlertTriangle, Building, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { startOfWeek, endOfWeek } from 'date-fns';

const PortalDashboard = () => {
  const { employee, candidate } = usePortal();
  const employeeId = employee?.id;
  const firstName = candidate?.first_name ?? 'Medewerker';

  // Active placement
  const { data: placement } = useQuery({
    queryKey: ['portal-placement', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('*, companies:company_id(name), vacancies:vacancy_id(title)')
        .eq('employee_id', employeeId!)
        .eq('status', 'actief' as any)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Hours this week
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString().split('T')[0];
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString().split('T')[0];

  const { data: timesheets } = useQuery({
    queryKey: ['portal-hours', employeeId, weekStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('timesheets')
        .select('hours, status')
        .eq('employee_id', employeeId!)
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd);
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  const totalHours = timesheets?.reduce((sum, t) => sum + (Number(t.hours) || 0), 0) ?? 0;
  const approved = timesheets?.filter((t) => t.status === 'goedgekeurd').length ?? 0;
  const pending = timesheets?.filter((t) => t.status === 'ingediend').length ?? 0;

  // Housing
  const { data: housing } = useQuery({
    queryKey: ['portal-housing', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('housing_assignments')
        .select('*, units:unit_id(name, properties:property_id(name, address_street, address_city))')
        .eq('employee_id', employeeId!)
        .eq('status', 'ingecheckt' as any)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Vehicle
  const { data: vehicle } = useQuery({
    queryKey: ['portal-vehicle', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicle_assignments')
        .select('*, vehicles:vehicle_id(license_plate, brand, model)')
        .eq('employee_id', employeeId!)
        .is('end_date', null)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Expiring / missing documents
  const { data: docIssues } = useQuery({
    queryKey: ['portal-doc-issues', employee?.candidate_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('id, name, status')
        .eq('candidate_id', employee!.candidate_id)
        .in('status', ['verlopen', 'bijna_verlopen'] as any);
      return data ?? [];
    },
    enabled: !!employee?.candidate_id,
  });

  return (
    <div className="space-y-4">
      {/* Welcome card */}
      <div className="bg-card rounded-xl border p-5">
        <h1 className="text-lg font-semibold">Welkom, {firstName} 👋</h1>
        {placement ? (
          <div className="mt-2 text-sm text-muted-foreground">
            <p>
              Actieve plaatsing bij{' '}
              <span className="font-medium text-foreground">{(placement.companies as any)?.name}</span>
            </p>
            {(placement.vacancies as any)?.title && (
              <p className="text-xs">{(placement.vacancies as any).title}</p>
            )}
            <p className="text-xs mt-1">Sinds {formatDate(placement.start_date)}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Je hebt momenteel geen actieve plaatsing</p>
        )}
      </div>

      {/* Hours card */}
      <div className="bg-card rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="font-medium">Mijn uren deze week</h2>
          </div>
          <span className="text-2xl font-bold">{totalHours}u</span>
        </div>
        <div className="flex gap-3 mt-2">
          {approved > 0 && (
            <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0 text-xs">
              {approved} goedgekeurd
            </Badge>
          )}
          {pending > 0 && (
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 border-0 text-xs">
              {pending} in behandeling
            </Badge>
          )}
        </div>
        <Button asChild variant="outline" size="sm" className="mt-3 w-full">
          <Link to="/portaal/uren">Uren invullen</Link>
        </Button>
      </div>

      {/* Housing card */}
      {housing && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <Building className="h-5 w-5 text-primary" />
            <h2 className="font-medium">Mijn huisvesting</h2>
          </div>
          <div className="text-sm space-y-1">
            <p className="font-medium">{(housing.units as any)?.properties?.name}</p>
            <p className="text-muted-foreground">
              {(housing.units as any)?.properties?.address_street}, {(housing.units as any)?.properties?.address_city}
            </p>
            <p className="text-muted-foreground">
              Kamer: {(housing.units as any)?.name} · Ingecheckt: {formatDate(housing.check_in_date)}
            </p>
          </div>
        </div>
      )}

      {/* Vehicle card */}
      {vehicle && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <Car className="h-5 w-5 text-primary" />
            <h2 className="font-medium">Mijn auto</h2>
          </div>
          <div className="text-sm">
            <p className="font-medium">{(vehicle.vehicles as any)?.license_plate}</p>
            <p className="text-muted-foreground">
              {(vehicle.vehicles as any)?.brand} {(vehicle.vehicles as any)?.model}
            </p>
          </div>
        </div>
      )}

      {/* Actions card */}
      {docIssues && docIssues.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-stat-orange" />
            <h2 className="font-medium">Openstaande acties</h2>
          </div>
          <ul className="space-y-2">
            {docIssues.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between text-sm">
                <span>{doc.name}</span>
                <Badge variant="secondary" className="bg-red-100 text-red-600 border-0 text-xs">
                  {doc.status === 'verlopen' ? 'Verlopen' : 'Bijna verlopen'}
                </Badge>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" size="sm" className="mt-3 w-full">
            <Link to="/portaal/documenten">Documenten bekijken</Link>
          </Button>
        </div>
      )}
    </div>
  );
};

export default PortalDashboard;
