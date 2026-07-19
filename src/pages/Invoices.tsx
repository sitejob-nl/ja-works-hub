import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, FileText, Search, Eye, Send, CheckCircle2, Euro, Download, RefreshCw, Info } from 'lucide-react';
import { formatDate, formatEUR } from '@/lib/format';
import { EntityLink } from '@/components/ui/entity-link';
import { logAudit } from '@/lib/audit';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { toExactErrorMessage } from '@/lib/exact-errors';
import { payrollerLabel, payrollerBadgeClass, JA_WERKT_PAYROLLERS } from '@/lib/payroller';
import { useRolePermission } from '@/hooks/usePermissions';

type PayrollerType = Database['public']['Enums']['payroller_type'];
type PayrollerFilter = PayrollerType | 'all';
type PayrollerCreateFilter = PayrollerFilter | 'ja_werkt';

const jaWerktPayrollers = JA_WERKT_PAYROLLERS as readonly PayrollerType[];

const statusBadge: Record<string, { class: string; label: string }> = {
  concept: { class: 'bg-muted text-muted-foreground border-0', label: 'Concept' },
  definitief: { class: 'bg-blue-100 text-blue-700 border-0', label: 'Definitief' },
  verzonden: { class: 'bg-orange-100 text-orange-700 border-0', label: 'Verzonden' },
  betaald: { class: 'bg-stat-green/10 text-stat-green border-0', label: 'Betaald' },
  gecrediteerd: { class: 'bg-red-100 text-red-700 border-0', label: 'Gecrediteerd' },
};

