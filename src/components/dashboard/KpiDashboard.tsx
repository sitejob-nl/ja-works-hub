import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { DollarSign, Clock, Home, Car, Building2, TrendingUp } from 'lucide-react';

const KpiDashboard = () => {
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: kpis } = useQuery({
    queryKey: ['kpi-dashboard', weekStart],
    queryFn: async () => {
      const [tsRes, placRes, unitRes, vehicleRes, clientRes] = await Promise.all([
        // Weekly hours + revenue
        supabase
          .from('timesheets')
          .select('hours, overtime_hours, hourly_rate, employee_id, placement_id, placements!timesheets_placement_id_fkey(company_id, companies!placements_company_id_fkey(name))')
          .gte('work_date', weekStart)
          .lte('work_date', weekEnd),
        // Active placements
        supabase
          .from('placements')
          .select('id, company_id, hourly_rate, companies!placements_company_id_fkey(name)')
          .eq('status', 'actief' as any),
        // Housing occupancy
        supabase.from('v_unit_occupancy').select('capacity, current_occupancy'),
        // Vehicles
        supabase.from('vehicles').select('id, status'),
        // Active companies
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('is_active', true),
      ]);

      // Total hours this week
      const timesheets = tsRes.data ?? [];
      const totalHours = timesheets.reduce((s, t: any) => s + Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0), 0);

      // Gross revenue (hours * rate) — simplified margin calc
      const grossRevenue = timesheets.reduce((s, t: any) => {
        const rate = Number(t.hourly_rate ?? 0);
        const hrs = Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0);
        return s + (rate * hrs);
      }, 0);

      // Hours per client
      const clientHours: Record<string, { name: string; hours: number }> = {};
      for (const t of timesheets as any[]) {
        const companyName = t.placements?.companies?.name ?? 'Onbekend';
        const companyId = t.placements?.company_id ?? 'unknown';
        if (!clientHours[companyId]) clientHours[companyId] = { name: companyName, hours: 0 };
        clientHours[companyId].hours += Number(t.hours ?? 0) + Number(t.overtime_hours ?? 0);
      }
      const topClients = Object.values(clientHours)
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 5);

      // Housing
      const units = unitRes.data ?? [];
      const totalCapacity = units.reduce((s: number, u: any) => s + (u.capacity ?? 0), 0);
      const totalOccupied = units.reduce((s: number, u: any) => s + Number(u.current_occupancy ?? 0), 0);
      const availableRooms = totalCapacity - totalOccupied;

      // Vehicles
      const vehicles = vehicleRes.data ?? [];
      const availableCars = vehicles.filter((v: any) => v.status === 'beschikbaar').length;

      return {
        totalHours: Math.round(totalHours * 100) / 100,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        activePlacements: (placRes.data ?? []).length,
        availableRooms,
        totalRooms: totalCapacity,
        availableCars,
        totalCars: vehicles.length,
        activeClients: clientRes.count ?? 0,
        topClients,
      };
    },
  });

  const k = kpis ?? {
    totalHours: 0, grossRevenue: 0, activePlacements: 0,
    availableRooms: 0, totalRooms: 0, availableCars: 0, totalCars: 0,
    activeClients: 0, topClients: [],
  };

  const cards = [
    { icon: Clock, label: 'Uren deze week', value: k.totalHours.toFixed(1), color: 'text-stat-blue', bg: 'bg-stat-blue/10' },
    { icon: DollarSign, label: 'Omzet deze week', value: `€${k.grossRevenue.toLocaleString('nl-NL', { minimumFractionDigits: 0 })}`, color: 'text-stat-green', bg: 'bg-stat-green/10' },
    { icon: TrendingUp, label: 'Actieve plaatsingen', value: k.activePlacements, color: 'text-stat-orange', bg: 'bg-stat-orange/10' },
    { icon: Building2, label: 'Actieve klanten', value: k.activeClients, color: 'text-stat-purple', bg: 'bg-stat-purple/10' },
    { icon: Home, label: 'Kamers beschikbaar', value: `${k.availableRooms}/${k.totalRooms}`, color: 'text-stat-blue', bg: 'bg-stat-blue/10' },
    { icon: Car, label: "Auto's beschikbaar", value: `${k.availableCars}/${k.totalCars}`, color: 'text-stat-orange', bg: 'bg-stat-orange/10' },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Directie KPI's</h2>
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
          </div>
        ))}
      </div>

      {k.topClients.length > 0 && (
        <div className="bg-card border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">Uren per klant deze week</h3>
          <div className="space-y-1.5">
            {k.topClients.map((c, i) => {
              const maxHours = k.topClients[0]?.hours ?? 1;
              const pct = (c.hours / maxHours) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm w-32 truncate">{c.name}</span>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-16 text-right">{c.hours.toFixed(1)}u</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default KpiDashboard;
