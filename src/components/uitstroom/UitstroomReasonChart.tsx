import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/termination-constants';

interface TerminatedPlacement {
  terminated_by: string | null;
  termination_reason: string | null;
}

interface UitstroomReasonChartProps {
  data: TerminatedPlacement[];
}

const UitstroomReasonChart = ({ data }: UitstroomReasonChartProps) => {
  // Top 10 reasons
  const reasonCounts: Record<string, { reason: string; count: number; terminated_by: string }> = {};
  for (const d of data) {
    const reason = d.termination_reason || 'Onbekend';
    const key = `${reason}__${d.terminated_by}`;
    if (!reasonCounts[key]) {
      reasonCounts[key] = { reason, count: 0, terminated_by: d.terminated_by || 'onbekend' };
    }
    reasonCounts[key].count++;
  }
  const topReasons = Object.values(reasonCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Pie data
  const pieData = Object.entries(
    data.reduce((acc, d) => {
      const type = d.terminated_by || 'onbekend';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({
    name: TYPE_LABELS[name] || name,
    value,
    color: TYPE_COLORS[name] || 'hsl(210, 20%, 70%)',
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Bar chart - top reasons */}
      <div className="lg:col-span-2 bg-card border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-muted-foreground mb-3">
          Top 10 beëindigingsredenen
        </h3>
        {topReasons.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Geen data</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topReasons} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" fontSize={11} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="reason"
                width={180}
                fontSize={11}
                tickLine={false}
                tickFormatter={(v: string) => v.length > 30 ? v.slice(0, 27) + '...' : v}
              />
              <Tooltip
                formatter={(value: number) => [value, 'Aantal']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="count" name="Aantal" radius={[0, 4, 4, 0]} barSize={18}>
                {topReasons.map((entry, i) => (
                  <Cell key={i} fill={TYPE_COLORS[entry.terminated_by] || 'hsl(210, 20%, 70%)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Pie chart - distribution by terminated_by */}
      <div className="bg-card border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-muted-foreground mb-3">
          Verdeling beëindigd door
        </h3>
        {pieData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Geen data</p>
        ) : (
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={80}
                  dataKey="value"
                  strokeWidth={0}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [value, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              {pieData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span>{entry.name}: {entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UitstroomReasonChart;
