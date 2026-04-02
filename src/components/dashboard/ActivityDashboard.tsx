import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const ActivityDashboard = () => {
  const organizationId = useOrganizationId();
  const now = new Date();
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd'T'23:59:59");

  const { data, isLoading } = useQuery({
    queryKey: ['activity-dashboard', organizationId, weekStart],
    queryFn: async () => {
      const [notesRes, tasksRes, profilesRes] = await Promise.all([
        supabase
          .from('notes')
          .select('id, created_by, created_at')
          .eq('organization_id', organizationId)
          .gte('created_at', weekStart)
          .lte('created_at', weekEnd),
        supabase
          .from('recruiter_tasks')
          .select('id, assigned_to, completed_at, status')
          .eq('organization_id', organizationId)
          .eq('status', 'done' as any)
          .gte('completed_at', weekStart)
          .lte('completed_at', weekEnd),
        supabase
          .from('profiles')
          .select('id, full_name')
          .eq('organization_id', organizationId),
      ]);

      if (notesRes.error) throw notesRes.error;
      if (tasksRes.error) throw tasksRes.error;
      if (profilesRes.error) throw profilesRes.error;

      return {
        notes: notesRes.data ?? [],
        tasks: tasksRes.data ?? [],
        profiles: profilesRes.data ?? [],
      };
    },
    enabled: !!organizationId,
  });

  if (isLoading) return <p className="text-muted-foreground">Laden...</p>;
  if (!data) return <p className="text-muted-foreground">Geen data beschikbaar</p>;

  const { notes, tasks, profiles } = data;
  const profileMap: Record<string, string> = {};
  for (const p of profiles) {
    profileMap[p.id] = p.full_name ?? 'Onbekend';
  }

  // Aggregate per recruiter
  const recruiterMap: Record<string, { name: string; notes: number; tasks: number }> = {};

  for (const n of notes) {
    const uid = n.created_by;
    if (!uid) continue;
    if (!recruiterMap[uid]) recruiterMap[uid] = { name: profileMap[uid] ?? 'Onbekend', notes: 0, tasks: 0 };
    recruiterMap[uid].notes += 1;
  }

  for (const t of tasks) {
    const uid = t.assigned_to;
    if (!uid) continue;
    if (!recruiterMap[uid]) recruiterMap[uid] = { name: profileMap[uid] ?? 'Onbekend', notes: 0, tasks: 0 };
    recruiterMap[uid].tasks += 1;
  }

  const recruiterData = Object.values(recruiterMap)
    .map(r => ({ ...r, total: r.notes + r.tasks }))
    .sort((a, b) => b.total - a.total);

  const totalActivities = recruiterData.reduce((s, r) => s + r.total, 0);

  const chartData = recruiterData.map(r => ({
    name: r.name.split(' ')[0],
    activiteiten: r.total,
  }));

  return (
    <div className="space-y-6">
      {/* Big KPI */}
      <div className="bg-card rounded-lg border p-4">
        <p className="text-3xl font-bold">{totalActivities}</p>
        <p className="text-sm text-muted-foreground">Activiteiten deze week ({recruiterData.length} recruiters)</p>
      </div>

      {/* Bar chart */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Activiteiten per recruiter deze week</h3>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Geen activiteiten deze week</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip
                formatter={(value: number) => [value, 'Activiteiten']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="activiteiten" fill="hsl(262, 83%, 58%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Breakdown per recruiter</h3>
        {recruiterData.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen activiteiten deze week</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recruiter</TableHead>
                <TableHead className="text-right">Notities</TableHead>
                <TableHead className="text-right">Taken afgerond</TableHead>
                <TableHead className="text-right">Totaal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recruiterData.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.notes}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.tasks}</TableCell>
                  <TableCell className="text-right font-medium">{r.total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default ActivityDashboard;
