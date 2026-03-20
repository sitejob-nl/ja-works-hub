import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns';
import { nl } from 'date-fns/locale';
import {
  DollarSign, Clock, Home, Car, Building2, TrendingUp, Users, Percent,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';

const CHART_COLORS = [
  'hsl(197, 100%, 60%)',
  'hsl(25, 95%, 53%)',
  'hsl(142, 71%, 45%)',
  'hsl(262, 83%, 58%)',
  'hsl(340, 75%, 55%)',
  'hsl(45, 93%, 47%)',
  'hsl(180, 60%, 45%)',
  'hsl(210, 60%, 50%)',
];

const KpiDashboard = () => {
  const now = new Date();
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

  const { data: kpis } = useQuery({
    queryKey: ['kpi-dashboard-v2', weekStart, monthStart],
    queryFn: async () => {
      const [tsWeekRes, tsMonthRes, placRes, unitRes, vehicleRes, clientRes, empRes] = await Promise.all([
        // Weekly timesheets
        supabase
          .from('timesheets')
          .select('hours, overtime_hours, hourly_rate, employee_id, placement_id, placements!timesheets_placement_id_fkey(company_id, hourly_rate, client_hourly_rate, companies!placements_company_id_fkey(name))')
          .gte('work_date', weekStart)
          .lte('work_date', weekEnd),
        // Monthly timesheets
        supabase
          .from('timesheets')
          .select('hours, overtime_hours, hourly_rate, placement_id, placements!timesheets_placement_id_fkey(company_id, hourly_rate, client_hourly_rate, companies!placements_company_id_fkey(name))')
          .gte('work_date', monthStart)
          .lte('work_date', monthEnd),
        // Active placements with rates
        supabase
          .from('placements')
          .select('id, hourly_rate, client_hourly_rate, company_id, companies!placements_company_id_fkey(name)')
          .eq('status', 'actief' as any),
        // Housing occupancy
        supabase.from('v_unit_occupancy').select('capacity, current_occupancy'),
        // Vehicles
        supabase.from('vehicles').select('id, status, license_plate'),
        // Active companies
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('is_active', true),
        // Active employees
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'actief' as any),
      ]);

      const tsWeek = tsWeekRes.data ?? [];
      const tsMonth = tsMonthRes.data ?? [];

      // Weekly hours & revenue
      const totalHoursWeek = tsWeek.reduce((s, t: any) => s + Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0), 0);
      const revenueWeek = tsWeek.reduce((s, t: any) => {
        const clientRate = Number((t.placements as any)?.hourly_rate ?? t.hourly_rate ?? 0);
        const hrs = Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0);
        return s + clientRate * hrs;
      }, 0);
      const costWeek = tsWeek.reduce((s, t: any) => {
        const empRate = Number(t.hourly_rate ?? 0);
        const hrs = Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0);
        return s + empRate * hrs;
      }, 0);
      const marginWeek = revenueWeek - costWeek;
      const marginPctWeek = revenueWeek > 0 ? (marginWeek / revenueWeek) * 100 : 0;

      // Monthly revenue per client
      const clientRevenue: Record<string, { name: string; revenue: number; cost: number; hours: number }> = {};
      for (const t of tsMonth as any[]) {
        const companyName = t.placements?.companies?.name ?? 'Onbekend';
        const companyId = t.placements?.company_id ?? 'unknown';
        const clientRate = Number(t.placements?.hourly_rate ?? t.hourly_rate ?? 0);
        const empRate = Number(t.hourly_rate ?? 0);
        const hrs = Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0);
        if (!clientRevenue[companyId]) clientRevenue[companyId] = { name: companyName, revenue: 0, cost: 0, hours: 0 };
        clientRevenue[companyId].revenue += clientRate * hrs;
        clientRevenue[companyId].cost += empRate * hrs;
        clientRevenue[companyId].hours += hrs;
      }
      const revenueByClient = Object.values(clientRevenue)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      // Housing
      const units = unitRes.data ?? [];
      const totalCapacity = units.reduce((s: number, u: any) => s + (u.capacity ?? 0), 0);
      const totalOccupied = units.reduce((s: number, u: any) => s + Number(u.current_occupancy ?? 0), 0);

      // Vehicles
      const vehicles = vehicleRes.data ?? [];
      const availableCars = vehicles.filter((v: any) => v.status === 'beschikbaar').length;
      const inUseCars = vehicles.filter((v: any) => v.status === 'in_gebruik').length;
      const maintenanceCars = vehicles.filter((v: any) => v.status === 'onderhoud').length;

      return {
        totalHoursWeek: Math.round(totalHoursWeek * 100) / 100,
        revenueWeek: Math.round(revenueWeek),
        costWeek: Math.round(costWeek),
        marginWeek: Math.round(marginWeek),
        marginPctWeek: Math.round(marginPctWeek * 10) / 10,
        activePlacements: (placRes.data ?? []).length,
        activeClients: clientRes.count ?? 0,
        activeEmployees: empRes.count ?? 0,
        totalCapacity,
        totalOccupied,
        availableRooms: totalCapacity - totalOccupied,
        occupancyPct: totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0,
        availableCars,
        inUseCars,
        maintenanceCars,
        totalCars: vehicles.length,
        revenueByClient,
        vehicleData: [
          { name: 'Beschikbaar', value: availableCars },
          { name: 'In gebruik', value: inUseCars },
          { name: 'Onderhoud', value: maintenanceCars },
        ].filter(d => d.value > 0),
        housingData: [
          { name: 'Bezet', value: totalOccupied },
          { name: 'Vrij', value: totalCapacity - totalOccupied },
        ].filter(d => d.value > 0),
      };
    },
  });

  const k = kpis ?? {
    totalHoursWeek: 0, revenueWeek: 0, costWeek: 0, marginWeek: 0, marginPctWeek: 0,
    activePlacements: 0, activeClients: 0, activeEmployees: 0,
    totalCapacity: 0, totalOccupied: 0, availableRooms: 0, occupancyPct: 0,
    availableCars: 0, inUseCars: 0, maintenanceCars: 0, totalCars: 0,
    revenueByClient: [], vehicleData: [], housingData: [],
  };

  const fmt = (n: number) => `€${n.toLocaleString('nl-NL')}`;

  const cards = [
    { icon: DollarSign, label: 'Omzet deze week', value: fmt(k.revenueWeek), sub: `Kosten: ${fmt(k.costWeek)}`, color: 'text-stat-green', bg: 'bg-stat-green/10' },
    { icon: TrendingUp, label: 'Brutomarge', value: fmt(k.marginWeek), sub: `${k.marginPctWeek}% marge`, color: 'text-stat-blue', bg: 'bg-stat-blue/10' },
    { icon: Clock, label: 'Uren deze week', value: k.totalHoursWeek.toFixed(0), sub: `${k.activePlacements} actieve plaatsingen`, color: 'text-stat-purple', bg: 'bg-stat-purple/10' },
    { icon: Users, label: 'Actieve medewerkers', value: k.activeEmployees, sub: `${k.activeClients} opdrachtgevers`, color: 'text-stat-orange', bg: 'bg-stat-orange/10' },
    { icon: Home, label: 'Kamerbezetting', value: `${k.occupancyPct}%`, sub: `${k.availableRooms} van ${k.totalCapacity} vrij`, color: 'text-stat-green', bg: 'bg-stat-green/10' },
    { icon: Car, label: "Wagenpark", value: `${k.availableCars} vrij`, sub: `${k.totalCars} totaal`, color: 'text-stat-orange', bg: 'bg-stat-orange/10' },
  ];

  const monthLabel = format(now, 'MMMM yyyy', { locale: nl });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Directie KPI's</h2>
        <span className="text-xs text-muted-foreground">Week {format(now, 'w')} • {monthLabel}</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`h-7 w-7 rounded-md ${c.bg} flex items-center justify-center`}>
                <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
              </div>
            </div>
            <p className="text-lg font-semibold">{c.value}</p>
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            {c.sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue per client bar chart */}
        <div className="lg:col-span-2 bg-card border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground mb-3">
            Omzet per opdrachtgever — {monthLabel}
          </h3>
          {k.revenueByClient.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Geen data</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={k.revenueByClient} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  fontSize={11}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `€${value.toLocaleString('nl-NL')}`,
                    name === 'revenue' ? 'Omzet' : 'Kosten',
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="revenue" name="Omzet" radius={[0, 4, 4, 0]} barSize={16}>
                  {k.revenueByClient.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Donut charts for housing & vehicles */}
        <div className="space-y-4">
          {/* Housing donut */}
          <div className="bg-card border rounded-lg p-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Kamerbezetting</h3>
            {k.totalCapacity === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Geen kamers</p>
            ) : (
              <div className="flex items-center gap-2">
                <ResponsiveContainer width={100} height={100}>
                  <PieChart>
                    <Pie
                      data={k.housingData}
                      cx="50%" cy="50%"
                      innerRadius={28} outerRadius={44}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill="hsl(142, 71%, 45%)" />
                      <Cell fill="hsl(210, 20%, 94%)" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-stat-green" />
                    <span>{k.totalOccupied} bezet</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted" />
                    <span>{k.availableRooms} vrij</span>
                  </div>
                  <p className="text-muted-foreground font-medium">{k.occupancyPct}% bezet</p>
                </div>
              </div>
            )}
          </div>

          {/* Vehicle donut */}
          <div className="bg-card border rounded-lg p-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Wagenpark</h3>
            {k.totalCars === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Geen voertuigen</p>
            ) : (
              <div className="flex items-center gap-2">
                <ResponsiveContainer width={100} height={100}>
                  <PieChart>
                    <Pie
                      data={k.vehicleData}
                      cx="50%" cy="50%"
                      innerRadius={28} outerRadius={44}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill="hsl(142, 71%, 45%)" />
                      <Cell fill="hsl(25, 95%, 53%)" />
                      <Cell fill="hsl(0, 72%, 51%)" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-stat-green" />
                    <span>{k.availableCars} beschikbaar</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-stat-orange" />
                    <span>{k.inUseCars} in gebruik</span>
                  </div>
                  {k.maintenanceCars > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-destructive" />
                      <span>{k.maintenanceCars} onderhoud</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Margin per client table */}
      {k.revenueByClient.length > 0 && (
        <div className="bg-card border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground mb-3">Marge per opdrachtgever — {monthLabel}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Opdrachtgever</th>
                  <th className="pb-2 font-medium text-right">Uren</th>
                  <th className="pb-2 font-medium text-right">Omzet</th>
                  <th className="pb-2 font-medium text-right">Kosten</th>
                  <th className="pb-2 font-medium text-right">Marge</th>
                  <th className="pb-2 font-medium text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {k.revenueByClient.map((c, i) => {
                  const margin = c.revenue - c.cost;
                  const pct = c.revenue > 0 ? Math.round((margin / c.revenue) * 100) : 0;
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{c.name}</td>
                      <td className="py-2 text-right text-muted-foreground">{c.hours.toFixed(1)}</td>
                      <td className="py-2 text-right">{fmt(Math.round(c.revenue))}</td>
                      <td className="py-2 text-right text-muted-foreground">{fmt(Math.round(c.cost))}</td>
                      <td className={`py-2 text-right font-medium ${margin >= 0 ? 'text-stat-green' : 'text-destructive'}`}>
                        {fmt(Math.round(margin))}
                      </td>
                      <td className={`py-2 text-right ${pct >= 20 ? 'text-stat-green' : pct >= 0 ? 'text-stat-orange' : 'text-destructive'}`}>
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default KpiDashboard;
