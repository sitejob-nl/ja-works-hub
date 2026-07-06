import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, ReceiptText, TimerReset, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { unwrapList } from '@/lib/db';
import { formatDate, formatEUR } from '@/lib/format';
import { qk } from '@/lib/query-keys';

type PlacementTimesheetsTabProps = {
  placementId: string;
};

const statusBadge: Record<string, string> = {
  concept: 'bg-muted text-muted-foreground border-0',
  ingediend: 'bg-blue-100 text-blue-700 border-0',
  groen: 'bg-stat-green/10 text-stat-green border-0',
  oranje: 'bg-orange-100 text-orange-600 border-0',
  rood: 'bg-red-100 text-red-600 border-0',
  goedgekeurd: 'bg-stat-green/10 text-stat-green border-0',
  afgekeurd: 'bg-red-100 text-red-600 border-0',
};

const statusLabel: Record<string, string> = {
  concept: 'Concept',
  ingediend: 'Ingediend',
  groen: 'Groen',
  oranje: 'Oranje',
  rood: 'Rood',
  goedgekeurd: 'Goedgekeurd',
  afgekeurd: 'Afgekeurd',
};

const sourceLabel: Record<string, string> = {
  handmatig: 'Handmatig',
  klantportaal: 'Klantportaal',
  csv_import: 'CSV',
  kloksysteem: 'Klok',
};

function statusIcon(status: string) {
  if (status === 'goedgekeurd' || status === 'groen') return <CheckCircle2 className="h-3 w-3" />;
  if (status === 'oranje') return <AlertTriangle className="h-3 w-3" />;
  if (status === 'rood' || status === 'afgekeurd') return <XCircle className="h-3 w-3" />;
  return null;
}

export default function PlacementTimesheetsTab({ placementId }: PlacementTimesheetsTabProps) {
  const { data: timesheets = [], isLoading } = useQuery({
    queryKey: qk.placements.timesheets(placementId),
    queryFn: () => unwrapList(
      supabase
        .from('timesheets')
        .select(`
          id,
          work_date,
          hours,
          overtime_hours,
          travel_km,
          travel_amount,
          allowances_amount,
          surcharge_amount,
          status,
          source,
          client_approved,
          client_rejection_notes,
          invoice_line_id,
          invoice_lines!timesheets_invoice_line_id_fkey(
            id,
            invoice_id,
            invoices!invoice_lines_invoice_id_fkey(id, invoice_number, status)
          )
        `)
        .eq('placement_id', placementId)
        .order('work_date', { ascending: false }),
    ),
  });

  const totals = timesheets.reduce((acc: any, row: any) => {
    acc.hours += Number(row.hours ?? 0);
    acc.overtime += Number(row.overtime_hours ?? 0);
    acc.travelKm += Number(row.travel_km ?? 0);
    acc.allowances += Number(row.travel_amount ?? 0) + Number(row.allowances_amount ?? 0) + Number(row.surcharge_amount ?? 0);
    if (row.status === 'goedgekeurd') acc.approved += 1;
    if (['oranje', 'rood', 'afgekeurd'].includes(row.status)) acc.attention += 1;
    if (row.invoice_line_id) acc.invoiced += 1;
    if (row.client_approved == null && row.status !== 'concept') acc.clientPending += 1;
    return acc;
  }, { hours: 0, overtime: 0, travelKm: 0, allowances: 0, approved: 0, attention: 0, invoiced: 0, clientPending: 0 });

  if (isLoading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Uren & facturatie</h3>
          <p className="text-sm text-muted-foreground">Operationele stand per plaatsing, inclusief klantakkoord en factuurkoppeling.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to={`/uren?placement_id=${placementId}`}>
              Open in uren <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to={`/facturatie?placement_id=${placementId}`}>
              Facturatie <ReceiptText className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Uren</div><div className="text-lg font-semibold">{totals.hours.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Overwerk</div><div className="text-lg font-semibold">{totals.overtime.toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Km</div><div className="text-lg font-semibold">{totals.travelKm.toFixed(1)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Vergoedingen</div><div className="text-lg font-semibold">{formatEUR(totals.allowances)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Goedgekeurd</div><div className="text-lg font-semibold">{totals.approved}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Gefactureerd</div><div className="text-lg font-semibold">{totals.invoiced}</div></CardContent></Card>
      </div>

      {timesheets.length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center">
          <TimerReset className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">Nog geen uren op deze plaatsing</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to={`/uren?placement_id=${placementId}`}>Uren aanmaken</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Uren</TableHead>
                <TableHead className="text-right">Overwerk</TableHead>
                <TableHead>Bron</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Klant</TableHead>
                <TableHead>Factuur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheets.map((row: any) => {
                const invoiceLine = Array.isArray(row.invoice_lines) ? row.invoice_lines[0] : row.invoice_lines;
                const invoice = Array.isArray(invoiceLine?.invoices) ? invoiceLine.invoices[0] : invoiceLine?.invoices;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{formatDate(row.work_date)}</TableCell>
                    <TableCell className="text-right">{Number(row.hours ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{Number(row.overtime_hours ?? 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{sourceLabel[row.source] ?? row.source}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`${statusBadge[row.status] ?? ''} gap-1`}>
                        {statusIcon(row.status)}
                        {statusLabel[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.client_approved === true ? (
                        <Badge variant="secondary" className="bg-stat-green/10 text-stat-green border-0">Akkoord</Badge>
                      ) : row.client_approved === false ? (
                        <Badge variant="secondary" className="bg-red-100 text-red-600 border-0" title={row.client_rejection_notes ?? undefined}>Afgekeurd</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {invoice ? (
                        <Link to={`/facturatie/${invoice.id}`} className="inline-flex items-center gap-1 text-sm hover:underline">
                          <FileText className="h-3.5 w-3.5" />
                          {invoice.invoice_number ?? 'Factuur'}
                        </Link>
                      ) : row.invoice_line_id ? (
                        <Badge variant="outline">Factuurregel</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Niet gefactureerd</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