export default function InvoicesPage() {
  const orgId = useOrganizationId();
  const canManageFinance = useRolePermission('finance.manage');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [payrollerFilter, setPayrollerFilter] = useState<PayrollerFilter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('eigen');

  // Fetch invoices with payroller info from invoice_lines -> placements
  const { data: invoices, isLoading } = useQuery({
    queryKey: ['invoices', orgId, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('invoices')
        .select('*, companies(name), invoice_lines(placements(payroller))')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter as any);
      const { data, error } = await q;
      if (error) throw error;
      // Derive unique payrollers per invoice
      return (data ?? []).map((inv: any) => {
        const payrollers = [...new Set(
          (inv.invoice_lines ?? [])
            .map((l: any) => l.placements?.payroller)
            .filter(Boolean)
        )] as string[];
        return { ...inv, payrollers };
      });
    },
  });

  // Fetch Flexpedia timesheets (read-only reference)
  const { data: flexpediaTimesheets, isLoading: flexpediaLoading } = useQuery({
    queryKey: ['flexpedia-timesheets', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('timesheets')
        .select('*, placements!inner(company_id, function_name, payroller, client_hourly_rate, overtime_rate, companies!placements_company_id_fkey(name), employees(id, candidates(first_name, last_name)))')
        .eq('organization_id', orgId)
        .eq('status', 'goedgekeurd')
        .eq('placements.payroller', 'flexpedia')
        .is('invoice_line_id', null)
        .order('work_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch invoice lines when selected
  const { data: invoiceLines } = useQuery({
    queryKey: ['invoice-lines', selectedInvoice?.id],
    queryFn: async () => {
      if (!selectedInvoice) return [];
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('*, placements(function_name, payroller, employees(id, candidates(first_name, last_name)))')
        .eq('invoice_id', selectedInvoice.id)
        .order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedInvoice,
  });

  const filtered = (invoices ?? []).filter((inv: any) => {
    if (payrollerFilter !== 'all') {
      if (!inv.payrollers?.includes(payrollerFilter)) return false;
    }
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

  // Group Flexpedia timesheets by company for the reference view
  const flexpediaByCompany = (flexpediaTimesheets ?? []).reduce((acc: Record<string, any>, ts: any) => {
    const companyName = ts.placements?.companies?.name ?? 'Onbekend';
    if (!acc[companyName]) {
      acc[companyName] = { company: companyName, hours: 0, overtime_hours: 0, timesheets: [] };
    }
    acc[companyName].hours += Number(ts.hours) || 0;
    acc[companyName].overtime_hours += Number(ts.overtime_hours) || 0;
    acc[companyName].timesheets.push(ts);
    return acc;
  }, {});

  const flexpediaTotal = (flexpediaTimesheets ?? []).reduce((s: number, ts: any) => {
    const rate = Number(ts.placements?.client_hourly_rate) || Number(ts.hourly_rate) || 0;
    const otRate = Number(ts.placements?.overtime_rate) || 0;
    return s + (Number(ts.hours) || 0) * rate + (Number(ts.overtime_hours) || 0) * otRate;
  }, 0);

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Facturatie</h1>
          <p className="text-sm text-muted-foreground">Beheer facturen naar opdrachtgevers</p>
        </div>
        {canManageFinance && (
          <Button onClick={() => setShowCreate(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Nieuwe factuur
          </Button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Eigen facturen</p>
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
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Flexpedia (referentie)</p>
          <p className="text-2xl font-semibold text-amber-600">{formatEUR(flexpediaTotal)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Niet door ja werkt gefactureerd</p>
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="eigen">Eigen facturen</TabsTrigger>
          <TabsTrigger value="flexpedia">Flexpedia (referentie)</TabsTrigger>
        </TabsList>

        <TabsContent value="eigen">
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
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
            <Select value={payrollerFilter} onValueChange={(v) => setPayrollerFilter(v as PayrollerFilter)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle payrollers</SelectItem>
                <SelectItem value="brioworks">BrioWorks</SelectItem>
                <SelectItem value="bromida">Bromida</SelectItem>
                <SelectItem value="retiva">Retiva/A1</SelectItem>
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
                      <TableHead>Payroller</TableHead>
                      <TableHead>Periode</TableHead>
                      <TableHead>Factuurdatum</TableHead>
                      <TableHead className="text-right">Bedrag</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Geen facturen gevonden</TableCell></TableRow>
                    ) : filtered.map((inv: any) => {
                      const st = statusBadge[inv.status] || statusBadge.concept;
                      return (
                        <TableRow key={inv.id} className="cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                          <TableCell className="font-mono text-xs font-medium">{inv.invoice_number}</TableCell>
                          <TableCell><EntityLink type="company" id={inv.company_id}>{inv.companies?.name ?? '—'}</EntityLink></TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {(inv.payrollers ?? []).length > 0
                                ? inv.payrollers.map((p: string) => (
                                    <Badge key={p} variant="secondary" className={`text-[10px] ${payrollerBadgeClass[p] ?? ''}`}>
                                      {payrollerLabel[p] ?? p}
                                    </Badge>
                                  ))
                                : <span className="text-muted-foreground text-xs">—</span>
                              }
                            </div>
                          </TableCell>
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
        </TabsContent>

        <TabsContent value="flexpedia">
          {/* Flexpedia reference view */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Deze uren worden door Flexpedia gefactureerd</p>
              <p className="text-xs text-amber-600 mt-0.5">Flexpedia factureert rechtstreeks aan de eindklant. Dit overzicht is alleen ter referentie — hier worden geen facturen voor aangemaakt.</p>
            </div>
          </div>

          {flexpediaLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : Object.keys(flexpediaByCompany).length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <p>Geen goedgekeurde, niet-gefactureerde Flexpedia uren gevonden.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.values(flexpediaByCompany).map((group: any) => (
                <Card key={group.company}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{group.company}</h4>
                        <Badge variant="secondary" className={payrollerBadgeClass.flexpedia + ' text-[10px]'}>Flexpedia</Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">{group.hours.toFixed(1)}u normaal{group.overtime_hours > 0 ? ` + ${group.overtime_hours.toFixed(1)}u overwerk` : ''}</span>
                    </div>
                    <div className="space-y-1">
                      {group.timesheets.map((ts: any) => {
                        const emp = ts.placements?.employees?.candidates;
                        return (
                          <div key={ts.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                            <div className="flex gap-3">
                              <span className="text-muted-foreground w-20">{formatDate(ts.work_date)}</span>
                              <span className="font-medium">{emp?.first_name} {emp?.last_name}</span>
                              <span className="text-muted-foreground">{ts.placements?.function_name}</span>
                            </div>
                            <span className="font-mono text-xs">{Number(ts.hours).toFixed(1)}u</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Invoice Sheet */}
      {canManageFinance && <CreateInvoiceSheet open={showCreate} onOpenChange={setShowCreate} orgId={orgId} onSuccess={() => { qc.invalidateQueries({ queryKey: ['invoices'] }); setShowCreate(false); }} />}

      {/* Invoice Detail Sheet */}
      {selectedInvoice && (
        <InvoiceDetailSheet
          invoice={selectedInvoice}
          lines={invoiceLines ?? []}
          open={!!selectedInvoice}
          canManage={canManageFinance}
          onOpenChange={(o) => { if (!o) setSelectedInvoice(null); }}
          onUpdate={() => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice-lines'] }); }}
        />
      )}
    </div>
  );
}

// ─── Create Invoice Sheet ───
interface ManualLine { description: string; hours: number; hourly_rate: number; line_total: number; }

function CreateInvoiceSheet({ open, onOpenChange, orgId, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onSuccess: () => void }) {
  const [mode, setMode] = useState<'uren' | 'handmatig'>('uren');
  const [companyId, setCompanyId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [reference, setReference] = useState('');
  const [preview, setPreview] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [payrollerCreateFilter, setPayrollerCreateFilter] = useState<PayrollerCreateFilter>('ja_werkt');

  // Manual lines state
  const [manualLines, setManualLines] = useState<ManualLine[]>([{ description: '', hours: 0, hourly_rate: 0, line_total: 0 }]);

  const addManualLine = () => setManualLines(prev => [...prev, { description: '', hours: 0, hourly_rate: 0, line_total: 0 }]);
  const removeManualLine = (i: number) => setManualLines(prev => prev.filter((_, idx) => idx !== i));
  const updateManualLine = (i: number, field: keyof ManualLine, value: any) => {
    setManualLines(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      // Auto-calculate line_total when hours or rate changes
      if (field === 'hours' || field === 'hourly_rate') {
        next[i].line_total = Number(next[i].hours) * Number(next[i].hourly_rate);
      }
      // If line_total is set directly (flat amount), keep it
      return next;
    });
  };

  // Fetch companies
  const { data: companies } = useQuery({
    queryKey: ['companies-list', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('companies').select('id, name').eq('organization_id', orgId).order('name');
      return data ?? [];
    },
  });

  // Load approved timesheets for preview (filtered by payroller)
  const loadTimesheets = async () => {
    if (!companyId || !periodStart || !periodEnd) return;
    setLoading(true);
    try {
      let q = supabase
        .from('timesheets')
        .select('*, placements!inner(company_id, function_name, payroller, client_hourly_rate, overtime_rate, employees(id, candidates(first_name, last_name)))')
        .eq('organization_id', orgId)
        .eq('status', 'goedgekeurd')
        .is('invoice_line_id', null)
        .eq('placements.company_id', companyId)
        .gte('work_date', periodStart)
        .lte('work_date', periodEnd)
        .order('work_date');

      // Apply payroller filter
      if (payrollerCreateFilter === 'ja_werkt') {
        q = q.in('placements.payroller', jaWerktPayrollers);
      } else if (payrollerCreateFilter !== 'all') {
        q = q.eq('placements.payroller', payrollerCreateFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      setPreview(data ?? []);
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  // Group by placement for invoice lines (uren mode)
  const groupedByPlacement = preview.reduce((acc: Record<string, any>, ts: any) => {
    const pid = ts.placement_id;
    if (!acc[pid]) {
      const p = ts.placements;
      const emp = p?.employees?.candidates;
      acc[pid] = {
        placement_id: pid, employee_id: p?.employees?.id,
        payroller: p?.payroller ?? null,
        description: `${p?.function_name ?? 'Plaatsing'} — ${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim(),
        hours: 0, overtime_hours: 0,
        hourly_rate: Number(p?.client_hourly_rate) || Number(ts.hourly_rate) || 0,
        overtime_rate: Number(p?.overtime_rate) || 0,
        travel_amount: 0, allowances_amount: 0, surcharge_amount: 0, timesheets: [],
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

  const urenLines = Object.values(groupedByPlacement).map((g: any) => ({
    ...g,
    line_total: (g.hours * g.hourly_rate) + (g.overtime_hours * g.overtime_rate) + g.travel_amount + g.allowances_amount + g.surcharge_amount,
  }));

  const activeLines = mode === 'uren' ? urenLines : manualLines.filter(l => l.description);
  const subtotal = activeLines.reduce((s: number, l: any) => s + (Number(l.line_total) || 0), 0);
  const vatRate = 21;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (activeLines.length === 0) throw new Error('Voeg minimaal één factuurlijn toe');
      if (!companyId) throw new Error('Selecteer een opdrachtgever');
      if (!periodStart || !periodEnd) throw new Error('Vul de periode in');

      const linesPayload = activeLines.map((l: any, i: number) => ({
        placement_id: l.placement_id || null,
        employee_id: l.employee_id || null,
        description: l.description,
        hours: l.hours || 0,
        overtime_hours: l.overtime_hours || 0,
        hourly_rate: l.hourly_rate || 0,
        overtime_rate: l.overtime_rate || 0,
        travel_amount: l.travel_amount || 0,
        allowances_amount: l.allowances_amount || 0,
        surcharge_amount: l.surcharge_amount || 0,
        line_total: l.line_total || 0,
        sort_order: i,
        timesheets: Array.isArray(l.timesheets) ? l.timesheets : [],
      }));

      const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
      const { data: invoiceResult, error: createErr } = await (supabase as any)
        .rpc('create_invoice_transaction', {
          p_org_id: orgId,
          p_company_id: companyId,
          p_period_start: periodStart,
          p_period_end: periodEnd,
          p_reference: reference || null,
          p_subtotal: subtotal,
          p_vat_rate: vatRate,
          p_vat_amount: vatAmount,
          p_total: total,
          p_due_date: dueDate,
          p_lines: linesPayload,
        })
        .single();
      if (createErr) throw createErr;
      if (!invoiceResult?.invoice_id || !invoiceResult?.invoice_number) {
        throw new Error('Factuur kon niet atomair worden aangemaakt');
      }

      const inv = { id: invoiceResult.invoice_id, invoice_number: invoiceResult.invoice_number };
      logAudit({ action: 'create', tableName: 'invoices', recordId: inv.id, newValues: { invoice_number: inv.invoice_number, total } });
      return inv;
    },
    onSuccess: () => { toast.success('Factuur aangemaakt'); onSuccess(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>Nieuwe factuur</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6">
          {/* Payroller info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">Alleen BrioWorks, Bromida en Retiva plaatsingen</p>
              <p className="text-xs text-blue-600 mt-0.5">Flexpedia factureert rechtstreeks aan de eindklant. Die uren worden hier standaard uitgesloten.</p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 bg-muted p-1 rounded-lg">
            <button className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${mode === 'uren' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`} onClick={() => setMode('uren')}>Vanuit uren</button>
            <button className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${mode === 'handmatig' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`} onClick={() => setMode('handmatig')}>Handmatig</button>
          </div>

          {/* Payroller filter for uren mode */}
          {mode === 'uren' && (
            <div>
              <Label>Payroller filter</Label>
              <Select value={payrollerCreateFilter} onValueChange={(v) => { setPayrollerCreateFilter(v as PayrollerCreateFilter); setPreview([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja_werkt">Eigen facturatie (BrioWorks, Bromida, Retiva)</SelectItem>
                  <SelectItem value="brioworks">Alleen BrioWorks</SelectItem>
                  <SelectItem value="bromida">Alleen Bromida</SelectItem>
                  <SelectItem value="retiva">Alleen Retiva/A1</SelectItem>
                  <SelectItem value="all">Alles (incl. Flexpedia)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Company + period (shared) */}
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
          <div><Label>Referentie / PO nummer</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optioneel" /></div>

          {/* Uren mode */}
          {mode === 'uren' && (
            <>
              <Button variant="outline" onClick={loadTimesheets} disabled={!companyId || !periodStart || !periodEnd || loading}>
                {loading ? 'Laden...' : 'Goedgekeurde uren ophalen'}
              </Button>

              {preview.length > 0 && (
                <>
                  <Separator />
                  <h4 className="text-sm font-medium">Factuurregels ({urenLines.length})</h4>
                  <div className="space-y-2">
                    {urenLines.map((l: any, i: number) => (
                      <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <p className="font-medium flex-1">{l.description}</p>
                          {l.payroller && (
                            <Badge variant="secondary" className={`text-[10px] ${payrollerBadgeClass[l.payroller] ?? ''}`}>
                              {payrollerLabel[l.payroller] ?? l.payroller}
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-4 text-muted-foreground mt-1">
                          <span>{l.hours}u x {formatEUR(l.hourly_rate)}</span>
                          {l.overtime_hours > 0 && <span>{l.overtime_hours}u overwerk x {formatEUR(l.overtime_rate)}</span>}
                          {l.travel_amount > 0 && <span>Reis: {formatEUR(l.travel_amount)}</span>}
                        </div>
                        <p className="text-right font-mono font-medium mt-1">{formatEUR(l.line_total)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {preview.length === 0 && companyId && periodStart && periodEnd && !loading && (
                <p className="text-sm text-muted-foreground text-center py-4">Geen goedgekeurde, nog niet gefactureerde uren gevonden.</p>
              )}
            </>
          )}

          {/* Handmatig mode */}
          {mode === 'handmatig' && (
            <>
              <Separator />
              <h4 className="text-sm font-medium">Factuurregels</h4>
              <div className="space-y-3">
                {manualLines.map((line, i) => (
                  <div key={i} className="bg-muted/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Regel {i + 1}</span>
                      {manualLines.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-red-500" onClick={() => removeManualLine(i)}>Verwijder</Button>
                      )}
                    </div>
                    <Input placeholder="Omschrijving *" value={line.description} onChange={e => updateManualLine(i, 'description', e.target.value)} />
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs">Uren</Label><Input type="number" step="0.5" value={line.hours || ''} onChange={e => updateManualLine(i, 'hours', Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Uurtarief €</Label><Input type="number" step="0.01" value={line.hourly_rate || ''} onChange={e => updateManualLine(i, 'hourly_rate', Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Bedrag €</Label><Input type="number" step="0.01" value={line.line_total || ''} onChange={e => updateManualLine(i, 'line_total', Number(e.target.value))} /></div>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addManualLine} className="gap-1"><Plus className="h-3 w-3" /> Regel toevoegen</Button>
            </>
          )}

          {/* Totals + submit */}
          {activeLines.length > 0 && subtotal > 0 && (
            <>
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
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Invoice Detail Sheet ───
function InvoiceDetailSheet({ invoice, lines, open, onOpenChange, onUpdate, canManage }: {
  invoice: any; lines: any[]; open: boolean; canManage: boolean; onOpenChange: (o: boolean) => void; onUpdate: () => void;
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
    onSuccess: (_data, newStatus) => {
      toast.success('Status bijgewerkt');
      // Auto-push naar Exact als definitief en nog niet gesynceerd
      if (newStatus === 'definitief' && !invoice.exact_invoice_id) {
        syncExact.mutate();
      }
      onUpdate();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // PDF generation
  const generatePdf = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-invoice-pdf', { body: { invoice_id: invoice.id } });
      if (error) throw error;
      if (data?.html) {
        const win = window.open('', '_blank');
        if (win) { win.document.write(data.html); win.document.close(); win.print(); }
      }
      return data;
    },
    onSuccess: (data) => { toast.success('PDF gegenereerd'); if (data?.pdf_url) onUpdate(); },
    onError: async (e: any) => toast.error(await extractFunctionErrorMessage(e, 'PDF genereren mislukt')),
  });

  // Exact Online sync
  const syncExact = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('exact-sync-invoice', { body: { invoice_id: invoice.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Gesynchroniseerd naar Exact Online');
      // De sync splitst een regel in componenten; wijkt de som af van het
      // regeltotaal, dan is dat een boekhoudkundig signaal en geen detail.
      for (const warning of (data?.warnings ?? []) as string[]) {
        toast.warning(warning);
      }
      onUpdate();
    },
    onError: async (e: any) => toast.error(await toExactErrorMessage(e, 'Synchroniseren naar Exact Online mislukt')),
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
            <div><p className="text-muted-foreground">Opdrachtgever</p><p className="font-medium"><EntityLink type="company" id={invoice.company_id}>{invoice.companies?.name ?? '—'}</EntityLink></p></div>
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
              const linePayroller = l.placements?.payroller;
              return (
                <div key={l.id} className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <p className="font-medium flex-1">{l.description}</p>
                    {linePayroller && (
                      <Badge variant="secondary" className={`text-[10px] ${payrollerBadgeClass[linePayroller] ?? ''}`}>
                        {payrollerLabel[linePayroller] ?? linePayroller}
                      </Badge>
                    )}
                  </div>
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

          {invoice.exact_invoice_id && (
            <div className="bg-emerald-50 rounded-lg p-3 text-sm text-emerald-800">
              <span className="font-medium">✓ Gesynchroniseerd naar Exact Online</span>
              <span className="text-xs ml-2 text-emerald-600">ID: {invoice.exact_invoice_id}</span>
            </div>
          )}

          <Separator />
          <div className="flex flex-wrap gap-2">
            {/* Status flow */}
            {canManage && invoice.status === 'concept' && (
              <Button variant="outline" onClick={() => markAs.mutate('definitief')} disabled={markAs.isPending}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Definitief maken
              </Button>
            )}
            {canManage && invoice.status === 'definitief' && (
              <Button onClick={() => markAs.mutate('verzonden')} disabled={markAs.isPending}>
                <Send className="h-4 w-4 mr-1" /> Markeer als verzonden
              </Button>
            )}
            {canManage && invoice.status === 'verzonden' && (
              <Button variant="default" onClick={() => markAs.mutate('betaald')} disabled={markAs.isPending}>
                <Euro className="h-4 w-4 mr-1" /> Markeer als betaald
              </Button>
            )}

            {/* PDF */}
            <Button variant="outline" onClick={() => generatePdf.mutate()} disabled={generatePdf.isPending}>
              <Download className="h-4 w-4 mr-1" /> {generatePdf.isPending ? 'Genereren...' : 'PDF'}
            </Button>

            {/* Exact sync */}
            {canManage && !invoice.exact_invoice_id && invoice.status !== 'concept' && (
              <Button variant="outline" onClick={() => syncExact.mutate()} disabled={syncExact.isPending}>
                <RefreshCw className={`h-4 w-4 mr-1 ${syncExact.isPending ? 'animate-spin' : ''}`} />
                {syncExact.isPending ? 'Synchroniseren...' : 'Naar Exact'}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
