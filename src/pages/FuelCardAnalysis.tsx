import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { Upload, AlertTriangle, Fuel, CheckCircle2, StickyNote, Link as LinkIcon, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { startOfMonth, endOfMonth, format } from 'date-fns';

/* ─── helpers ────────────────────────────────────────────── */

const now = new Date();
const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

/* ─── Component ──────────────────────────────────────────── */

const FuelCardAnalysis = () => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  /* ── Queries ─────────────────────────────────────── */

  const { data: transactions = [] } = useQuery({
    queryKey: ['fuel-transactions', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fuel_card_transactions')
        .select('*, vehicles(id, license_plate, tank_capacity_liters, avg_consumption_per_100km), employees(id, candidates(first_name, last_name))')
        .eq('organization_id', orgId!)
        .order('transaction_date', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!orgId,
  });

  const thisMonth = useMemo(() => transactions.filter(t => t.transaction_date >= monthStart && t.transaction_date <= monthEnd), [transactions]);
  const flagged = useMemo(() => transactions.filter(t => !t.reviewed && (t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption)), [transactions]);
  const allFlagged = useMemo(() => transactions.filter(t => t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption), [transactions]);

  /* ── KPIs ────────────────────────────────────────── */

  const totalLiters = thisMonth.reduce((s, t) => s + Number(t.liters), 0);
  const totalAmount = thisMonth.reduce((s, t) => s + Number(t.amount_eur), 0);
  const flagCount = allFlagged.length;

  /* ── Mutations ───────────────────────────────────── */

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fuel_card_transactions').update({ reviewed: true, reviewed_at: new Date().toISOString(), reviewed_by: user?.id } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fuel-transactions'] }); toast.success('Markeerd als bekeken'); },
  });

  const saveNote = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase.from('fuel_card_transactions').update({ flag_notes: note } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fuel-transactions'] }); toast.success('Notitie opgeslagen'); },
  });

  /* ── Import history grouped ──────────────────────── */

  const importHistory = useMemo(() => {
    const groups: Record<string, { batch: string; count: number; flagCount: number; date: string }> = {};
    transactions.forEach(t => {
      const b = t.import_batch_id ?? 'onbekend';
      if (!groups[b]) groups[b] = { batch: b, count: 0, flagCount: 0, date: t.created_at };
      groups[b].count++;
      if (t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption) groups[b].flagCount++;
    });
    return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Q8 Tankpas Analyse</h1>
          <p className="text-sm text-muted-foreground">Upload transactielijsten en detecteer afwijkingen</p>
        </div>
        <Button onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-2" /> Importeren</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Transacties (maand)" value={thisMonth.length.toString()} />
        <KpiCard label="Liters (maand)" value={totalLiters.toFixed(1)} />
        <KpiCard label="Bedrag (maand)" value={formatEUR(totalAmount)} />
        <KpiCard label="Afwijkingen" value={flagCount.toString()} variant={flagCount > 0 ? 'danger' : 'default'} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="flags">
        <TabsList>
          <TabsTrigger value="flags">Afwijkingen{flagged.length > 0 && ` (${flagged.length})`}</TabsTrigger>
          <TabsTrigger value="all">Alle transacties</TabsTrigger>
          <TabsTrigger value="history">Import geschiedenis</TabsTrigger>
        </TabsList>

        {/* ── Afwijkingen ───────────────────────────── */}
        <TabsContent value="flags" className="space-y-4 mt-4">
          {flagged.length === 0 ? (
            <p className="text-sm text-muted-foreground">Geen openstaande afwijkingen 🎉</p>
          ) : flagged.map(t => <FlagCard key={t.id} t={t} onReview={() => markReviewed.mutate(t.id)} onSaveNote={(note) => saveNote.mutate({ id: t.id, note })} />)}
        </TabsContent>

        {/* ── Alle transacties ──────────────────────── */}
        <TabsContent value="all" className="mt-4">
          <AllTransactionsTable data={transactions} />
        </TabsContent>

        {/* ── Import geschiedenis ───────────────────── */}
        <TabsContent value="history" className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Import batch</TableHead>
                <TableHead className="text-right">Transacties</TableHead>
                <TableHead className="text-right">Afwijkingen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importHistory.map(h => (
                <TableRow key={h.batch}>
                  <TableCell className="font-mono text-xs">{h.batch.length > 20 ? h.batch.slice(0, 8) + '…' : h.batch}</TableCell>
                  <TableCell className="text-right">{h.count}</TableCell>
                  <TableCell className="text-right">{h.flagCount > 0 ? <Badge variant="destructive">{h.flagCount}</Badge> : '0'}</TableCell>
                </TableRow>
              ))}
              {importHistory.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground text-center">Geen imports</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      {/* Import Sheet */}
      <ImportSheet open={importOpen} onOpenChange={setImportOpen} orgId={orgId} onDone={() => { qc.invalidateQueries({ queryKey: ['fuel-transactions'] }); }} />
    </div>
  );
};

