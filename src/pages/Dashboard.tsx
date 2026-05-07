import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import {
  UserCheck, Briefcase, Home, Clock, CheckCircle2,
  FileWarning, UserX, AlertTriangle, Plus, Pencil, Trash2, RefreshCw,
} from 'lucide-react';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { toast } from 'sonner';
import KpiDashboard from '@/components/dashboard/KpiDashboard';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';
import {
  ExpiringContractsCard,
  ContractRenewalsCard,
  MissingDocumentsCard,
  ContractStatusChart,
  BirthdaysCard,
  PendingHoursCard,
} from '@/components/dashboard/DashboardWidgets';
import { ApkExpiryWidget } from '@/components/dashboard/ApkExpiryWidget';

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  colorClass: string;
  bgClass: string;
}

const StatCard = ({ icon: Icon, label, value, colorClass, bgClass }: StatCardProps) => (
  <div className="bg-card rounded-lg p-3 sm:p-5 shadow-sm border border-border">
    <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
      <div className={`h-8 w-8 sm:h-9 sm:w-9 rounded-lg ${bgClass} flex items-center justify-center`}>
        <Icon className={`h-4 w-4 ${colorClass}`} />
      </div>
      <span className="text-xs sm:text-sm text-muted-foreground leading-tight">{label}</span>
    </div>
    <p className="text-xl sm:text-2xl font-semibold">{value}</p>
  </div>
);

// ─── Alert types ───
interface AlertItem {
  id: string;
  severity: 'red' | 'orange';
  icon: React.ElementType;
  description: string;
  category: string;
  link: string;
}

const TABLE_LABELS: Record<string, string> = {
  companies: 'opdrachtgever', candidates: 'kandidaat', employees: 'medewerker',
  properties: 'pand', units: 'kamer', vacancies: 'vacature', matches: 'match',
  placements: 'plaatsing', timesheets: 'urenregistratie', vehicles: 'voertuig',
  housing_assignments: 'huisvesting', communications: 'communicatie',
  knowledge_base: 'artikel', sick_reports: 'ziekmelding', documents: 'document',
};
const ACTION_LABELS: Record<string, string> = {
  create: 'aangemaakt', update: 'bijgewerkt', delete: 'verwijderd',
  status_change: 'status gewijzigd', export: 'geëxporteerd', override: 'override uitgevoerd',
};
const ACTION_ICONS: Record<string, React.ElementType> = {
  create: Plus, update: Pencil, delete: Trash2, status_change: RefreshCw,
  export: RefreshCw, override: AlertTriangle,
};

