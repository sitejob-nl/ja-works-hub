import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const FIELDS = [
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefoon' },
  { key: 'date_of_birth', label: 'Geboortedatum' },
  { key: 'nationality', label: 'Nationaliteit' },
  { key: 'address_city', label: 'Woonplaats' },
] as const;

const DataQualityDashboard = () => {
  const organizationId = useOrganizationId();

  const { data, isLoading } = useQuery({
    queryKey: ['data-quality', organizationId],
    queryFn: async () => {
      const { data: candidates, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, email, phone, date_of_birth, nationality, address_city')
        .eq('organization_id', organizationId);

      if (error) throw error;
      return candidates ?? [];
    },
    enabled: !!organizationId,
  });

  if (isLoading) return <p className="text-muted-foreground">Laden...</p>;
  if (!data || data.length === 0) return <p className="text-muted-foreground">Geen data beschikbaar</p>;

  const total = data.length;

  // Per field completeness
  const fieldStats = FIELDS.map(f => {
    const filled = data.filter(c => c[f.key] != null && String(c[f.key]).trim() !== '').length;
    return {
      label: f.label,
      percentage: Math.round((filled / total) * 100),
      filled,
      missing: total - filled,
    };
  });

  // Overall completeness
  const totalFields = total * FIELDS.length;
  const totalFilled = fieldStats.reduce((s, f) => s + f.filled, 0);
  const overallPct = Math.round((totalFilled / totalFields) * 100);

  // Candidates with most missing fields (worst 20)
  const candidateMissing = data.map(c => {
    const missing = FIELDS.filter(f => c[f.key] == null || String(c[f.key]).trim() === '');
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      missingCount: missing.length,
      missingFields: missing.map(f => f.label),
    };
  })
    .filter(c => c.missingCount > 0)
    .sort((a, b) => b.missingCount - a.missingCount)
    .slice(0, 20);

  return (
    <div className="space-y-6">
      {/* Big KPI */}
      <div className="bg-card rounded-lg border p-4">
        <p className="text-3xl font-bold">{overallPct}%</p>
        <p className="text-sm text-muted-foreground">Datavolledigheid ({total} kandidaten, {FIELDS.length} velden)</p>
      </div>

      {/* Horizontal bar chart */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Volledigheid per veld</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={fieldStats} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={12} />
            <YAxis type="category" dataKey="label" width={110} fontSize={12} tickLine={false} />
            <Tooltip
              formatter={(value: number) => [`${value}%`, 'Volledig']}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="percentage" fill="hsl(142, 71%, 45%)" radius={[0, 4, 4, 0]} barSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Worst candidates table */}
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-3">Kandidaten met meeste ontbrekende velden</h3>
        {candidateMissing.length === 0 ? (
          <p className="text-sm text-muted-foreground">Alle kandidaten zijn volledig ingevuld</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kandidaat</TableHead>
                <TableHead className="text-right">Ontbrekend</TableHead>
                <TableHead>Ontbrekende velden</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidateMissing.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{c.missingCount}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.missingFields.join(', ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default DataQualityDashboard;