/* ─── KPI Card ──────────────────────────────────────────── */

const KpiCard = ({ label, value, variant = 'default' }: { label: string; value: string; variant?: 'default' | 'danger' }) => (
  <Card className={variant === 'danger' ? 'border-destructive bg-destructive/5' : ''}>
    <CardContent className="pt-5 pb-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${variant === 'danger' ? 'text-destructive' : ''}`}>{value}</p>
    </CardContent>
  </Card>
);

/* ─── Flag Card ─────────────────────────────────────────── */

const FlagCard = ({ t, onReview, onSaveNote }: { t: any; onReview: () => void; onSaveNote: (n: string) => void }) => {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(t.flag_notes ?? '');
  const emp = t.employees?.candidates;
  const empName = emp ? `${emp.first_name} ${emp.last_name}` : null;

  // Count same-day transactions
  const sameDayCount = t.flag_multiple_same_day ? '2+' : null;

  return (
    <Card className="border-destructive/30">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">{formatDate(t.transaction_date)}</span>
          {t.vehicles ? (
            <Link to={`/transport/${t.vehicles.id}`} className="text-primary hover:underline font-mono">{t.license_plate ?? t.vehicles.license_plate}</Link>
          ) : (
            <span className="font-mono">{t.license_plate ?? '—'}</span>
          )}
          {empName && t.employees?.id && (
            <Link to={`/medewerkers/${t.employees.id}`} className="text-primary hover:underline">{empName}</Link>
          )}
          <span>{t.liters}L · {formatEUR(t.amount_eur)}</span>
          {t.station_name && <span className="text-muted-foreground">{t.station_name}</span>}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-2">
          {t.flag_over_capacity && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Boven tankcapaciteit
              {t.vehicles?.tank_capacity_liters && <span className="font-normal ml-1">({t.liters}L / {t.vehicles.tank_capacity_liters}L)</span>}
            </Badge>
          )}
          {t.flag_multiple_same_day && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Meerdere keren per dag {sameDayCount && `(${sameDayCount})`}
            </Badge>
          )}
          {t.flag_excessive_consumption && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Overmatig verbruik
            </Badge>
          )}
        </div>

        {t.flag_notes && !noteOpen && <p className="text-xs text-muted-foreground bg-muted rounded p-2">{t.flag_notes}</p>}

        {noteOpen && (
          <div className="flex gap-2">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Notitie…" className="flex-1" />
            <Button size="sm" onClick={() => { onSaveNote(note); setNoteOpen(false); }}>Opslaan</Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onReview}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Bekeken</Button>
          <Button size="sm" variant="ghost" onClick={() => setNoteOpen(!noteOpen)}><StickyNote className="h-3.5 w-3.5 mr-1" /> Notitie</Button>
        </div>
      </CardContent>
    </Card>
  );
};

/* ─── All Transactions Table ────────────────────────────── */

