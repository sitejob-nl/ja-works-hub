import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const CHART_COLORS = [
  'hsl(197, 100%, 60%)',
  'hsl(25, 95%, 53%)',
  'hsl(142, 71%, 45%)',
  'hsl(262, 83%, 58%)',
  'hsl(340, 75%, 55%)',
  'hsl(45, 93%, 47%)',
  'hsl(180, 60%, 45%)',
  'hsl(210, 60%, 50%)',
  'hsl(0, 0%, 60%)',
];

const SourceAnalysisDashboard = () => {
  const organizationId = useOrganizationId();

  const { data, isLoading } = useQuery({
    queryKey: ['source-analysis', organizationId],
    queryFn: async () => {
      const [candidatesRes, placementsRes] = await Promise.all([
        supabase
          .from('candidates')
          .select('id, source')
          .eq('organization_id', organizationId),
        supabase
          .from('placements')
          .select('id, candidate_id, status')
          .eq('organization_id', organizationId)
          .neq('status', 'concept' as any),
      ]);

      if (candidatesRes.error) throw candidatesRes.error;
      if (placementsRes.error) throw placementsRes.error;

      return {
        candidates: candidatesRes.data ?? [],
        placements: placementsRes.data ?? [],
      };
    },
    enabled: !!organizationId,
  });

  if (isLoading) return <p className="text-muted-foreground">Laden...</p>;
  if (!data || data.candidates.length === 0) return <p className="text-muted-foreground">Geen data beschikbaar</p>;

  const { candidates, placements } = data;

  // Group by source
  const sourceMap: Record<string, { count: number; placed: number }> = {};
  for (const c of candidates) {
    const src = c.source?.trim() || 'Onbekend';
    if (!sourceMap[src]) sourceMap[src] = { count: 0, placed: 0 };
    sourceMap[src].count += 1;
  }

  // Count placements per source
  const candidateSourceMap: Record<string, string> = {};
  for (const c of candidates) {
    candidateSourceMap[c.id] = c.source?.trim() || 'Onbekend';
  }
  for (const p of placements) {
    const src = candidateSourceMap[p.candidate_id] ?? 'Onbekend';
    if (sourceMap[src]) sourceMap[src].placed += 1;
  }

  const sourceList = Object.entries(sourceMap)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.count - a.count);

  const uniqueSources = sourceList.length;

  // Pie chart: top 8 + overig
  let pieData;
  if (sourceList.length <= 8) {
    pieData = sourceList.map(s => ({ name: s.name, value: s.count }));
  } else {
    const top8 = sourceList.slice(0, 8);
    const rest = sourceList.slice(8);
    const restTotal = rest.reduce((s, r) => s + r.count, 0);
    pieData = [
      ...top8.map(s => ({ name: s.name, value: s.count })),
      { name: 'Overig', value: restTotal },
    ];
  }

  return (
    <div className="space-y-6">
      {/* Big KPI */}
      <div className="bg-card rounded-lg border p-4">
        <p className="text-3xl font-bold">{uniqueSources}</p>
        <p className="text-sm text-muted-foreground">Unieke bronnen ({candidates.length} kandidaten)</p>
      </div>

      {/* Pie chart */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Kandidaten per bron</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              outerRadius={100}
              dataKey="value"
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              labelLine={false}
              fontSize={11}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => [value, 'Kandidaten']}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Overzicht per bron</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bron</TableHead>
              <TableHead className="text-right">Kandidaten</TableHead>
              <TableHead className="text-right">Geplaatst</TableHead>
              <TableHead className="text-right">Conversie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sourceList.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-right">{s.count}</TableCell>
                <TableCell className="text-right text-muted-foreground">{s.placed}</TableCell>
                <TableCell className="text-right">
                  {s.count > 0 ? `${Math.round((s.placed / s.count) * 100)}%` : '0%'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default SourceAnalysisDashboard;
