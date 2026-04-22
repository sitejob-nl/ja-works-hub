import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { format, subMonths, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';
import { nl } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const TimeToHireDashboard = () => {
  const organizationId = useOrganizationId();

  const { data, isLoading } = useQuery({
    queryKey: ['time-to-hire', organizationId],
    queryFn: async () => {
      const { data: placements, error } = await supabase
        .from('placements')
        .select('id, start_date, created_at, vacancy_id, company_id, status, vacancies!placements_vacancy_id_fkey(created_at, title), companies!placements_company_id_fkey(name)')
        .not('start_date', 'is', null)
        .eq('organization_id', organizationId);

      if (error) throw error;
      return placements ?? [];
    },
    enabled: !!organizationId,
  });

  if (isLoading) return <p className="text-muted-foreground">Laden...</p>;
  if (!data || data.length === 0) return <p className="text-muted-foreground">Geen data beschikbaar</p>;

  // Calculate time-to-hire per placement
  const placements = data.map((p: any) => {
    const vacancyCreated = p.vacancies?.created_at;
    const startDate = p.start_date;
    if (!vacancyCreated || !startDate) return null;
    const days = differenceInDays(new Date(startDate), new Date(vacancyCreated));
    return {
      ...p,
      daysToHire: Math.max(0, days),
      companyName: p.companies?.name ?? 'Onbekend',
    };
  }).filter(Boolean);

  // Average time-to-hire
  const avgDays = placements.length > 0
    ? Math.round(placements.reduce((s, p) => s + p.daysToHire, 0) / placements.length)
    : 0;

  // Per month (last 6 months)
  const now = new Date();
  const monthlyData = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = subMonths(now, i);
    const mStart = startOfMonth(monthDate);
    const mEnd = endOfMonth(monthDate);
    const monthPlacements = placements.filter(p => {
      const d = new Date(p.start_date);
      return d >= mStart && d <= mEnd;
    });
    const avg = monthPlacements.length > 0
      ? Math.round(monthPlacements.reduce((s, p) => s + p.daysToHire, 0) / monthPlacements.length)
      : 0;
    monthlyData.push({
      month: format(monthDate, 'MMM yyyy', { locale: nl }),
      dagen: avg,
      count: monthPlacements.length,
    });
  }

  // Per company (top 10)
  const companyMap: Record<string, { name: string; total: number; count: number }> = {};
  for (const p of placements) {
    const key = p.company_id ?? 'unknown';
    if (!companyMap[key]) companyMap[key] = { name: p.companyName, total: 0, count: 0 };
    companyMap[key].total += p.daysToHire;
    companyMap[key].count += 1;
  }
  const companyData = Object.values(companyMap)
    .map(c => ({ ...c, avg: Math.round(c.total / c.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Big KPI */}
      <div className="bg-card rounded-lg border p-4">
        <p className="text-3xl font-bold">{avgDays} dagen</p>
        <p className="text-sm text-muted-foreground">Gemiddelde time-to-hire ({placements.length} plaatsingen)</p>
      </div>

      {/* Monthly bar chart */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Gemiddelde time-to-hire per maand</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthlyData}>
            <XAxis dataKey="month" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip
              formatter={(value: number) => [`${value} dagen`, 'Gem. dagen']}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="dagen" fill="hsl(197, 100%, 60%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per company table */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Time-to-hire per opdrachtgever (top 10)</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opdrachtgever</TableHead>
              <TableHead className="text-right">Plaatsingen</TableHead>
              <TableHead className="text-right">Gem. dagen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companyData.map((c, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-right text-muted-foreground">{c.count}</TableCell>
                <TableCell className="text-right">{c.avg}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default TimeToHireDashboard;