const AllTransactionsTable = ({ data }: { data: any[] }) => (
  <div className="rounded-md border overflow-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Datum</TableHead>
          <TableHead>Kenteken</TableHead>
          <TableHead>Medewerker</TableHead>
          <TableHead className="text-right">Liters</TableHead>
          <TableHead className="text-right">Bedrag</TableHead>
          <TableHead>Station</TableHead>
          <TableHead>Flags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map(t => {
          const emp = t.employees?.candidates;
          const hasFlag = t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption;
          return (
            <TableRow key={t.id}>
              <TableCell>{formatDate(t.transaction_date)}</TableCell>
              <TableCell className="font-mono">{t.license_plate ?? '—'}</TableCell>
              <TableCell>{emp ? `${emp.first_name} ${emp.last_name}` : '—'}</TableCell>
              <TableCell className="text-right">{t.liters}</TableCell>
              <TableCell className="text-right">{formatEUR(t.amount_eur)}</TableCell>
              <TableCell>{t.station_name ?? '—'}</TableCell>
              <TableCell>
                {hasFlag ? (
                  <div className="flex flex-wrap gap-1">
                    {t.flag_over_capacity && <Badge variant="destructive" className="text-[10px]">Capaciteit</Badge>}
                    {t.flag_multiple_same_day && <Badge variant="destructive" className="text-[10px]">Meerdere/dag</Badge>}
                    {t.flag_excessive_consumption && <Badge variant="destructive" className="text-[10px]">Verbruik</Badge>}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Geen transacties</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>
);

/* ─── Import Sheet ──────────────────────────────────────── */

type ColMap = { datum: string; kenteken: string; liters: string; bedrag: string; prijs: string; station: string };

const Q8_SIGNATURE = ['Kentekenplaat', 'Hoeveelheid', 'transactie datum'];
const Q8_PRESET = {
  datum: 'transactie datum',
  kenteken: 'Kentekenplaat',
  liters: 'Hoeveelheid',
  bedrag: 'Bedrag incl BTW',
  prijs: 'Pompprijs incl. BTW',
  station: 'Site',
} satisfies ColMap;

const ImportSheet = ({ open, onOpenChange, orgId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null; onDone: () => void }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<ColMap>({ datum: '', kenteken: '', liters: '', bedrag: '', prijs: '', station: '' });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; flags: number } | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);

  const reset = () => { setStep(1); setRows([]); setHeaders([]); setColMap({ datum: '', kenteken: '', liters: '', bedrag: '', prijs: '', station: '' }); setResult(null); setAutoDetected(false); };

  const handleFile = async (file: File) => {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
        if (json.length === 0) {
          toast.error('Excel-bestand bevat geen data');
          return;
        }
        const headersList = Object.keys(json[0]);
        const stringRows = json.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')])));
        setHeaders(headersList);
        setRows(stringRows);

        const isQ8 = Q8_SIGNATURE.every((h) => headersList.includes(h));
        if (isQ8) {
          setColMap(Q8_PRESET);
          setAutoDetected(true);
          setStep(3);
        } else {
          setAutoDetected(false);
          setStep(2);
        }
      } catch (e) {
        toast.error('Excel parse fout');
      }
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        setHeaders(res.meta.fields ?? []);
        setRows(res.data as Record<string, string>[]);
        setAutoDetected(false);
        setStep(2);
      },
      error: () => toast.error('CSV parse fout'),
    });
  };

  const handleImport = async () => {
    if (!orgId) return;
    setImporting(true);
    const batchId = crypto.randomUUID();

    try {
      // Fetch vehicles for matching
      const { data: vehicles } = await supabase.from('vehicles').select('id, license_plate, fuel_card_reference, tank_capacity_liters, avg_consumption_per_100km').eq('organization_id', orgId);
      // Fetch active assignments
      const { data: assignments } = await supabase.from('vehicle_assignments').select('vehicle_id, employee_id').is('returned_date', null);

      const vehicleByPlate: Record<string, any> = {};
      const vehicleByRef: Record<string, any> = {};
      (vehicles ?? []).forEach(v => {
        if (v.license_plate) vehicleByPlate[v.license_plate.toUpperCase().replace(/[^A-Z0-9]/g, '')] = v;
        if (v.fuel_card_reference) vehicleByRef[v.fuel_card_reference.toUpperCase().trim()] = v;
      });
      const assignmentByVehicle: Record<string, string> = {};
      (assignments ?? []).forEach(a => { assignmentByVehicle[a.vehicle_id] = a.employee_id; });

      const inserts: any[] = [];
      for (const row of rows) {
        const rawDate = row[colMap.datum] ?? '';
        const rawRef = row[colMap.kenteken] ?? '';
        const rawLiters = row[colMap.liters] ?? '0';
        const rawAmount = row[colMap.bedrag] ?? '0';
        const rawPrice = colMap.prijs ? (row[colMap.prijs] ?? null) : null;
        const rawStation = colMap.station ? (row[colMap.station] ?? null) : null;

        const liters = parseFloat(rawLiters.replace(',', '.')) || 0;
        const amount = parseFloat(rawAmount.replace(',', '.')) || 0;
        const price = rawPrice ? parseFloat(rawPrice.replace(',', '.')) || null : null;

        // Parse date — try multiple formats
        let parsedDate = '';
        const trimDate = rawDate.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(trimDate)) {
          parsedDate = trimDate.slice(0, 10);
        } else if (/^\d{2}-\d{2}-\d{4}/.test(trimDate)) {
          const [d, m, y] = trimDate.split('-');
          parsedDate = `${y}-${m}-${d}`;
        } else if (/^\d{2}\/\d{2}\/\d{4}/.test(trimDate)) {
          const [d, m, y] = trimDate.split('/');
          parsedDate = `${y}-${m}-${d}`;
        }
        if (!parsedDate) continue;

        const normalRef = rawRef.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const rawCard = String(row['Kaartnummer'] ?? '').trim();
        const vehicle = vehicleByPlate[normalRef]
          ?? vehicleByRef[rawRef.toUpperCase().trim()]
          ?? (rawCard ? vehicleByRef[rawCard.toUpperCase()] : null);
        const vehicleId = vehicle?.id ?? null;
        const employeeId = vehicleId ? (assignmentByVehicle[vehicleId] ?? null) : null;

        // Fraud checks
        let flagOverCap = false;
        if (vehicle?.tank_capacity_liters && liters > Number(vehicle.tank_capacity_liters)) {
          flagOverCap = true;
        }

        inserts.push({
          organization_id: orgId,
          import_batch_id: batchId,
          fuel_card_reference: rawRef.trim(),
          license_plate: rawRef.trim().toUpperCase(),
          transaction_date: parsedDate,
          liters,
          amount_eur: amount,
          price_per_liter: price,
          station_name: rawStation?.trim() || null,
          vehicle_id: vehicleId,
          employee_id: employeeId,
          flag_over_capacity: flagOverCap,
          raw_data: row,
        });
      }

      // Detect same-day multiples
      const dayGroups: Record<string, number[]> = {};
      inserts.forEach((ins, i) => {
        const key = `${ins.fuel_card_reference}__${ins.transaction_date}`;
        if (!dayGroups[key]) dayGroups[key] = [];
        dayGroups[key].push(i);
      });
      Object.values(dayGroups).forEach(indices => {
        if (indices.length >= 2) indices.forEach(i => { inserts[i].flag_multiple_same_day = true; });
      });

      // Excessive consumption check (simple: weekly liters > capacity × 3)
      if (inserts.length > 0) {
        const refTotals: Record<string, { liters: number; cap: number | null }> = {};
        inserts.forEach(ins => {
          const ref = ins.fuel_card_reference;
          if (!refTotals[ref]) {
            const v = vehicleByRef[ref.toUpperCase().trim()] ?? vehicleByPlate[ref.toUpperCase().replace(/[^A-Z0-9]/g, '')] ?? null;
            refTotals[ref] = { liters: 0, cap: v?.tank_capacity_liters ? Number(v.tank_capacity_liters) : null };
          }
          refTotals[ref].liters += ins.liters;
        });
        // Flag if total liters in batch > capacity × 3
        Object.entries(refTotals).forEach(([ref, data]) => {
          if (data.cap && data.liters > data.cap * 3) {
            inserts.forEach(ins => { if (ins.fuel_card_reference === ref) ins.flag_excessive_consumption = true; });
          }
        });
      }

      // Insert in batches of 100
      let totalInserted = 0;
      for (let i = 0; i < inserts.length; i += 100) {
        const batch = inserts.slice(i, i + 100);
        const { error } = await supabase.from('fuel_card_transactions').insert(batch);
        if (error) throw error;
        totalInserted += batch.length;
      }

      const flagCount = inserts.filter(i => i.flag_over_capacity || i.flag_multiple_same_day || i.flag_excessive_consumption).length;
      setResult({ imported: totalInserted, flags: flagCount });
      setStep(3);
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? 'Import mislukt');
    } finally {
      setImporting(false);
    }
  };

  const mapFields: { key: keyof ColMap; label: string; required: boolean }[] = [
    { key: 'datum', label: 'Datum', required: true },
    { key: 'kenteken', label: 'Kenteken / Referentie', required: true },
    { key: 'liters', label: 'Liters', required: true },
    { key: 'bedrag', label: 'Bedrag (EUR)', required: true },
    { key: 'prijs', label: 'Prijs per liter', required: false },
    { key: 'station', label: 'Station', required: false },
  ];

  const canImport = colMap.datum && colMap.kenteken && colMap.liters && colMap.bedrag;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>Transactielijst importeren</SheetTitle></SheetHeader>

        {step === 1 && (
          <div className="mt-6 space-y-4">
            <Label>Selecteer bestand</Label>
            <Input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <p className="text-xs text-muted-foreground">Q8 Liberty wekelijkse export (.csv of .xlsx)</p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6 space-y-6">
            {/* Preview */}
            <div>
              <p className="text-sm font-medium mb-2">Preview ({rows.length} rijen)</p>
              <div className="rounded border overflow-auto max-h-40 text-xs">
                <table className="w-full">
                  <thead><tr className="bg-muted">{headers.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">{headers.map(h => <td key={h} className="px-2 py-1 truncate max-w-[120px]">{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Column mapping */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Kolom mapping</p>
              {mapFields.map(f => (
                <div key={f.key} className="grid grid-cols-2 gap-2 items-center">
                  <Label className="text-sm">{f.label}{f.required && ' *'}</Label>
                  <Select value={colMap[f.key]} onValueChange={v => setColMap(p => ({ ...p, [f.key]: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecteer kolom" /></SelectTrigger>
                    <SelectContent>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Annuleren</Button>
              <Button onClick={handleImport} disabled={!canImport || importing}>
                {importing ? 'Importeren...' : `Importeer ${rows.length} rijen`}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && !result && (
          <div className="mt-6 space-y-6">
            {autoDetected && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-900">
                  <strong>Q8-formaat herkend</strong> — kolom-mapping is automatisch ingesteld. Klik <strong>Vorige</strong> om handmatig aan te passen.
                </div>
              </div>
            )}
            <div>
              <p className="text-sm font-medium mb-2">Preview ({rows.length} rijen)</p>
              <div className="rounded border overflow-auto max-h-40 text-xs">
                <table className="w-full">
                  <thead><tr className="bg-muted">{headers.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">{headers.map(h => <td key={h} className="px-2 py-1 truncate max-w-[120px]">{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>Vorige</Button>
              <Button onClick={handleImport} disabled={!canImport || importing}>
                {importing ? 'Importeren...' : `Importeer ${rows.length} rijen`}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="mt-6 space-y-4 text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <p className="text-lg font-semibold">{result.imported} transacties geïmporteerd</p>
            {result.flags > 0 ? (
              <Badge variant="destructive" className="text-sm">{result.flags} afwijkingen gedetecteerd</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Geen afwijkingen gevonden</p>
            )}
            <Button className="mt-4" onClick={() => { reset(); onOpenChange(false); }}>Sluiten</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default FuelCardAnalysis;
