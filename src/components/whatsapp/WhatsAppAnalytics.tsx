// src/components/whatsapp/WhatsAppAnalytics.tsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { format, subDays, parseISO, startOfDay } from 'date-fns';
import { nl } from 'date-fns/locale';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  MessageSquare,
  Send,
  Inbox,
  AlertCircle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

// ─── types ───────────────────────────────────────────────────────────────────

type DateRange = 7 | 30 | 90 | null; // null = alles

interface KpiCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  iconClass?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function rangeStart(range: DateRange): string | null {
  if (range === null) return null;
  return subDays(new Date(), range).toISOString();
}

function dayKey(isoString: string): string {
  return format(parseISO(isoString), 'yyyy-MM-dd');
}

// ─── sub-components ──────────────────────────────────────────────────────────

function KpiCard({ title, value, icon, iconClass }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-2 rounded-lg bg-muted ${iconClass ?? ''}`}>{icon}</div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value.toLocaleString('nl-NL')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  return direction === 'outbound' ? (
    <Badge variant="secondary" className="gap-1">
      <TrendingUp className="h-3 w-3" />
      Uit
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1">
      <TrendingDown className="h-3 w-3" />
      In
    </Badge>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">–</Badge>;
  const map: Record<string, string> = {
    sent: 'Verstuurd',
    delivered: 'Afgeleverd',
    read: 'Gelezen',
    failed: 'Mislukt',
  };
  const variantMap: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
    sent: 'secondary',
    delivered: 'default',
    read: 'default',
    failed: 'destructive',
  };
  return (
    <Badge variant={variantMap[status] ?? 'outline'}>
      {map[status] ?? status}
    </Badge>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export function WhatsAppAnalytics() {
  const orgId = useOrganizationId();
  const [range, setRange] = useState<DateRange>(30);

  const from = rangeStart(range);

  // ── raw messages query ─────────────────────────────────────────────────────
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['whatsapp-analytics', orgId, range],
    queryFn: async () => {
      let q = supabase
        .from('communications')
        .select('id, direction, subject, body, whatsapp_status, message_type, sent_at')
        .eq('organization_id', orgId)
        .eq('channel', 'whatsapp')
        .order('sent_at', { ascending: false });

      if (from) q = q.gte('sent_at', from);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const phones = new Set<string>();
    let sent = 0;
    let received = 0;
    let failed = 0;

    for (const m of messages) {
      // phone is stored in subject for whatsapp (per existing pattern in ConversationItem)
      if (m.subject) phones.add(m.subject);
      if (m.direction === 'outbound') sent++;
      if (m.direction === 'inbound') received++;
      if (m.whatsapp_status === 'failed') failed++;
    }

    return { conversations: phones.size, sent, received, failed };
  }, [messages]);

  // ── chart data: messages per day ──────────────────────────────────────────
  const chartData = useMemo(() => {
    const byDay: Record<string, { date: string; verstuurd: number; ontvangen: number }> = {};

    for (const m of messages) {
      const key = dayKey(m.sent_at);
      if (!byDay[key]) byDay[key] = { date: key, verstuurd: 0, ontvangen: 0 };
      if (m.direction === 'outbound') byDay[key].verstuurd++;
      else byDay[key].ontvangen++;
    }

    return Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        label: format(parseISO(d.date), 'd MMM', { locale: nl }),
      }));
  }, [messages]);

  // ── recent activity (last 20) ─────────────────────────────────────────────
  const recentMessages = useMemo(() => messages.slice(0, 20), [messages]);

  // ── template performance ──────────────────────────────────────────────────
  const templateStats = useMemo(() => {
    const templates = messages.filter(
      (m) => m.message_type === 'template' && m.body,
    );

    const map: Record<
      string,
      { name: string; sent: number; delivered: number; read: number }
    > = {};

    for (const m of templates) {
      // Body may contain "[Template: name]" marker
      const match = m.body?.match(/\[Template:\s*([^\]]+)\]/);
      const name = match ? match[1].trim() : (m.subject ?? 'Onbekend template');

      if (!map[name]) map[name] = { name, sent: 0, delivered: 0, read: 0 };
      map[name].sent++;
      if (m.whatsapp_status === 'delivered') map[name].delivered++;
      if (m.whatsapp_status === 'read') map[name].read++;
    }

    return Object.values(map).sort((a, b) => b.sent - a.sent);
  }, [messages]);

  // ─────────────────────────────────────────────────────────────────────────

  const rangeButtons: { label: string; value: DateRange }[] = [
    { label: '7 dagen', value: 7 },
    { label: '30 dagen', value: 30 },
    { label: '90 dagen', value: 90 },
    { label: 'Alles', value: null },
  ];

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="flex gap-2 flex-wrap">
        {rangeButtons.map((btn) => (
          <Button
            key={String(btn.value)}
            variant={range === btn.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRange(btn.value)}
          >
            {btn.label}
          </Button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Totaal gesprekken"
          value={kpis.conversations}
          icon={<MessageSquare className="h-5 w-5 text-stat-blue" />}
        />
        <KpiCard
          title="Verstuurd"
          value={kpis.sent}
          icon={<Send className="h-5 w-5 text-blue-500" />}
        />
        <KpiCard
          title="Ontvangen"
          value={kpis.received}
          icon={<Inbox className="h-5 w-5 text-green-500" />}
        />
        <KpiCard
          title="Mislukt"
          value={kpis.failed}
          icon={<AlertCircle className="h-5 w-5 text-destructive" />}
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Berichten per dag</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              Laden…
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              Geen berichten in deze periode
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVerstuurd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorOntvangen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--card))',
                    color: 'hsl(var(--card-foreground))',
                  }}
                  formatter={(value: number, name: string) => [
                    value,
                    name === 'verstuurd' ? 'Verstuurd' : 'Ontvangen',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="verstuurd"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#colorVerstuurd)"
                />
                <Area
                  type="monotone"
                  dataKey="ontvangen"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={2}
                  fill="url(#colorOntvangen)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recente activiteit</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              Laden…
            </div>
          ) : recentMessages.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              Geen berichten gevonden
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Richting</TableHead>
                  <TableHead>Telefoon</TableHead>
                  <TableHead className="hidden md:table-cell">Bericht</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-36 hidden sm:table-cell">Datum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMessages.map((msg) => (
                  <TableRow key={msg.id}>
                    <TableCell>
                      <DirectionBadge direction={msg.direction} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {msg.subject ?? '–'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-xs truncate">
                      {msg.body ? msg.body.slice(0, 80) + (msg.body.length > 80 ? '…' : '') : '–'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={msg.whatsapp_status} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {format(parseISO(msg.sent_at), 'd MMM yyyy HH:mm', { locale: nl })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Template performance */}
      {templateStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Template prestaties</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template naam</TableHead>
                  <TableHead className="w-28 text-right">Verstuurd</TableHead>
                  <TableHead className="w-32 text-right">Afgeleverd %</TableHead>
                  <TableHead className="w-28 text-right">Gelezen %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templateStats.map((t) => {
                  const deliveredPct =
                    t.sent > 0 ? Math.round((t.delivered / t.sent) * 100) : 0;
                  const readPct =
                    t.sent > 0 ? Math.round((t.read / t.sent) * 100) : 0;
                  return (
                    <TableRow key={t.name}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">{t.sent}</TableCell>
                      <TableCell className="text-right">{deliveredPct}%</TableCell>
                      <TableCell className="text-right">{readPct}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default WhatsAppAnalytics;
