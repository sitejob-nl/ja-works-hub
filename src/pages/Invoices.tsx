import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, FileText, Search, Eye, Send, CheckCircle2, Clock, Euro } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';

const statusBadge: Record<string, { class: string; label: string }> = {
  concept: { class: 'bg-muted text-muted-foreground border-0', label: 'Concept' },
  definitief: { class: 'bg-blue-100 text-blue-700 border-0', label: 'Definitief' },
  verzonden: { class: 'bg-orange-100 text-orange-700 border-0', label: 'Verzonden' },
  betaald: { class: 'bg-stat-green/10 text-stat-green border-0', label: 'Betaald' },
  gecrediteerd: { class: 'bg-red-100 text-red-700 border-0', label: 'Gecrediteerd' },
};

export default function InvoicesPage() {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  // Fetch invoices
  const { data: invoices, isLoading } = useQuery({
    queryKey: ['invoices', orgId, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('invoices')
        .select('*, companies(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  // Fetch invoice lines when selected
  const { data: invoiceLines } = useQuery({
    queryKey: ['invoice-lines', selectedInvoice?.id],
    queryFn: async () => {
      if (!selectedInvoice) return [];
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('*, placements(function_name, employees(id, candidates(first_name, last_name)))')
        .eq('invoice_id', selectedInvoice.id)
        .order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedInvoice,
  });

  const filtered = (invoices ?? []).filter((inv: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return inv.invoice_number?.toLowerCase().includes(s) ||
      inv.companies?.name?.toLowerCase().includes(s) ||
      inv.reference?.toLowerCase().includes(s);
  });

  const totals = (invoices ?? []).reduce((acc: any, inv: any) => {
    acc.count++;
    acc.total += Number(inv.total) || 0;
    acc.open += (inv.status === 'verzonden') ? Number(inv.total) - Number(inv.paid_amount) : 0;
    return acc;
  }, { count: 0, total: 0, open: 0 });

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Facturatie</h1>
          <p className="text-sm text-muted-foreground">Beheer facturen naar opdrachtgevers</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Nieuwe factuur
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Totaal facturen</p>
          <p className="text-2xl font-semibold">{totals.count}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Totaal gefactureerd</p>
          <p className="text-2xl font-semibold">{formatEUR(totals.total)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Openstaand</p>
          <p className="text-2xl font-semibold text-orange-600">{formatEUR(totals.open)}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Zoek op nummer, bedrijf..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statussen</SelectItem>
            <SelectItem value="concept">Concept</SelectItem>
            <SelectItem value="definitief">Definitief</SelectItem>
            <SelectItem value="verzonden">Verzonden</SelectItem>
            <SelectItem value="betaald">Betaald</SelectItem>
            <SelectItem value="gecrediteerd">Gecrediteerd</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Opdrachtgever</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead>Factuurdatum</TableHead>
                  <TableHead className="text-right">Bedrag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Geen facturen gevonden</TableCell></TableRow>
                ) : filtered.map((inv: any) => {
                  const st = statusBadge[inv.status] || statusBadge.concept;
                  return (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      <TableCell className="font-mono text-xs font-medium">{inv.invoice_number}</TableCell>
                      <TableCell>{inv.companies?.name ?? '—'}</TableCell>
                      <TableCell className="text-xs">{formatDate(inv.period_start)} — {formatDate(inv.period_end)}</TableCell>
                      <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                      <TableCell className="text-right font-mono">{formatEUR(inv.total)}</TableCell>
                      <TableCell><Badge variant="secondary" className={st.class}>{st.label}</Badge></TableCell>
                      <TableCell><Button size="sm" variant="ghost"><Eye className="h-3.5 w-3.5" /></Button></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Invoice Sheet */}
      <CreateInvoiceSheet open={showCreate} onOpenChange={setShowCreate} orgId={orgId} onSuccess={() => { qc.invalidateQueries({ queryKey: ['invoices'] }); setShowCreate(false); }} />

      {/* Invoice Detail Sheet */}
      {selectedInvoice && (
        <InvoiceDetailSheet
          invoice={selectedInvoice}
          lines={invoiceLines ?? []}
          open={!!selectedInvoice}
          onOpenChange={(o) => { if (!o) setSelectedInvoice(null); }}
          onUpdate={() => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice-lines'] }); }}
        />
      )}
    </div>
  );
}

// ─── Create Invoice Sheet ───
function CreateInvoiceSheet({ open, onOpenChange, orgId, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onSuccess: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [preview, setPreview] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch companies
  const { data: companies } = useQuery({
    queryKey: ['companies-list', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('companies').select('id, name').eq('organization_id', orgId).order('name');
      return data ?? [];
    },
  });

  // Load approved timesheets for preview
  const loadTimesheets = async () => {
    if (!companyId || !periodStart || !periodEnd) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('timesheets')
        .select('*, placements!inner(company_id, function_name, client_hourly_rate, overtime_rate, employees(id, candidates(first_name, last_name)))')
        .eq('organization_id', orgId)
        .eq('status', 'goedgekeurd')
        .is('invoice_line_id', null)
        .eq('placements.company_id', companyId)
        .gte('work_date', periodStart)
        .lte('work_date', periodEnd)
        .order('work_date');
      if (error) throw error;
      setPreview(data ?? []);
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  // Group by placement for invoice lines
  const groupedByPlacement = preview.reduce((acc: Record<string, any>, ts: any) => {
    const pid = ts.placement_id;
    if (!acc[pid]) {
      const p = ts.placements;
      const emp = p?.employees?.candidates;
      acc[pid] = {
        placement_id: pid,
        employee_id: p?.employees?.id,
        description: `${p?.function_name ?? 'Plaatsing'} — ${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim(),
        hours: 0, overtime_hours: 0,
        hourly_rate: Number(p?.client_hourly_rate) || Number(ts.hourly_rate) || 0,
        overtime_rate: Number(p?.overtime_rate) || 0,
        travel_amount: 0, allowances_amount: 0, surcharge_amount: 0,
        timesheets: [],
      };
    }
    acc[pid].hours += Number(ts.hours) || 0;
    acc[pid].overtime_hours += Number(ts.overtime_hours) || 0;
    acc[pid].travel_amount += Number(ts.travel_amount) || 0;
    acc[pid].allowances_amount += Number(ts.allowances_amount) || 0;
    acc[pid].surcharge_amount += Number(ts.surcharge_amount) || 0;
    acc[pid].timesheets.push(ts.id);
    return acc;
  }, {});

  const lines = Object.values(groupedByPlacement).map((g: any) => ({
    ...g,
    line_total: (g.hours * g.hourly_rate) + (g.overtime_hours * g.overtime_rate) + g.travel_amount + g.allowances_amount + g.surcharge_amount,
  }));

  const subtotal = lines.reduce((s: number, l: any) => s + l.line_total, 0);
  const vatRate = 21;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const createMutation = useMutation({
    mutationFn: async () => {
      // Generate invoice number
      const { data: numData, error: numErr } = await supabase.rpc('next_invoice_number', { org_id: orgId });
      if (numErr) throw numErr;
      const invoiceNumber = numData;

      // Create invoice
      const { data: inv, error: invErr } = await supabase.from('invoices').insert({
        organization_id: orgId,
        company_id: companyId,
        invoice_number: invoiceNumber,
        period_start: periodStart,
        period_end: periodEnd,
        subtotal, vat_rate: vatRate, vat_amount: vatAmount, total,
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      }).select().single();
      if (invErr) throw invErr;

      // Create invoice lines
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const { data: lineData, error: lineErr } = await supabase.from('invoice_lines').insert({
          organization_id: orgId,
          invoice_id: inv.id,
          placement_id: l.placement_id,
          employee_id: l.employee_id,
          description: l.description,
          hours: l.hours, overtime_hours: l.overtime_hours,
          hourly_rate: l.hourly_rate, overtime_rate: l.overtime_rate,
          travel_amount: l.travel_amount, allowances_amount: l.allowances_amount,
          surcharge_amount: l.surcharge_amount,
          line_total: l.line_total, sort_order: i,
        }).select().single();
        if (lineErr) throw lineErr;

        // Link timesheets to invoice line
        if (l.timesheets.length > 0) {
          await supabase.from('timesheets').update({ invoice_line_id: lineData.id }).in('id', l.timesheets);
        }
      }

      logAudit({ action: 'create', tableName: 'invoices', recordId: inv.id, newValues: { invoice_number: invoiceNumber, total } });
      return inv;
    },
    onSuccess: () => {
      toast.success('Factuur aangemaakt');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>Nieuwe factuur</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label>Opdrachtgever *</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Selecteer..." /></SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Periode van *</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
            <div><Label>Periode tot *</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
          </div>
          <Button variant="outline" onClick={loadTimesheets} disabled={!companyId || !periodStart || !periodEnd || loading}>
            {loading ? 'Laden...' : 'Goedgekeurde uren ophalen'}
          </Button>

          {preview.length > 0 && (
            <>
              <Separator />
              <h4 className="text-sm font-medium">Factuurregels ({lines.length})</h4>
              <div className="space-y-2">
                {lines.map((l: any, i: number) => (
                  <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm">
                    <p className="font-medium">{l.description}</p>
                    <div className="flex gap-4 text-muted-foreground mt-1">
                      <span>{l.hours}u x {formatEUR(l.hourly_rate)}</span>
                      {l.overtime_hours > 0 && <span>{l.overtime_hours}u overwerk x {formatEUR(l.overtime_rate)}</span>}
                      {l.travel_amount > 0 && <span>Reiskosten: {formatEUR(l.travel_amount)}</span>}
                      {l.allowances_amount > 0 && <span>Toeslagen: {formatEUR(l.allowances_amount)}</span>}
                    </div>
                    <p className="text-right font-mono font-medium mt-1">{formatEUR(l.line_total)}</p>
                  </div>
                ))}
              </div>

              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotaal</span><span className="font-mono">{formatEUR(subtotal)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>BTW ({vatRate}%)</span><span className="font-mono">{formatEUR(vatAmount)}</span></div>
                <div className="flex justify-between font-semibold text-base"><span>Totaal</span><span className="font-mono">{formatEUR(total)}</span></div>
              </div>

              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full gap-1">
                <FileText className="h-4 w-4" />
                {createMutation.isPending ? 'Aanmaken...' : 'Factuur aanmaken'}
              </Button>
            </>
          )}

          {preview.length === 0 && companyId && periodStart && periodEnd && !loading && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Geen goedgekeurde, nog niet gefactureerde uren gevonden voor deze periode.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Invoice Detail Sheet ───
function InvoiceDetailSheet({ invoice, lines, open, onOpenChange, onUpdate }: {
  invoice: any; lines: any[]; open: boolean; onOpenChange: (o: boolean) => void; onUpdate: () => void;
}) {
  const st = statusBadge[invoice.status] || statusBadge.concept;

  const markAs = useMutation({
    mutationFn: async (status: string) => {
      const updates: any = { status, updated_at: new Date().toISOString() };
      if (status === 'verzonden') updates.sent_at = new Date().toISOString();
      if (status === 'betaald') { updates.paid_amount = invoice.total; updates.paid_at = new Date().toISOString(); }
      const { error } = await supabase.from('invoices').update(updates).eq('id', invoice.id);
      if (error) throw error;
      logAudit({ action: 'update', tableName: 'invoices', recordId: invoice.id, newValues: { status } });
    },
    onSuccess: () => { toast.success('Status bijgewerkt'); onUpdate(); onOpenChange(false); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> {invoice.invoice_number}
            <Badge variant="secondary" className={st.class}>{st.label}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-muted-foreground">Opdrachtgever</p><p className="font-medium">{invoice.companies?.name}</p></div>
            <div><p className="text-muted-foreground">Factuurdatum</p><p>{formatDate(invoice.invoice_date)}</p></div>
            <div><p className="text-muted-foreground">Periode</p><p>{formatDate(invoice.period_start)} — {formatDate(invoice.period_end)}</p></div>
            <div><p className="text-muted-foreground">Vervaldatum</p><p>{formatDate(invoice.due_date)}</p></div>
            {invoice.reference && <div><p className="text-muted-foreground">Referentie</p><p>{invoice.reference}</p></div>}
          </div>

          <Separator />
          <h4 className="text-sm font-medium">Factuurregels</h4>
          <div className="space-y-2">
            {lines.map((l: any) => {
              const emp = l.placements?.employees?.candidates;
              return (
                <div key={l.id} className="bg-muted/50 rounded-lg p-3 text-sm">
                  <p className="font-medium">{l.description}</p>
                  <div className="flex gap-4 text-muted-foreground mt-1">
                    <span>{l.hours}u x {formatEUR(l.hourly_rate)}</span>
                    {Number(l.overtime_hours) > 0 && <span>{l.overtime_hours}u overwerk</span>}
                    {Number(l.travel_amount) > 0 && <span>Reis: {formatEUR(l.travel_amount)}</span>}
                  </div>
                  <p className="text-right font-mono font-medium mt-1">{formatEUR(l.line_total)}</p>
                </div>
              );
            })}
          </div>

          <Separator />
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotaal</span><span className="font-mono">{formatEUR(invoice.subtotal)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>BTW ({invoice.vat_rate}%)</span><span className="font-mono">{formatEUR(invoice.vat_amount)}</span></div>
            <div className="flex justify-between font-semibold text-base"><span>Totaal</span><span className="font-mono">{formatEUR(invoice.total)}</span></div>
          </div>

          <Separator />
          <div className="flex gap-2">
            {invoice.status === 'concept' && (
              <Button variant="outline" onClick={() => markAs.mutate('definitief')} disabled={markAs.isPending}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Definitief maken
              </Button>
            )}
            {invoice.status === 'definitief' && (
              <Button onClick={() => markAs.mutate('verzonden')} disabled={markAs.isPending}>
                <Send className="h-4 w-4 mr-1" /> Markeer als verzonden
              </Button>
            )}
            {invoice.status === 'verzonden' && (
              <Button variant="default" onClick={() => markAs.mutate('betaald')} disabled={markAs.isPending}>
                <Euro className="h-4 w-4 mr-1" /> Markeer als betaald
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
