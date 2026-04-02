import { TrendingUp, TrendingDown, Minus, Users, Building2, UserCheck, Briefcase, Clock } from 'lucide-react';

interface TerminatedPlacement {
  id: string;
  terminated_by: string | null;
  termination_reason: string | null;
  terminated_at: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface UitstroomKpiCardsProps {
  data: TerminatedPlacement[];
  previousData: TerminatedPlacement[];
}

const UitstroomKpiCards = ({ data, previousData }: UitstroomKpiCardsProps) => {
  const total = data.length;
  const prevTotal = previousData.length;

  const byType = (type: string) => data.filter(d => d.terminated_by === type).length;
  const prevByType = (type: string) => previousData.filter(d => d.terminated_by === type).length;

  const opdrachtgever = byType('opdrachtgever');
  const medewerker = byType('medewerker');
  const uitzendbureau = byType('uitzendbureau');

  const pct = (count: number) => total > 0 ? Math.round((count / total) * 100) : 0;

  // Average duration in days (use terminated_at as actual end, not planned end_date)
  const durations = data
    .filter(d => d.start_date && d.terminated_at)
    .map(d => {
      const start = new Date(d.start_date!);
      const end = new Date(d.terminated_at!);
      return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    })
    .filter(d => d >= 0);
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  const prevDurations = previousData
    .filter(d => d.start_date && d.terminated_at)
    .map(d => {
      const start = new Date(d.start_date!);
      const end = new Date(d.terminated_at!);
      return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    })
    .filter(d => d >= 0);
  const prevAvgDuration = prevDurations.length > 0 ? Math.round(prevDurations.reduce((a, b) => a + b, 0) / prevDurations.length) : 0;

  const TrendArrow = ({ current, previous, invertColors = false }: { current: number; previous: number; invertColors?: boolean }) => {
    const upColor = invertColors ? 'text-stat-green' : 'text-destructive';
    const downColor = invertColors ? 'text-destructive' : 'text-stat-green';
    if (current > previous) return <TrendingUp className={`h-3.5 w-3.5 ${upColor}`} />;
    if (current < previous) return <TrendingDown className={`h-3.5 w-3.5 ${downColor}`} />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const cards = [
    {
      icon: Users,
      label: 'Totaal beëindigd',
      value: total,
      sub: `Vorige periode: ${prevTotal}`,
      color: 'text-destructive',
      bg: 'bg-destructive/10',
      current: total,
      previous: prevTotal,
    },
    {
      icon: Building2,
      label: 'Door opdrachtgever',
      value: `${opdrachtgever} (${pct(opdrachtgever)}%)`,
      sub: `Vorige periode: ${prevByType('opdrachtgever')}`,
      color: 'text-stat-orange',
      bg: 'bg-stat-orange/10',
      current: opdrachtgever,
      previous: prevByType('opdrachtgever'),
    },
    {
      icon: UserCheck,
      label: 'Door medewerker',
      value: `${medewerker} (${pct(medewerker)}%)`,
      sub: `Vorige periode: ${prevByType('medewerker')}`,
      color: 'text-stat-blue',
      bg: 'bg-stat-blue/10',
      current: medewerker,
      previous: prevByType('medewerker'),
    },
    {
      icon: Briefcase,
      label: 'Door uitzendbureau',
      value: `${uitzendbureau} (${pct(uitzendbureau)}%)`,
      sub: `Vorige periode: ${prevByType('uitzendbureau')}`,
      color: 'text-stat-purple',
      bg: 'bg-stat-purple/10',
      current: uitzendbureau,
      previous: prevByType('uitzendbureau'),
    },
    {
      icon: Clock,
      label: 'Gem. duur (dagen)',
      value: avgDuration,
      sub: `Vorige periode: ${prevAvgDuration} dagen`,
      color: 'text-stat-green',
      bg: 'bg-stat-green/10',
      current: avgDuration,
      previous: prevAvgDuration,
      invertColors: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-card border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`h-7 w-7 rounded-md ${c.bg} flex items-center justify-center`}>
              <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
            </div>
            <TrendArrow current={c.current} previous={c.previous} invertColors={c.invertColors} />
          </div>
          <p className="text-lg font-semibold">{c.value}</p>
          <p className="text-[11px] text-muted-foreground">{c.label}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{c.sub}</p>
        </div>
      ))}
    </div>
  );
};

export default UitstroomKpiCards;
