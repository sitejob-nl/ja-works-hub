import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { UserCheck, Briefcase, Home, Clock, CheckCircle2 } from 'lucide-react';
import { startOfWeek, endOfWeek, format } from 'date-fns';

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  colorClass: string;
  bgClass: string;
}

const StatCard = ({ icon: Icon, label, value, colorClass, bgClass }: StatCardProps) => (
  <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
    <div className="flex items-center gap-3 mb-3">
      <div className={`h-9 w-9 rounded-lg ${bgClass} flex items-center justify-center`}>
        <Icon className={`h-4 w-4 ${colorClass}`} />
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
    <p className="text-2xl font-semibold">{value}</p>
  </div>
);

const Dashboard = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState({
    activeEmployees: 0,
    openVacancies: 0,
    occupancyRate: '0%',
    weeklyHours: 0,
  });

  const firstName = profile?.full_name?.split(' ')[0] ?? '';

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Goedemorgen';
    if (h < 18) return 'Goedemiddag';
    return 'Goedenavond';
  };

  useEffect(() => {
    const fetchStats = async () => {
      const [empRes, vacRes, unitRes, tsRes] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'actief'),
        supabase.from('vacancies').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('v_unit_occupancy').select('capacity, current_occupancy'),
        supabase.from('timesheets').select('hours').gte('work_date', format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')).lte('work_date', format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')),
      ]);

      const totalCap = unitRes.data?.reduce((s, u) => s + (u.capacity ?? 0), 0) ?? 0;
      const totalOcc = unitRes.data?.reduce((s, u) => s + (Number(u.current_occupancy) ?? 0), 0) ?? 0;
      const occ = totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0;

      const weekHours = tsRes.data?.reduce((s, t) => s + (Number(t.hours) ?? 0), 0) ?? 0;

      setStats({
        activeEmployees: empRes.count ?? 0,
        openVacancies: vacRes.count ?? 0,
        occupancyRate: `${occ}%`,
        weeklyHours: Math.round(weekHours),
      });
    };

    fetchStats();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">{getGreeting()}, {firstName}</h1>
      <p className="text-sm text-muted-foreground mb-6">Hier is een overzicht van vandaag.</p>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={UserCheck}
          label="Actieve medewerkers"
          value={stats.activeEmployees}
          colorClass="text-stat-blue"
          bgClass="bg-stat-blue/10"
        />
        <StatCard
          icon={Briefcase}
          label="Openstaande vacatures"
          value={stats.openVacancies}
          colorClass="text-stat-orange"
          bgClass="bg-stat-orange/10"
        />
        <StatCard
          icon={Home}
          label="Bezettingsgraad"
          value={stats.occupancyRate}
          colorClass="text-stat-green"
          bgClass="bg-stat-green/10"
        />
        <StatCard
          icon={Clock}
          label="Uren deze week"
          value={stats.weeklyHours}
          colorClass="text-stat-purple"
          bgClass="bg-stat-purple/10"
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
          <h2 className="text-sm font-semibold mb-4">Aandacht vereist</h2>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mb-2 text-stat-green" />
            <p className="text-sm">Geen openstaande acties</p>
          </div>
        </div>
        <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
          <h2 className="text-sm font-semibold mb-4">Recente activiteit</h2>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <p className="text-sm">Nog geen activiteit</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
