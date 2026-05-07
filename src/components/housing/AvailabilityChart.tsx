import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { addWeeks, startOfISOWeek, format, parseISO, formatISO } from 'date-fns';
import { nl } from 'date-fns/locale';
import type { Database } from '@/integrations/supabase/types';

type Preset = '12w' | '6m' | '1y' | 'prev_y' | 'custom';
type AssignmentStatus = Database['public']['Enums']['housing_assignment_status'];
type AssignmentSlim = { check_in_date: string | null; check_out_date: string | null; status: AssignmentStatus };

const MAX_WEEKS = 104;

const AvailabilityChart = ({ totalCapacity }: { totalCapacity: number }) => {
  const orgId = useOrganizationId();
  const [preset, setPreset] = useState<Preset>('12w');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const { start, end, weeks } = useMemo(() => {
    const today = startOfISOWeek(new Date());
    let s: Date;
    let e: Date;
    switch (preset) {
      case '6m':
        s = today;
        e = addWeeks(today, 26);
        break;
      case '1y':
        s = today;
        e = addWeeks(today, 52);
        break;
      case 'prev_y':
        s = addWeeks(today, -52);
        e = today;
        break;
      case 'custom':
        if (customStart && customEnd) {
          s = startOfISOWeek(parseISO(customStart));
          e = startOfISOWeek(parseISO(customEnd));
          if (e <= s) e = addWeeks(s, 1);
        } else {
          s = today;
          e = addWeeks(today, 12);
        }
        break;
      case '12w':
      default:
        s = today;
        e = addWeeks(today, 12);
        break;
    }
    const w = Math.min(
      MAX_WEEKS,
      Math.max(1, Math.round((e.getTime() - s.getTime()) / (7 * 24 * 60 * 60 * 1000))),
    );
    return { start: s, end: e, weeks: w };
  }, [preset, customStart, customEnd]);

  const { data: assignments = [] } = useQuery({
    queryKey: ['housing-assignments-range', orgId, formatISO(start, { representation: 'date' }), formatISO(end, { representation: 'date' })],
    queryFn: async () => {
      const startStr = formatISO(start, { representation: 'date' });
      const endStr = formatISO(end, { representation: 'date' });
      const statusFilter: AssignmentStatus[] = ['ingecheckt', 'gereserveerd'];
      const { data, error } = await supabase
        .from('housing_assignments')
        .select('check_in_date, check_out_date, status')
        .in('status', statusFilter)
        .lte('check_in_date', endStr)
        .or(`check_out_date.is.null,check_out_date.gte.${startStr}`);
      if (error) throw error;
      return (data ?? []) as AssignmentSlim[];
    },
    enabled: !!orgId,
  });

  const data = useMemo(() => {
    return Array.from({ length: weeks }, (_, i) => {
      const weekStart = addWeeks(start, i);
      const weekEnd = addWeeks(weekStart, 1);
      const occupied = assignments.filter((a) => {
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
  }, [assignments, totalCapacity, start, weeks]);

  const periodLabel = `${format(start, 'd MMM yyyy', { locale: nl })} – ${format(end, 'd MMM yyyy', { locale: nl })} (${weeks} ${weeks === 1 ? 'week' : 'weken'})`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Beschikbaarheid</CardTitle>
        <CardDescription>{periodLabel}</CardDescription>
        <div className="flex flex-wrap items-end gap-2 pt-2">
          <div className="w-full sm:w-56">
            <Label className="text-xs text-muted-foreground">Periode</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12w">Komende 12 weken</SelectItem>
                <SelectItem value="6m">Komende 6 maanden</SelectItem>
                <SelectItem value="1y">Komend jaar</SelectItem>
                <SelectItem value="prev_y">Vorig jaar</SelectItem>
                <SelectItem value="custom">Eigen periode</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === 'custom' && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Van</Label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Tot</Label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9"
                />
              </div>
            </>
          )}
        </div>
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