const Dashboard = () => {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stats, setStats] = useState({
    activeEmployees: 0,
    openVacancies: 0,
    occupancyRate: '0%',
    weeklyHours: 0,
  });

  // Onboarding wizard state
  const storageKey = user ? `sitejob_onboarded_${user.id}` : null;
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (storageKey && !localStorage.getItem(storageKey)) {
      setShowOnboarding(true);
    }
  }, [storageKey]);

  const handleOnboardingComplete = () => {
    if (storageKey) localStorage.setItem(storageKey, '1');
    setShowOnboarding(false);
  };

  const firstName = profile?.full_name?.split(' ')[0] ?? '';

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Goedemorgen';
    if (h < 18) return 'Goedemiddag';
    return 'Goedenavond';
  };

  // Generate notifications on dashboard load (lazy)
  useEffect(() => {
    const generateNotifications = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-notifications`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch { /* non-blocking */ }
    };
    generateNotifications();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      const [empRes, vacRes, unitRes, tsRes] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'actief'),
        supabase.from('vacancies').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('v_unit_occupancy').select('capacity, current_occupancy'),
        supabase.from('timesheets').select('hours').gte('work_date', format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')).lte('work_date', format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')),
      ]);

      const totalCap = unitRes.data?.reduce((s, u) => s + (u.capacity ?? 0), 0) ?? 0;
      const totalOcc = unitRes.data?.reduce((s, u) => s + Number(u.current_occupancy ?? 0), 0) ?? 0;
      const occ = totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0;
      const weekHours = tsRes.data?.reduce((s, t) => s + Number(t.hours ?? 0), 0) ?? 0;

      setStats({
        activeEmployees: empRes.count ?? 0,
        openVacancies: vacRes.count ?? 0,
        occupancyRate: `${occ}%`,
        weeklyHours: Math.round(weekHours),
      });
    };
    fetchStats();
  }, []);

  // ─── Signaleringen queries ───
  const { data: expiringDocs = [] } = useQuery({
    queryKey: ['alerts-expiring-docs'],
    queryFn: async () => {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const { data, error } = await supabase
        .from('documents')
        .select(`id, name, type, status, expiry_date, candidates!documents_candidate_id_fkey(id, first_name, last_name)`)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
        .in('status', ['geldig', 'verloopt_binnenkort', 'verlopen'] as any[])
        .order('expiry_date')
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: incompleteOnboarding = [] } = useQuery({
    queryKey: ['alerts-incomplete-onboarding'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select(`id, candidates!employees_candidate_id_fkey(first_name, last_name), onboarding_completed, start_date`)
        .eq('status', 'onboarding' as any)
        .eq('onboarding_completed', false)
        .order('start_date')
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: overdueRent = [] } = useQuery({
    queryKey: ['alerts-overdue-rent'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('housing_assignments')
        .select(`
          id, rent_paid_until,
          employees!housing_assignments_employee_id_fkey(
            id,
            candidates!employees_candidate_id_fkey(first_name, last_name)
          ),
          units!housing_assignments_unit_id_fkey(
            name,
            properties!units_property_id_fkey(id, name)
          )
        `)
        .eq('status', 'ingecheckt' as any)
        .not('rent_paid_until', 'is', null)
        .lt('rent_paid_until', today)
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: unpaidDeposits = [] } = useQuery({
    queryKey: ['alerts-unpaid-deposits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('housing_assignments')
        .select(`
          id,
          employees!housing_assignments_employee_id_fkey(
            id,
            candidates!employees_candidate_id_fkey(first_name, last_name)
          ),
          units!housing_assignments_unit_id_fkey(
            name,
            properties!units_property_id_fkey(id, name)
          )
        `)
        .eq('status', 'ingecheckt' as any)
        .eq('deposit_paid', false)
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: attentionTimesheets = [] } = useQuery({
    queryKey: ['alerts-attention-timesheets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('timesheets')
        .select(`
          id, work_date, hours, status,
          employees!timesheets_employee_id_fkey(
            candidates!employees_candidate_id_fkey(first_name, last_name)
          )
        `)
        .in('status', ['oranje', 'rood'] as any[])
        .order('work_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  // ─── Recent activity ───
  const { data: recentActivity = [] } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select(`id, action, table_name, record_id, created_at, profiles!audit_log_user_id_fkey(full_name)`)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  // ─── Check expiry mutation ───
  const checkExpiry = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-document-expiry`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Controle mislukt');
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['alerts-expiring-docs'] });
      toast.success(`Controle voltooid: ${data.expired} verlopen, ${data.expiring} bijna verlopen`);
    },
    onError: () => toast.error('Verloopdata controle mislukt'),
  });

  // ─── Build alert list ───
  const alerts: AlertItem[] = [];

  for (const doc of expiringDocs) {
    const cand = doc.candidates as any;
    const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date();
    alerts.push({
      id: `doc-${doc.id}`,
      severity: isExpired ? 'red' : 'orange',
      icon: FileWarning,
      description: `${doc.name} van ${cand?.first_name} ${cand?.last_name} ${isExpired ? 'is verlopen op' : 'verloopt op'} ${formatDate(doc.expiry_date)}`,
      category: 'Document',
      link: `/kandidaten/${cand?.id}`,
    });
  }

  for (const emp of incompleteOnboarding) {
    const cand = (emp as any).candidates;
    alerts.push({
      id: `onb-${emp.id}`,
      severity: 'orange',
      icon: UserX,
      description: `${cand?.first_name} ${cand?.last_name} — onboarding niet afgerond (gestart ${formatDate(emp.start_date)})`,
      category: 'Onboarding',
      link: `/medewerkers/${emp.id}`,
    });
  }

  for (const ha of overdueRent) {
    const emp = (ha as any).employees;
    const cand = emp?.candidates;
    const unit = (ha as any).units;
    const prop = unit?.properties;
    alerts.push({
      id: `rent-${ha.id}`,
      severity: 'red',
      icon: Home,
      description: `${cand?.first_name} ${cand?.last_name} — huur achterstallig voor ${unit?.name ?? '?'} in ${prop?.name ?? '?'} (betaald tot ${formatDate(ha.rent_paid_until)})`,
      category: 'Huisvesting',
      link: `/huisvesting/${prop?.id}`,
    });
  }

  for (const ha of unpaidDeposits) {
    const emp = (ha as any).employees;
    const cand = emp?.candidates;
    const unit = (ha as any).units;
    const prop = unit?.properties;
    alerts.push({
      id: `dep-${ha.id}`,
      severity: 'orange',
      icon: Home,
      description: `${cand?.first_name} ${cand?.last_name} — borg niet betaald voor ${unit?.name ?? '?'} in ${prop?.name ?? '?'}`,
      category: 'Huisvesting',
      link: `/huisvesting/${prop?.id}`,
    });
  }

  for (const ts of attentionTimesheets) {
    const emp = (ts as any).employees;
    const cand = emp?.candidates;
    alerts.push({
      id: `ts-${ts.id}`,
      severity: ts.status === 'rood' ? 'red' : 'orange',
      icon: AlertTriangle,
      description: `${cand?.first_name} ${cand?.last_name} — ${Number(ts.hours).toFixed(1)}u op ${formatDate(ts.work_date)} vereist controle (${ts.status})`,
      category: 'Uren',
      link: '/uren',
    });
  }

  // Sort: red first, then orange
  alerts.sort((a, b) => (a.severity === 'red' && b.severity !== 'red' ? -1 : a.severity !== 'red' && b.severity === 'red' ? 1 : 0));
  const visibleAlerts = alerts.slice(0, 15);

  return (
    <div className="space-y-4 sm:space-y-6">
      <OnboardingWizard open={showOnboarding} onComplete={handleOnboardingComplete} userName={firstName} />
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold mb-1">{getGreeting()}, {firstName}</h1>
        <p className="text-sm text-muted-foreground">Hier is een overzicht van vandaag.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={UserCheck} label="Actieve medewerkers" value={stats.activeEmployees} colorClass="text-stat-blue" bgClass="bg-stat-blue/10" />
        <StatCard icon={Briefcase} label="Open vacatures" value={stats.openVacancies} colorClass="text-stat-orange" bgClass="bg-stat-orange/10" />
        <StatCard icon={Home} label="Bezetting" value={stats.occupancyRate} colorClass="text-stat-green" bgClass="bg-stat-green/10" />
        <StatCard icon={Clock} label="Uren deze week" value={stats.weeklyHours} colorClass="text-stat-purple" bgClass="bg-stat-purple/10" />
      </div>

      {/* KPI Dashboard for management */}
      {profile?.role === 'admin' && (
        <KpiDashboard />
      )}

      {/* Management widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ExpiringContractsCard />
        <ContractRenewalsCard />
        <MissingDocumentsCard />
        <ContractStatusChart />
        <BirthdaysCard />
        <PendingHoursCard />
        <ApkExpiryWidget />
      </div>

      {/* Divider */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Aandacht vereist */}
        <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Aandacht vereist</h2>
              {alerts.length > 0 && (
                <Badge variant="destructive" className="text-xs">{alerts.length}</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => checkExpiry.mutate()}
              disabled={checkExpiry.isPending}
              className="text-xs gap-1"
            >
              <RefreshCw className={`h-3 w-3 ${checkExpiry.isPending ? 'animate-spin' : ''}`} />
              Verloopdata controleren
            </Button>
          </div>

          {visibleAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2 text-stat-green" />
              <p className="text-sm">Geen openstaande acties</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {visibleAlerts.map((alert) => {
                const IconComp = alert.icon;
                const isRed = alert.severity === 'red';
                return (
                  <button
                    key={alert.id}
                    onClick={() => navigate(alert.link)}
                    className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${isRed ? 'bg-destructive/10' : 'bg-orange-100'}`}>
                      <IconComp className={`h-4 w-4 ${isRed ? 'text-destructive' : 'text-orange-600'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-tight">{alert.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{alert.category}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Recente activiteit */}
        <div className="bg-card rounded-lg p-5 shadow-sm border border-border">
          <h2 className="text-sm font-semibold mb-4">Recente activiteit</h2>
          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <p className="text-sm">Nog geen activiteit</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {recentActivity.map((entry: any) => {
                const ActionIcon = ACTION_ICONS[entry.action] ?? RefreshCw;
                const tableName = TABLE_LABELS[entry.table_name] ?? entry.table_name;
                const actionLabel = ACTION_LABELS[entry.action] ?? entry.action;
                const userName = entry.profiles?.full_name ?? 'Systeem';

                return (
                  <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <ActionIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-tight">
                        <span className="font-medium">{userName}</span> heeft een {tableName} {actionLabel}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(entry.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
