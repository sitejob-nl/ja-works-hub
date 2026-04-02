import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, X } from 'lucide-react';
import { formatDate } from '@/lib/format';

const statusBadge: Record<string, string> = {
  concept: 'bg-muted text-muted-foreground border-0',
  ingediend: 'bg-blue-100 text-blue-700 border-0',
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-orange-100 text-orange-600 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
  goedgekeurd: 'bg-stat-green/10 text-stat-green border-0',
  afgekeurd: 'bg-red-100 text-red-600 border-0',
};
const sourceLabel: Record<string, string> = {
  handmatig: 'Handmatig', klantportaal: 'Klantportaal', csv_import: 'CSV', kloksysteem: 'Kloksysteem',
};

const EmployeeTimesheetsTab = ({ candidateId }: { candidateId: string }) => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { data: timesheets = [] } = useQuery({
    queryKey: ['employee-timesheets', candidateId, fromDate, toDate],
    queryFn: async () => {
      let query = supabase.from('timesheets')
        .select('*, placements!timesheets_placement_id_fkey(company_id, companies!placements_company_id_fkey(name))')
        .eq('candidate_id', candidateId)
        .order('work_date', { ascending: false })
        .limit(100);
      if (fromDate) query = query.gte('work_date', fromDate);
      if (toDate) query = query.lte('work_date', toDate);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const totalHours = timesheets.reduce((s: number, t: any) => s + (Number(t.hours) || 0), 0);
  const totalOvertime = timesheets.reduce((s: number, t: any) => s + (Number(t.overtime_hours) || 0), 0);

  if (timesheets.length === 0 && !fromDate && !toDate) {
    return <p className="text-center text-muted-foreground py-8">Nog geen uren geregistreerd</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div><Label className="text-xs">Van</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">Tot</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" /></div>
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Bedrijf</TableHead>
              <TableHead className="text-right">Uren</TableHead>
              <TableHead className="text-right">Overwerk</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Bron</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timesheets.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell>{formatDate(t.work_date)}</TableCell>
                <TableCell>{t.placements?.companies?.name ?? '—'}</TableCell>
                <TableCell className="text-right">{Number(t.hours).toFixed(1)}</TableCell>
                <TableCell className="text-right">{Number(t.overtime_hours || 0).toFixed(1)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={`${statusBadge[t.status] ?? ''} gap-1`}>
                    {t.status === 'goedgekeurd' && <Check className="h-3 w-3" />}
                    {t.status === 'afgekeurd' && <X className="h-3 w-3" />}
                    {t.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{sourceLabel[t.source] ?? t.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {timesheets.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">Totaal</TableCell>
                <TableCell className="text-right font-medium">{totalHours.toFixed(1)}</TableCell>
                <TableCell className="text-right font-medium">{totalOvertime.toFixed(1)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
};

export default EmployeeTimesheetsTab;
