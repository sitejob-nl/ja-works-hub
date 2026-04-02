import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { nl } from 'date-fns/locale';
import { TYPE_COLORS } from '@/lib/termination-constants';

interface TerminatedPlacement {
  terminated_by: string | null;
  terminated_at: string | null;
}

interface UitstroomTrendChartProps {
  data: TerminatedPlacement[];
}

const UitstroomTrendChart = ({ data }: UitstroomTrendChartProps) => {
  // Group by month
  const monthMap: Record<string, { month: string; opdrachtgever: number; medewerker: number; uitzendbureau: number }> = {};

  for (const d of data) {
    if (!d.terminated_at) continue;
    const monthKey = d.terminated_at.slice(0, 7); // YYYY-MM
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = { month: monthKey, opdrachtgever: 0, medewerker: 0, uitzendbureau: 0 };
    }
    const type = d.terminated_by as 'opdrachtgever' | 'medewerker' | 'uitzendbureau';
    if (type && monthMap[monthKey][type] !== undefined) {
      monthMap[monthKey][type]++;
    }
  }

  const chartData = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(d => ({
      ...d,
      label: format(parseISO(d.month + '-01'), 'MMM yyyy', { locale: nl }),
    }));

  return (
    <div className="bg-card border rounded-lg p-4">
      <h3 className="text-xs font-semibold text-muted-foreground mb-3">
        Beëindigingen per maand
      </h3>
      {chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Geen data</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
            <XAxis dataKey="label" fontSize={11} tickLine={false} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  opdrachtgever: 'Opdrachtgever',
                  medewerker: 'Medewerker',
                  uitzendbureau: 'Uitzendbureau',
                };
                return labels[value] || value;
              }}
            />
            <Line
              type="monotone"
              dataKey="opdrachtgever"
              stroke={TYPE_COLORS.opdrachtgever}
              strokeWidth={2}
              dot={{ r: 3 }}
              name="opdrachtgever"
            />
            <Line
              type="monotone"
              dataKey="medewerker"
              stroke={TYPE_COLORS.medewerker}
              strokeWidth={2}
              dot={{ r: 3 }}
              name="medewerker"
            />
            <Line
              type="monotone"
              dataKey="uitzendbureau"
              stroke={TYPE_COLORS.uitzendbureau}
              strokeWidth={2}
              dot={{ r: 3 }}
              name="uitzendbureau"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default UitstroomTrendChart;
