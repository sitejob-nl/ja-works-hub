import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Clock, AlertTriangle, Building, Car, MapPin, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { startOfWeek, endOfWeek, subWeeks, getISOWeek, format } from 'date-fns';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, Line, ComposedChart, PieChart, Pie, Cell } from 'recharts';

const PortalDashboard = () => {
  const { employee, candidate } = usePortal();
  const employeeId = employee?.id;
  const firstName = candidate?.first_name ?? 'Medewerker';

  // Active placements
  const { data: placements = [] } = useQuery({
    queryKey: ['portal-placements', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('placements')
        .select('*, companies:company_id(name), vacancies:vacancy_id(title)')
        .eq('candidate_id', employeeId!)
        .eq('status', 'actief' as any);
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  // Last 12 weeks hours data
  const { data: weeklyData = [] } = useQuery({
    queryKey: ['portal-weekly-hours', employeeId],
    queryFn: async () => {
      const now = new Date();
      const start = format(startOfWeek(subWeeks(now, 11), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const end = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');

      const { data } = await supabase
        .from('timesheets')
        .select('work_date, hours, overtime_hours, surcharge_amount')
        .eq('candidate_id', employeeId!)
        .gte('work_date', start)
        .lte('work_date', end);

      // Group by year+week to avoid collisions across year boundaries
      const weeks = new Map<string, { key: string; week: number; hours: number; overtime: number; surcharges: number }>();
      (data ?? []).forEach((t) => {
        const d = new Date(t.work_date);
        const w = getISOWeek(d);
        const year = d.getFullYear();
        const key = `${year}-W${w}`;
        const existing = weeks.get(key) ?? { key, week: w, hours: 0, overtime: 0, surcharges: 0 };
        existing.hours += Number(t.hours) || 0;
        existing.overtime += Number(t.overtime_hours) || 0;
        existing.surcharges += Number(t.surcharge_amount) || 0;
        weeks.set(key, existing);
      });

      return Array.from(weeks.values()).sort((a, b) => a.key.localeCompare(b.key));
    },
    enabled: !!employeeId,
  });

  // Surcharges breakdown for pie chart
  const { data: surchargeData = [] } = useQuery({
    queryKey: ['portal-surcharges', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('timesheets')
        .select('surcharge_amount, allowances_amount, travel_amount')
        .eq('candidate_id', employeeId!)
        .not('surcharge_amount', 'is', null);

      let surcharges = 0, allowances = 0, travel = 0;
      (data ?? []).forEach((t) => {
        surcharges += Number(t.surcharge_amount) || 0;
        allowances += Number(t.allowances_amount) || 0;
        travel += Number(t.travel_amount) || 0;
      });

      return [
        { name: 'Toeslagen', value: Math.round(surcharges * 100) / 100, fill: 'hsl(var(--primary))' },
        { name: 'Vergoedingen', value: Math.round(allowances * 100) / 100, fill: 'hsl(var(--accent))' },
        { name: 'Reiskosten', value: Math.round(travel * 100) / 100, fill: 'hsl(var(--muted-foreground))' },
      ].filter((d) => d.value > 0);
    },
    enabled: !!employeeId,
  });

  // Hours this week
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: timesheets } = useQuery({
    queryKey: ['portal-hours', employeeId, weekStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('timesheets')
        .select('hours, status')
        .eq('candidate_id', employeeId!)
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
        .eq('candidate_id', employeeId!)
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
        .eq('candidate_id', employeeId!)
        .is('end_date', null)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // Recent approved/rejected timesheets for notifications
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  })();

  const { data: recentNotifications = [] } = useQuery({
    queryKey: ['portal-notifications', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('timesheets')
        .select('id, work_date, status, approved_at')
        .eq('candidate_id', employeeId!)
        .gte('approved_at', sevenDaysAgo)
        .in('status', ['goedgekeurd', 'afgekeurd'] as any)
        .order('approved_at', { ascending: false })
        .limit(3);
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  // Expiring docs
  const { data: docIssues } = useQuery({
    queryKey: ['portal-doc-issues', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('id, name, status')
        .eq('candidate_id', employeeId!)
        .in('status', ['verlopen', 'bijna_verlopen'] as any);
      return data ?? [];
    },
    enabled: !!employeeId,
  });

  return (
    <div className="space-y-4">
      {/* Welcome card */}
      <div className="bg-card rounded-xl border p-5">
        <h1 className="text-lg font-semibold">Welkom, {firstName} 👋</h1>
        {placements.length > 0 ? (
          <div className="mt-2 space-y-2">
            {placements.map((p: any) => (
              <div key={p.id} className="text-sm text-muted-foreground">
                <p>
                  Plaatsing bij <span className="font-medium text-foreground">{p.companies?.name}</span>
                  {p.vacancies?.title && <span className="text-xs"> · {p.vacancies.title}</span>}
                </p>
                <p className="text-xs">Sinds {formatDate(p.start_date)}{p.end_date ? ` tot ${formatDate(p.end_date)}` : ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Je hebt momenteel geen actieve plaatsing</p>
        )}
      </div>

      {/* Active placement card */}
      {placements.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="h-5 w-5 text-primary" />
            <h2 className="font-medium">Mijn plaatsing</h2>
          </div>
          <div className="text-sm space-y-1">
            <p className="font-medium">{(placements[0] as any).companies?.name}</p>
            <p className="text-muted-foreground">
              {(placements[0] as any).function_name && `${(placements[0] as any).function_name} · `}
              Sinds {formatDate((placements[0] as any).start_date)}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="mt-3 w-full">
            <Link to="/portaal/plaatsingen">Bekijk details</Link>
          </Button>
        </div>
      )}

      {/* Recent notifications */}
      {recentNotifications.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="font-medium">Recente meldingen</h2>
          </div>
          <ul className="space-y-2">
            {recentNotifications.map((n: any) => (
              <li key={n.id} className="text-sm">
                <span className={n.status === 'goedgekeurd' ? 'text-stat-green' : 'text-destructive'}>
                  {n.status === 'goedgekeurd'
                    ? `Je uren van ${formatDate(n.work_date)} zijn goedgekeurd \u2713`
                    : `Je uren van ${formatDate(n.work_date)} zijn afgekeurd \u2717`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hours this week */}
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

      {/* Charts */}
      {weeklyData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Uren per week (laatste 12 weken)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{
              hours: { label: 'Uren', color: 'hsl(var(--primary))' },
              overtime: { label: 'Overwerk', color: 'hsl(var(--destructive))' },
            }} className="h-[200px] w-full">
              <ComposedChart data={weeklyData}>
                <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(w) => `W${w}`} />
                <YAxis tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Uren" />
                <Line type="monotone" dataKey="overtime" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} name="Overwerk" />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {surchargeData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Toeslagen breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <ChartContainer config={{
                surcharges: { label: 'Toeslagen', color: 'hsl(var(--primary))' },
                allowances: { label: 'Vergoedingen', color: 'hsl(var(--accent))' },
              }} className="h-[140px] w-[140px]">
                <PieChart>
                  <Pie data={surchargeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                    {surchargeData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
              <div className="space-y-2 text-sm">
                {surchargeData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: d.fill }} />
                    <span>{d.name}: <strong>€{d.value.toFixed(2)}</strong></span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Doc issues */}
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
