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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { Upload, AlertTriangle, Fuel, CheckCircle2, StickyNote, Link as LinkIcon, Info, Car, UserRound, CreditCard, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { startOfMonth, endOfMonth, format } from 'date-fns';

/* ─── helpers ────────────────────────────────────────────── */

// Toon-versie van het kenteken: bij voorkeur de origineel uit Q8 (met streepjes),
// anders de opgeslagen license_plate, anders die van het gematchte voertuig.
const displayPlate = (t: any): string => {
  const raw = (t?.raw_data?.['Kentekenplaat'] as string | undefined)?.trim();
  if (raw) return raw;
  if (t?.license_plate) return t.license_plate;
  if (t?.vehicles?.license_plate) return t.vehicles.license_plate;
  return '';
};

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

  /* ── Import history (uit fuel_card_imports tabel) ─ */

  const { data: imports = [] } = useQuery({
    queryKey: ['fuel-card-imports', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fuel_card_imports')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const flagsByBatch = useMemo(() => {
    const m: Record<string, number> = {};
    transactions.forEach(t => {
      if (!t.import_batch_id) return;
      if (t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption) {
        m[t.import_batch_id] = (m[t.import_batch_id] ?? 0) + 1;
      }
    });
    return m;
  }, [transactions]);

  const [deleteImportId, setDeleteImportId] = useState<string | null>(null);
  const deleteImport = useMutation({
    mutationFn: async (id: string) => {
      const { error: txErr } = await supabase.from('fuel_card_transactions').delete().eq('import_batch_id', id);
      if (txErr) throw txErr;
      const { error: impErr } = await supabase.from('fuel_card_imports').delete().eq('id', id);
      if (impErr) throw impErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuel-transactions'] });
      qc.invalidateQueries({ queryKey: ['fuel-card-imports'] });
      toast.success('Import verwijderd');
      setDeleteImportId(null);
    },
    onError: (e: any) => toast.error(e.message ?? 'Verwijderen mislukt'),
  });

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
                <TableHead>Bestand</TableHead>
                <TableHead>Geïmporteerd</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead className="text-right">Transacties</TableHead>
                <TableHead className="text-right">Liters</TableHead>
                <TableHead className="text-right">Bedrag</TableHead>
                <TableHead className="text-right">Afwijkingen</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map(imp => {
                const flags = flagsByBatch[imp.id] ?? 0;
                const periodLabel = imp.period_start && imp.period_end
                  ? `${formatDate(imp.period_start)} – ${formatDate(imp.period_end)}`
                  : '—';
                return (
                  <TableRow key={imp.id}>
                    <TableCell className="font-medium">{imp.file_name || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(imp.created_at)}</TableCell>
                    <TableCell className="text-xs">{periodLabel}</TableCell>
                    <TableCell className="text-right">{imp.transaction_count}</TableCell>
                    <TableCell className="text-right">{Number(imp.total_liters).toFixed(1)}</TableCell>
                    <TableCell className="text-right">{formatEUR(Number(imp.total_amount_eur))}</TableCell>
                    <TableCell className="text-right">{flags > 0 ? <Badge variant="destructive">{flags}</Badge> : '0'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteImportId(imp.id)}
                        title="Import verwijderen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {imports.length === 0 && <TableRow><TableCell colSpan={8} className="text-muted-foreground text-center">Geen imports</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      {/* Import Sheet */}
      <ImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        orgId={orgId}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['fuel-transactions'] });
          qc.invalidateQueries({ queryKey: ['fuel-card-imports'] });
        }}
      />

      <AlertDialog open={!!deleteImportId} onOpenChange={(o) => !o && setDeleteImportId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle transacties uit deze import worden ook verwijderd. Dit kan niet ongedaan gemaakt worden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteImportId && deleteImport.mutate(deleteImportId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

  const plate = displayPlate(t);

  return (
    <Card className="border-destructive/30">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-medium">{formatDate(t.transaction_date)}</span>

          {t.vehicles ? (
            <Link to={`/transport/${t.vehicles.id}`} className="text-primary hover:underline font-mono font-semibold inline-flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" />
              {plate}
            </Link>
          ) : plate ? (
            <span className="font-mono font-semibold inline-flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" />
              {plate}
              <span className="text-xs italic ml-1 font-normal text-muted-foreground">(geen voertuig-record)</span>
            </span>
          ) : (
            <span className="text-muted-foreground italic inline-flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Kaart {t.fuel_card_reference || '—'}
            </span>
          )}

          {empName && t.employees?.id ? (
            <Link to={`/medewerkers/${t.employees.id}`} className="text-primary hover:underline inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              {empName}
            </Link>
          ) : (
            <span className="text-muted-foreground italic inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              Geen toewijzing
            </span>
          )}

          <span className="ml-auto">{t.liters}L · {formatEUR(t.amount_eur)}</span>
          {t.station_name && <span className="text-xs text-muted-foreground">{t.station_name}</span>}
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
          const empName = emp ? `${emp.first_name} ${emp.last_name}` : null;
          const plate = displayPlate(t);
          const hasFlag = t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption;
          return (
            <TableRow key={t.id}>
              <TableCell>{formatDate(t.transaction_date)}</TableCell>
              <TableCell className="font-mono font-semibold">
                {t.vehicles ? (
                  <Link to={`/transport/${t.vehicles.id}`} className="text-primary hover:underline">{plate}</Link>
                ) : plate ? (
                  <span>{plate}</span>
                ) : (
                  <span className="text-xs italic text-muted-foreground font-normal">Kaart {t.fuel_card_reference || '—'}</span>
                )}
              </TableCell>
              <TableCell>
                {empName && t.employees?.id ? (
                  <Link to={`/medewerkers/${t.employees.id}`} className="text-primary hover:underline">{empName}</Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">{t.liters}</TableCell>
              <TableCell className="text-right">{formatEUR(t.amount_eur)}</TableCell>
              <TableCell>{t.station_name || <span className="text-muted-foreground">—</span>}</TableCell>
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

type ExistingImport = { id: string; file_name: string | null; transaction_count: number; created_at: string };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ImportSheet = ({ open, onOpenChange, orgId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null; onDone: () => void }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<ColMap>({ datum: '', kenteken: '', liters: '', bedrag: '', prijs: '', station: '' });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; flags: number; kmUpdates: number } | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; hash: string } | null>(null);
  const [existing, setExisting] = useState<ExistingImport | null>(null);

  const reset = () => {
    setStep(1); setRows([]); setHeaders([]);
    setColMap({ datum: '', kenteken: '', liters: '', bedrag: '', prijs: '', station: '' });
    setResult(null); setAutoDetected(false); setFileMeta(null); setExisting(null);
  };

  const handleFile = async (file: File) => {
    if (!orgId) return;
    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);
    setFileMeta({ name: file.name, hash });

    // Duplicate-check tegen fuel_card_imports
    const { data: dup } = await supabase
      .from('fuel_card_imports')
      .select('id, file_name, transaction_count, created_at')
      .eq('organization_id', orgId)
      .eq('file_hash', hash)
      .maybeSingle();
    if (dup) {
      setExisting(dup as ExistingImport);
    } else {
      setExisting(null);
    }

    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      try {
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
      } catch {
        toast.error('Excel parse fout');
      }
      return;
    }

    // CSV-pad
    const text = new TextDecoder().decode(buffer);
    Papa.parse(text, {
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
      // Vervang oude import als duplicate werd gedetecteerd
      if (existing) {
        const { error: delTxErr } = await supabase.from('fuel_card_transactions').delete().eq('import_batch_id', existing.id);
        if (delTxErr) throw delTxErr;
        const { error: delImpErr } = await supabase.from('fuel_card_imports').delete().eq('id', existing.id);
        if (delImpErr) throw delImpErr;
      }

      // Fetch vehicles for matching
      const { data: vehicles } = await supabase.from('vehicles').select('id, license_plate, fuel_card_reference, tank_capacity_liters, avg_consumption_per_100km, current_mileage').eq('organization_id', orgId);
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
      const maxKmByVehicle: Record<string, number> = {};
      // Q8 herhaalt het kenteken niet op vervolg-rijen — blanco kentekens
      // erven van de eerstvolgende niet-blanco rij erboven (forward-fill).
      let lastPlate = '';
      for (const row of rows) {
        const rawDate = row[colMap.datum] ?? '';
        const rowPlate = (row[colMap.kenteken] ?? '').trim();
        if (rowPlate) lastPlate = rowPlate;
        const rawRef = rowPlate || lastPlate;
        const rawLiters = row[colMap.liters] ?? '0';
        const rawAmount = row[colMap.bedrag] ?? '0';
        const rawPrice = colMap.prijs ? (row[colMap.prijs] ?? null) : null;
        const rawStation = colMap.station ? (row[colMap.station] ?? null) : null;
        const rawKm = String(row['Kilometerstand'] ?? '').replace(',', '.').trim();

        const liters = parseFloat(rawLiters.replace(',', '.')) || 0;
        const amount = parseFloat(rawAmount.replace(',', '.')) || 0;
        const price = rawPrice ? parseFloat(rawPrice.replace(',', '.')) || null : null;

        // Parse date — strip optional time-suffix (na spatie of T) voor regex/split.
        let parsedDate = '';
        const dateOnly = rawDate.trim().split(/[\sT]+/)[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
          parsedDate = dateOnly;
        } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateOnly)) {
          const [d, m, y] = dateOnly.split('-');
          parsedDate = `${y}-${m}-${d}`;
        } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateOnly)) {
          const [d, m, y] = dateOnly.split('/');
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

        // raw_data krijgt de forward-filled kenteken zodat blanco rijen ook
        // het juiste kenteken (met streepjes) tonen in de UI.
        const filledRow = rawRef && !row['Kentekenplaat']
          ? { ...row, Kentekenplaat: rawRef }
          : row;

        inserts.push({
          organization_id: orgId,
          import_batch_id: batchId,
          fuel_card_reference: rawRef.trim() || rawCard,
          // Kenteken-met-streepjes uit Q8 prefereren boven de stripped form in DB.
          license_plate: rawRef.trim().toUpperCase() || vehicle?.license_plate || null,
          transaction_date: parsedDate,
          liters,
          amount_eur: amount,
          price_per_liter: price,
          station_name: rawStation?.trim() || null,
          vehicle_id: vehicleId,
          employee_id: employeeId,
          flag_over_capacity: flagOverCap,
          raw_data: filledRow,
        });

        if (vehicleId) {
          const km = parseFloat(rawKm);
          if (Number.isFinite(km) && km > 0) {
            maxKmByVehicle[vehicleId] = Math.max(maxKmByVehicle[vehicleId] ?? 0, km);
          }
        }
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

      // Maak fuel_card_imports row met aggregaten — id wordt batchId
      if (inserts.length > 0 && fileMeta) {
        const totalLiters = inserts.reduce((s, i) => s + (Number(i.liters) || 0), 0);
        const totalAmount = inserts.reduce((s, i) => s + (Number(i.amount_eur) || 0), 0);
        const dates = inserts.map(i => i.transaction_date).filter(Boolean).sort();
        const { error: impErr } = await supabase.from('fuel_card_imports').insert({
          id: batchId,
          organization_id: orgId,
          file_hash: fileMeta.hash,
          file_name: fileMeta.name,
          transaction_count: inserts.length,
          total_liters: Math.round(totalLiters * 100) / 100,
          total_amount_eur: Math.round(totalAmount * 100) / 100,
          period_start: dates[0] ?? null,
          period_end: dates[dates.length - 1] ?? null,
        });
        if (impErr) throw impErr;
      }

      // Insert in batches of 100
      let totalInserted = 0;
      for (let i = 0; i < inserts.length; i += 100) {
        const batch = inserts.slice(i, i + 100);
        const { error } = await supabase.from('fuel_card_transactions').insert(batch);
        if (error) throw error;
        totalInserted += batch.length;
      }

      // Update vehicles.current_mileage waar Q8 hoger is dan huidige stand
      let kmUpdates = 0;
      for (const [vehicleId, km] of Object.entries(maxKmByVehicle)) {
        const v = (vehicles ?? []).find(x => x.id === vehicleId);
        const current = Number(v?.current_mileage) || 0;
        if (km > current) {
          const { error } = await supabase.from('vehicles').update({ current_mileage: km }).eq('id', vehicleId);
          if (!error) {
            kmUpdates += 1;
            void logAudit({
              action: 'update',
              tableName: 'vehicles',
              recordId: vehicleId,
              oldValues: { current_mileage: current },
              newValues: { current_mileage: km },
              reason: 'q8-import-km-update',
            });
          }
        }
      }

      const flagCount = inserts.filter(i => i.flag_over_capacity || i.flag_multiple_same_day || i.flag_excessive_consumption).length;
      setResult({ imported: totalInserted, flags: flagCount, kmUpdates });
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
            {existing && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  <strong>Dit bestand is eerder geïmporteerd</strong> — {existing.file_name ?? 'onbekend bestand'} op {formatDate(existing.created_at)} ({existing.transaction_count} transacties).
                  Bij <strong>Importeren</strong> wordt de oude import vervangen door deze nieuwe.
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
            {result.kmUpdates > 0 && (
              <p className="text-sm text-muted-foreground">{result.kmUpdates} voertuig{result.kmUpdates === 1 ? '' : 'en'} kilometerstand bijgewerkt</p>
            )}
            <Button className="mt-4" onClick={() => { reset(); onOpenChange(false); }}>Sluiten</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default FuelCardAnalysis;
