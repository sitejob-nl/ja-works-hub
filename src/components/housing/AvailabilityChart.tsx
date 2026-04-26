import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { addWeeks, startOfISOWeek, format, parseISO } from 'date-fns';
import { nl } from 'date-fns/locale';

const WEEKS_AHEAD = 12;

const AvailabilityChart = ({ totalCapacity }: { totalCapacity: number }) => {
  const orgId = useOrganizationId();

  const { data: assignments = [] } = useQuery({
    queryKey: ['housing-assignments-future', orgId],
    queryFn: async () => {
      const horizon = addWeeks(new Date(), WEEKS_AHEAD).toISOString();
      const { data, error } = await supabase
        .from('housing_assignments')
        .select('check_in_date, check_out_date, status')
        .in('status', ['ingecheckt', 'gereserveerd'] as any)
        .lte('check_in_date', horizon);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const data = useMemo(() => {
    const today = new Date();
    return Array.from({ length: WEEKS_AHEAD }, (_, i) => {
      const weekStart = startOfISOWeek(addWeeks(today, i));
      const weekEnd = addWeeks(weekStart, 1);
      const occupied = assignments.filter((a: any) => {
        const inDate = a.check_in_date ? parseISO(a.check_in_date) : null;
        const outDate = a.check_out_date ? parseISO(a.check_out_date) : null;
        if (!inDate) return false;
        if (inDate >= weekEnd) return false;
        if (outDate && outDate <= weekStart) return false;
        return true;
      }).length;
      return {
        week: format(weekStart, "'wk' I", { locale: nl }),
        beschikbaar: Math.max(0, totalCapacity - occupied),
        bezet: occupied,
      };
    });
  }, [assignments, totalCapacity]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Beschikbaarheid komende {WEEKS_AHEAD} weken</CardTitle>
        <CardDescription>Vrije plekken op basis van huidige toewijzingen + check-out data</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Line type="monotone" dataKey="beschikbaar" stroke="hsl(var(--stat-green))" strokeWidth={2} dot={{ r: 3 }} name="Vrije plekken" />
            <Line type="monotone" dataKey="bezet" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Bezet" />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default AvailabilityChart;
