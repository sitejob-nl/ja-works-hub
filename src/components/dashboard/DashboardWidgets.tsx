import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatEUR } from '@/lib/format';
import { FileWarning, RefreshCw, Clock, Cake, FileCheck, AlertTriangle } from 'lucide-react';
import { differenceInDays, format, addDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { PieChart, Pie, Cell } from 'recharts';

// ─── Aflopende contracten ───
export const ExpiringContractsCard = () => {
  const navigate = useNavigate();
  const thirtyDays = format(addDays(new Date(), 30), 'yyyy-MM-dd');
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: employees = [] } = useQuery({
    queryKey: ['dashboard-expiring-contracts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, end_date, candidates!employees_candidate_id_fkey(first_name, last_name)')
        .not('end_date', 'is', null)
        .lte('end_date', thirtyDays)
        .gte('end_date', today)
        .neq('status', 'uit_dienst' as any)
        .order('end_date')
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-stat-orange" />
          Aflopende contracten
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen aflopende contracten</p>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {employees.map((emp: any) => {
              const days = differenceInDays(parseISO(emp.end_date), new Date());
              return (
                <button
                  key={emp.id}
                  onClick={() => navigate(`/medewerkers/${emp.id}`)}
                  className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 text-left text-sm"
                >
                  <span className="font-medium">
                    {emp.candidates?.first_name} {emp.candidates?.last_name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDate(emp.end_date)}</span>
                    <Badge variant={days <= 7 ? 'destructive' : 'secondary'} className="text-[10px]">
                      {days}d
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Contractverlengingen ───
export const ContractRenewalsCard = () => {
  const navigate = useNavigate();
  const fourteenDays = format(addDays(new Date(), 14), 'yyyy-MM-dd');
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: employees = [] } = useQuery({
    queryKey: ['dashboard-contract-renewals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, end_date, candidates!employees_candidate_id_fkey(first_name, last_name)')
        .not('end_date', 'is', null)
        .lte('end_date', fourteenDays)
        .gte('end_date', today)
        .neq('status', 'uit_dienst' as any)
        .order('end_date')
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleRenew = (empId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/medewerkers/${empId}`);
    toast.info('Open het medewerker dossier om het contract te verlengen');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          Contractverlengingen
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen verlengingen nodig</p>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {employees.map((emp: any) => (
              <div key={emp.id} className="flex items-center justify-between p-2 rounded-md text-sm">
                <span className="font-medium">
                  {emp.candidates?.first_name} {emp.candidates?.last_name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatDate(emp.end_date)}</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => handleRenew(emp.id, e)}>
                    Verleng
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Ontbrekende documenten ───
export const MissingDocumentsCard = () => {
  const navigate = useNavigate();
  const requiredTypes = ['id_bewijs', 'bankbewijs'];

  const { data: employees = [] } = useQuery({
    queryKey: ['dashboard-missing-docs'],
    queryFn: async () => {
      // Get active employees with their documents
      const { data: emps, error } = await supabase
        .from('employees')
        .select('id, candidate_id, candidates!employees_candidate_id_fkey(first_name, last_name)')
        .in('status', ['actief', 'onboarding'] as any[])
        .limit(200);
      if (error) throw error;
      if (!emps?.length) return [];

      const candidateIds = emps.map((e) => e.candidate_id);
      const { data: docs } = await supabase
        .from('documents')
        .select('candidate_id, type')
        .in('candidate_id', candidateIds)
        .in('type', requiredTypes as any[]);

      const docMap = new Map<string, Set<string>>();
      (docs ?? []).forEach((d) => {
        if (!docMap.has(d.candidate_id)) docMap.set(d.candidate_id, new Set());
        docMap.get(d.candidate_id)!.add(d.type);
      });

      return emps
        .map((emp: any) => {
          const existing = docMap.get(emp.candidate_id) ?? new Set();
          const missing = requiredTypes.filter((t) => !existing.has(t));
          return missing.length > 0 ? { ...emp, missing } : null;
        })
        .filter(Boolean)
        .slice(0, 10);
    },
  });

  const typeLabels: Record<string, string> = {
    id_bewijs: 'ID Bewijs',
    bankbewijs: 'Bankbewijs',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileWarning className="h-4 w-4 text-destructive" />
          Ontbrekende documenten
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">Alle documenten compleet</p>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {employees.map((emp: any) => (
              <button
                key={emp.id}
                onClick={() => navigate(`/medewerkers/${emp.id}`)}
                className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 text-left text-sm"
              >
                <span className="font-medium">
                  {emp.candidates?.first_name} {emp.candidates?.last_name}
                </span>
                <div className="flex gap-1 flex-wrap justify-end">
                  {emp.missing.map((t: string) => (
                    <Badge key={t} variant="destructive" className="text-[10px]">
                      {typeLabels[t] ?? t}
                    </Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Getekende vs ontbrekende documenten (Donut) ───
export const ContractStatusChart = () => {
  const { data: chartData = [] } = useQuery({
    queryKey: ['dashboard-contract-status-chart'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('status');
      if (error) throw error;
      const signed = (data ?? []).filter((c) => c.status === 'getekend').length;
      const other = (data ?? []).filter((c) => c.status !== 'getekend').length;
      return [
        { name: 'Getekend', value: signed, fill: 'hsl(var(--primary))' },
        { name: 'Concept/Verzonden', value: other, fill: 'hsl(var(--muted-foreground))' },
      ];
    },
  });

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-primary" />
          Contracten status
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Geen contracten</p>
        ) : (
          <div className="flex items-center gap-4">
            <ChartContainer config={{
              signed: { label: 'Getekend', color: 'hsl(var(--primary))' },
              other: { label: 'Concept/Verzonden', color: 'hsl(var(--muted-foreground))' },
            }} className="h-[140px] w-[140px]">
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
            <div className="space-y-2 text-sm">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: d.fill }} />
                  <span>{d.name}: <strong>{d.value}</strong></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Verjaardagen ───
export const BirthdaysCard = () => {
  const { data: birthdays = [] } = useQuery({
    queryKey: ['dashboard-birthdays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, date_of_birth')
        .not('date_of_birth', 'is', null);
      if (error) throw error;

      const today = new Date();
      const sevenDaysLater = addDays(today, 7);

      return (data ?? [])
        .map((c) => {
          const dob = parseISO(c.date_of_birth!);
          const thisYearBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
          if (thisYearBday < today) thisYearBday.setFullYear(today.getFullYear() + 1);
          const daysUntil = differenceInDays(thisYearBday, today);
          if (daysUntil > 7) return null;
          const age = today.getFullYear() - dob.getFullYear();
          return { ...c, daysUntil, age, birthdayDate: thisYearBday };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.daysUntil - b.daysUntil)
        .slice(0, 10);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cake className="h-4 w-4 text-stat-purple" />
          Verjaardagen
        </CardTitle>
      </CardHeader>
      <CardContent>
        {birthdays.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen verjaardagen komende week</p>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {birthdays.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between p-2 rounded-md text-sm">
                <span className="font-medium">{b.first_name} {b.last_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{b.age} jaar</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {b.daysUntil === 0 ? '🎂 Vandaag!' : `over ${b.daysUntil}d`}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Openstaande uren ───
export const PendingHoursCard = () => {
  const navigate = useNavigate();

  const { data: pending = [] } = useQuery({
    queryKey: ['dashboard-pending-hours'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('timesheets')
        .select('employee_id, employees!timesheets_employee_id_fkey(candidates!employees_candidate_id_fkey(first_name, last_name))')
        .in('status', ['concept', 'ingediend'] as any[]);
      if (error) throw error;

      const grouped = new Map<string, { name: string; count: number }>();
      (data ?? []).forEach((t: any) => {
        const name = `${t.employees?.candidates?.first_name ?? ''} ${t.employees?.candidates?.last_name ?? ''}`.trim();
        const existing = grouped.get(t.employee_id) ?? { name, count: 0 };
        existing.count++;
        grouped.set(t.employee_id, existing);
      });

      return Array.from(grouped.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-stat-blue" />
          Openstaande uren
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen openstaande uren</p>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {pending.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate('/uren')}
                className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 text-left text-sm"
              >
                <span className="font-medium">{p.name}</span>
                <Badge variant="secondary" className="text-[10px]">{p.count} dagen</Badge>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
