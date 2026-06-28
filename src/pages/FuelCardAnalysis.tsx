import { useEffect, useId, useState, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useFuelCardData } from '@/hooks/useFuelCardData';
import { getDrivingDistance } from '@/lib/distance';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { formatDate, formatEUR } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import {
  isLikelyVehiclePlateReference, normalizeVehicleRef, displayPlate, clampNumber,
  appendFlagNote, isoDate, currentWeekStart, dateInRange,
  countWorkDays, haversineKm, DEFAULT_FUEL_CONDITIONS,
} from '@/lib/fuel-analysis';
import type { FuelAnalysisConditions, FuelAnalysisDataQuality } from '@/lib/fuel-analysis';
import { Upload, AlertTriangle, CheckCircle2, StickyNote, Car, UserRound, CreditCard, Trash2, Settings2, Save, Info, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subWeeks } from 'date-fns';
import { readExcelObjects } from '@/lib/spreadsheet';

/* ─── helpers ────────────────────────────────────────────── */

// Toon-versie van het kenteken: bij voorkeur de origineel uit Q8 (met streepjes),
// anders de opgeslagen license_plate, anders die van het gematchte voertuig.
const now = new Date();
const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

/* ─── Component ──────────────────────────────────────────── */

const FuelCardAnalysis = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState(currentWeekStart());
  const [deleteImportId, setDeleteImportId] = useState<string | null>(null);

  /* ── Datalaag (zie useFuelCardData) ──────────────── */

  const {
    conditions,
    transactions,
    dataQuality,
    imports,
    markReviewed,
    saveNote,
    saveConditions,
    deleteImport,
  } = useFuelCardData();

  /* ── Afgeleide weergave-data ─────────────────────── */

  const thisMonth = useMemo(() => transactions.filter(t => t.transaction_date >= monthStart && t.transaction_date <= monthEnd), [transactions]);
  const flagged = useMemo(() => transactions.filter(t => !t.reviewed && (t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption)), [transactions]);
  const allFlagged = useMemo(() => transactions.filter(t => t.flag_over_capacity || t.flag_multiple_same_day || t.flag_excessive_consumption), [transactions]);
  const transactionsWithoutVehicle = useMemo(() => transactions.filter(t => !t.vehicle_id).length, [transactions]);
  const selectedWeekEnd = useMemo(
    () => isoDate(endOfWeek(new Date(`${selectedWeekStart}T00:00:00`), { weekStartsOn: 1 })),
    [selectedWeekStart],
  );
  const weeklyOpenFlags = useMemo(
    () => flagged.filter(t => dateInRange(t.transaction_date, selectedWeekStart, selectedWeekEnd)),
    [flagged, selectedWeekStart, selectedWeekEnd],
  );
  const weeklyAllTransactions = useMemo(
    () => transactions.filter(t => dateInRange(t.transaction_date, selectedWeekStart, selectedWeekEnd)),
    [transactions, selectedWeekStart, selectedWeekEnd],
  );
  const weeklyAllFlags = useMemo(
    () => allFlagged.filter(t => dateInRange(t.transaction_date, selectedWeekStart, selectedWeekEnd)),
    [allFlagged, selectedWeekStart, selectedWeekEnd],
  );

  /* ── KPIs ────────────────────────────────────────── */

  const totalLiters = thisMonth.reduce((s, t) => s + Number(t.liters), 0);
  const totalAmount = thisMonth.reduce((s, t) => s + Number(t.amount_eur), 0);
  const flagCount = allFlagged.length;

  /* ── Afgeleide import-data ───────────────────────── */

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

      <FuelDataQualityCard stats={dataQuality} transactionsWithoutVehicle={transactionsWithoutVehicle} />

      {/* Tabs */}
      <Tabs defaultValue="flags">
        <TabsList>
          <TabsTrigger value="flags">Afwijkingen{flagged.length > 0 && ` (${flagged.length})`}</TabsTrigger>
          <TabsTrigger value="weekly">Weekoverzicht</TabsTrigger>
          <TabsTrigger value="all">Alle transacties</TabsTrigger>
          <TabsTrigger value="conditions">Voorwaarden</TabsTrigger>
          <TabsTrigger value="history">Import geschiedenis</TabsTrigger>
        </TabsList>

        {/* ── Afwijkingen ───────────────────────────── */}
        <TabsContent value="flags" className="space-y-4 mt-4">
          {flagged.length === 0 ? (
            <p className="text-sm text-muted-foreground">Geen openstaande afwijkingen</p>
          ) : flagged.map(t => <FlagCard key={t.id} t={t} onReview={() => markReviewed.mutate(t.id)} onSaveNote={(note) => saveNote.mutate({ id: t.id, note })} />)}
        </TabsContent>

        {/* ── Wekelijks overzicht ───────────────────── */}
        <TabsContent value="weekly" className="mt-4">
          <WeeklyOverview
            weekStart={selectedWeekStart}
            weekEnd={selectedWeekEnd}
            onWeekStartChange={setSelectedWeekStart}
            transactions={weeklyAllTransactions}
            allFlags={weeklyAllFlags}
            openFlags={weeklyOpenFlags}
            onReview={(id) => markReviewed.mutate(id)}
            onSaveNote={(id, note) => saveNote.mutate({ id, note })}
          />
        </TabsContent>

        {/* ── Alle transacties ──────────────────────── */}
        <TabsContent value="all" className="mt-4">
          <AllTransactionsTable data={transactions} />
        </TabsContent>

        {/* ── Voorwaarden ───────────────────────────── */}
        <TabsContent value="conditions" className="mt-4">
          <ConditionsTab conditions={conditions} onSave={(next) => saveConditions.mutate(next)} saving={saveConditions.isPending} />
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
        conditions={conditions}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['fuel-transactions'] });
          qc.invalidateQueries({ queryKey: ['fuel-card-imports'] });
          qc.invalidateQueries({ queryKey: ['fuel-analysis-data-quality'] });
          qc.invalidateQueries({ queryKey: ['vehicles'] });
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
              onClick={() => deleteImportId && deleteImport.mutate(deleteImportId, { onSuccess: () => setDeleteImportId(null) })}
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

const FuelDataQualityCard = ({ stats, transactionsWithoutVehicle }: {
  stats: FuelAnalysisDataQuality | undefined;
  transactionsWithoutVehicle: number;
}) => {
  if (!stats) return null;

  const items = [
    { label: 'Tankpas ontbreekt', value: stats.withoutFuelCard },
    { label: 'Tankinhoud ontbreekt', value: stats.withoutTankCapacity },
    { label: 'Verbruik ontbreekt', value: stats.withoutConsumption },
    { label: 'Kilometerstand ontbreekt', value: stats.withoutMileage },
    { label: 'Aantal deuren ontbreekt', value: stats.withoutDoors },
    { label: 'Zitplaatsen ontbreken', value: stats.withoutSeats },
    { label: 'Transacties zonder voertuig', value: transactionsWithoutVehicle },
  ];
  const hasIssues = items.some((item) => item.value > 0);

  return (
    <Card className={`mb-6 ${hasIssues ? 'border-amber-200 bg-amber-50/50' : 'border-green-200 bg-green-50/50'}`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-3">
          {hasIssues ? <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5" /> : <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />}
          <div>
            <p className="text-sm font-semibold">Datakwaliteit voor analyse</p>
            <p className="text-xs text-muted-foreground">{stats.vehiclesTotal} voertuigen in fleetbeheer</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="rounded-md border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-lg font-semibold ${item.value > 0 ? 'text-amber-700' : 'text-green-700'}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

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
            <Link to={`/transport/${t.vehicles.id}`} className="text-foreground hover:hover:underline font-mono font-semibold inline-flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5" />
              {plate}
            </Link>
          ) : plate ? (
            <span className="font-mono font-semibold text-foreground inline-flex items-center gap-1.5">
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
            <Link to={`/medewerkers/${t.employees.id}`} className="hover:underline inline-flex items-center gap-1.5">
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

const WeeklyOverview = ({ weekStart, weekEnd, onWeekStartChange, transactions, allFlags, openFlags, onReview, onSaveNote }: {
  weekStart: string;
  weekEnd: string;
  onWeekStartChange: (value: string) => void;
  transactions: any[];
  allFlags: any[];
  openFlags: any[];
  onReview: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
}) => {
  const weekOptions = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 8 }, (_, index) => {
      const start = subWeeks(base, index);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      return { value: isoDate(start), label: `${format(start, 'dd-MM-yyyy')} t/m ${format(end, 'dd-MM-yyyy')}` };
    });
  }, []);
  const greenCount = Math.max(0, transactions.length - allFlags.length);
  const reviewedFlags = allFlags.filter(t => t.reviewed).length;
  const redCount = allFlags.filter(t => t.flag_over_capacity || t.flag_multiple_same_day).length;
  const orangeCount = Math.max(0, allFlags.length - redCount);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 pb-5 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarDays className="h-4 w-4 text-stat-blue" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Wekelijks Q8-overzicht</h2>
                <p className="text-sm text-muted-foreground">
                  Groen blijft uit de werklijst; alleen open oranje/rode afwijkingen staan hieronder.
                </p>
              </div>
            </div>
            <Select value={weekStart} onValueChange={onWeekStartChange}>
              <SelectTrigger className="w-full md:w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {weekOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <WeeklyStat label="Periode" value={`${formatDate(weekStart)} - ${formatDate(weekEnd)}`} />
            <WeeklyStat label="Groen automatisch door" value={greenCount.toString()} tone="green" />
            <WeeklyStat label="Oranje" value={orangeCount.toString()} tone={orangeCount > 0 ? 'orange' : 'green'} />
            <WeeklyStat label="Rood" value={redCount.toString()} tone={redCount > 0 ? 'red' : 'green'} />
            <WeeklyStat label="Afgehandeld" value={reviewedFlags.toString()} />
          </div>
        </CardContent>
      </Card>

      {openFlags.length === 0 ? (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-5 pb-5 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-700" />
            <p className="text-sm font-medium">Geen openstaande Q8-afwijkingen voor deze week.</p>
          </CardContent>
        </Card>
      ) : (
        openFlags.map(t => (
          <FlagCard
            key={t.id}
            t={t}
            onReview={() => onReview(t.id)}
            onSaveNote={(note) => onSaveNote(t.id, note)}
          />
        ))
      )}
    </div>
  );
};

const WeeklyStat = ({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'orange' | 'red' }) => {
  const toneClass = {
    default: '',
    green: 'border-green-200 bg-green-50 text-green-800',
    orange: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-destructive/30 bg-destructive/5 text-destructive',
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
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
              <TableCell className="font-mono font-semibold text-foreground">
                {t.vehicles ? (
                  <Link to={`/transport/${t.vehicles.id}`} className="text-foreground hover:hover:underline">{plate}</Link>
                ) : plate ? (
                  <span>{plate}</span>
                ) : (
                  <span className="text-xs italic text-muted-foreground font-normal">Kaart {t.fuel_card_reference || '—'}</span>
                )}
              </TableCell>
              <TableCell>
                {empName && t.employees?.id ? (
                  <Link to={`/medewerkers/${t.employees.id}`} className="text-foreground hover:hover:underline font-medium">{empName}</Link>
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

/* ─── Conditions ─────────────────────────────────────────── */

const ConditionsTab = ({ conditions, onSave, saving }: {
  conditions: FuelAnalysisConditions;
  onSave: (next: FuelAnalysisConditions) => void;
  saving: boolean;
}) => {
  const [draft, setDraft] = useState<FuelAnalysisConditions>(conditions);

  useEffect(() => {
    setDraft(conditions);
  }, [conditions]);

  const setBool = (key: keyof FuelAnalysisConditions, value: boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setNumber = (key: keyof FuelAnalysisConditions, value: string, fallback: number, min: number, max: number) => {
    setDraft((current) => ({ ...current, [key]: clampNumber(value, fallback, min, max) }));
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Settings2 className="h-4 w-4 text-stat-blue" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Analysevoorwaarden</h2>
            <p className="text-sm text-muted-foreground">
              Deze regels worden gebruikt bij nieuwe tankpasimports en blijven per organisatie bewaard.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ConditionRow
            title="Meerdere tankbeurten per dag"
            description="Markeer dezelfde tankpas of referentie wanneer die op één dag meerdere transacties heeft."
            enabled={draft.multiple_same_day_enabled}
            onEnabled={(v) => setBool('multiple_same_day_enabled', v)}
          />

          <ConditionRow
            title="Boven tankcapaciteit"
            description="Vergelijk liters met de voertuigspecifieke tankinhoud plus marge."
            enabled={draft.tank_capacity_enabled}
            onEnabled={(v) => setBool('tank_capacity_enabled', v)}
          >
            <NumberField
              label="Marge (%)"
              value={draft.tank_capacity_margin_pct}
              onChange={(value) => setNumber('tank_capacity_margin_pct', value, DEFAULT_FUEL_CONDITIONS.tank_capacity_margin_pct, 0, 100)}
            />
          </ConditionRow>

          <ConditionRow
            title="Verbruik op basis van kilometerstand"
            description="Vergelijk getankte liters met gereden kilometers en gemengd verbruik."
            enabled={draft.consumption_enabled}
            onEnabled={(v) => setBool('consumption_enabled', v)}
          >
            <NumberField
              label="Marge (%)"
              value={draft.consumption_margin_pct}
              onChange={(value) => setNumber('consumption_margin_pct', value, DEFAULT_FUEL_CONDITIONS.consumption_margin_pct, 0, 300)}
            />
          </ConditionRow>

          <ConditionRow
            title="Verbruik op basis van woonadres en werklocatie"
            description="Vergelijk liters met woon-werkafstand, werkrooster en gemiddeld voertuigverbruik."
            enabled={draft.route_consumption_enabled}
            onEnabled={(v) => setBool('route_consumption_enabled', v)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Marge (%)"
                value={draft.route_consumption_margin_pct}
                onChange={(value) => setNumber('route_consumption_margin_pct', value, DEFAULT_FUEL_CONDITIONS.route_consumption_margin_pct, 0, 300)}
              />
              <NumberField
                label="Routefactor"
                value={draft.route_distance_multiplier}
                onChange={(value) => setNumber('route_distance_multiplier', value, DEFAULT_FUEL_CONDITIONS.route_distance_multiplier, 1, 2.5)}
              />
            </div>
          </ConditionRow>

          <ConditionRow
            title="Onlogische kilometerstand"
            description="Markeer dalende standen of sprongen boven de ingestelde kilometergrens."
            enabled={draft.mileage_jump_enabled}
            onEnabled={(v) => setBool('mileage_jump_enabled', v)}
          >
            <NumberField
              label="Max. sprong (km)"
              value={draft.mileage_jump_max_km}
              onChange={(value) => setNumber('mileage_jump_max_km', value, DEFAULT_FUEL_CONDITIONS.mileage_jump_max_km, 1, 5000)}
            />
          </ConditionRow>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => onSave(draft)} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" /> {saving ? 'Opslaan...' : 'Voorwaarden opslaan'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const ConditionRow = ({ title, description, enabled, onEnabled, children }: {
  title: string;
  description: string;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  children?: ReactNode;
}) => (
  <div className="rounded-md border p-4 space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch checked={enabled} onCheckedChange={onEnabled} />
    </div>
    {children && <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>{children}</div>}
  </div>
);

const NumberField = ({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) => {
  const id = useId();
  return (
    <div className="space-y-1.5 max-w-40">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
};

/* ─── Import Sheet ──────────────────────────────────────── */

type ColMap = {
  datum: string;
  kenteken: string;
  kaartnummer: string;
  liters: string;
  bedrag: string;
  prijs: string;
  station: string;
};

const EMPTY_COL_MAP: ColMap = { datum: '', kenteken: '', kaartnummer: '', liters: '', bedrag: '', prijs: '', station: '' };
const Q8_CARD_COLUMN = 'Kaartnummer';
const Q8_PLATE_COLUMN = 'Kentekenplaat';
const Q8_REFERENCE_COLUMN = 'Referentie kaartgebruik';
const Q8_SIGNATURE = [Q8_CARD_COLUMN, 'Hoeveelheid', 'transactie datum'];
const q8PresetForHeaders = (headers: string[]): ColMap => ({
  datum: 'transactie datum',
  kenteken: headers.includes(Q8_REFERENCE_COLUMN) ? Q8_REFERENCE_COLUMN : Q8_PLATE_COLUMN,
  kaartnummer: headers.includes(Q8_CARD_COLUMN) ? Q8_CARD_COLUMN : '',
  liters: 'Hoeveelheid',
  bedrag: 'Bedrag incl BTW',
  prijs: 'Pompprijs incl. BTW',
  station: 'Site',
});

type ExistingImport = { id: string; file_name: string | null; transaction_count: number; created_at: string };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ImportSheet = ({ open, onOpenChange, orgId, conditions, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string | null;
  conditions: FuelAnalysisConditions;
  onDone: () => void;
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<ColMap>(EMPTY_COL_MAP);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; flags: number; kmUpdates: number; fuelCardUpdates: number } | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; hash: string } | null>(null);
  const [existing, setExisting] = useState<ExistingImport | null>(null);

  const reset = () => {
    setStep(1); setRows([]); setHeaders([]);
    setColMap(EMPTY_COL_MAP);
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

    if (/\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name)) {
      toast.error('Oude .xls-bestanden worden niet ondersteund. Sla het bestand op als .xlsx of CSV.');
      return;
    }

    const isExcel = /\.xlsx$/i.test(file.name);
    if (isExcel) {
      try {
        const { headers: headersList, rows: stringRows } = await readExcelObjects(buffer);
        if (stringRows.length === 0) {
          toast.error('Excel-bestand bevat geen data');
          return;
        }
        setHeaders(headersList);
        setRows(stringRows);

        const isQ8 = Q8_SIGNATURE.every((h) => headersList.includes(h))
          && (headersList.includes(Q8_REFERENCE_COLUMN) || headersList.includes(Q8_PLATE_COLUMN));
        if (isQ8) {
          setColMap(q8PresetForHeaders(headersList));
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
        const fields = res.meta.fields ?? [];
        setHeaders(fields);
        setRows(res.data as Record<string, string>[]);
        const isQ8 = Q8_SIGNATURE.every((h) => fields.includes(h))
          && (fields.includes(Q8_REFERENCE_COLUMN) || fields.includes(Q8_PLATE_COLUMN));
        if (isQ8) {
          setColMap(q8PresetForHeaders(fields));
          setAutoDetected(true);
          setStep(3);
        } else {
          setAutoDetected(false);
          setStep(2);
        }
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
        await unwrap(supabase.from('fuel_card_transactions').delete().eq('import_batch_id', existing.id));
        await unwrap(supabase.from('fuel_card_imports').delete().eq('id', existing.id));
      }

      // Fetch vehicles, active assignments and active placements for matching.
      const { data: vehicles } = await supabase.from('vehicles').select('id, license_plate, fuel_card_reference, tank_capacity_liters, avg_consumption_per_100km, current_mileage').eq('organization_id', orgId);
      const { data: assignments } = await supabase
        .from('vehicle_assignments')
        .select('vehicle_id, employee_id, employees(id, candidate_id, candidates(first_name, last_name, address_lat, address_lng))')
        .is('returned_date', null);
      const { data: placements } = await supabase
        .from('placements')
        .select('id, candidate_id, employee_id, start_date, end_date, status, work_days, work_location, companies!placements_company_id_fkey(name, address_lat, address_lng, visit_address_lat, visit_address_lng)')
        .eq('organization_id', orgId)
        .in('status', ['actief', 'gepland']);

      const vehicleByPlate: Record<string, any> = {};
      const vehicleByRef: Record<string, any> = {};
      const vehicleById: Record<string, any> = {};
      (vehicles ?? []).forEach(v => {
        vehicleById[v.id] = v;
        if (v.license_plate) vehicleByPlate[normalizeVehicleRef(v.license_plate)] = v;
        if (v.fuel_card_reference) {
          vehicleByRef[v.fuel_card_reference.toUpperCase().trim()] = v;
          vehicleByRef[normalizeVehicleRef(v.fuel_card_reference)] = v;
        }
      });
      const assignmentByVehicle: Record<string, string> = {};
      const candidateByVehicle: Record<string, any> = {};
      (assignments ?? []).forEach((a: any) => {
        assignmentByVehicle[a.vehicle_id] = a.employee_id;
        const candidate = a.employees?.candidates ?? null;
        if (candidate) {
          candidateByVehicle[a.vehicle_id] = {
            id: a.employees?.candidate_id ?? null,
            ...candidate,
          };
        }
      });
      const placementsByCandidate: Record<string, any[]> = {};
      (placements ?? []).forEach((placement: any) => {
        if (!placement.candidate_id) return;
        if (!placementsByCandidate[placement.candidate_id]) placementsByCandidate[placement.candidate_id] = [];
        placementsByCandidate[placement.candidate_id].push(placement);
      });

      const inserts: any[] = [];
      const rowMeta: Array<{ vehicleId: string | null; odometer: number | null; transactionDate: string; rowIndex: number }> = [];
      const maxKmByVehicle: Record<string, number> = {};
      const fuelCardByVehicle: Record<string, string> = {};
      const readCell = (row: Record<string, string>, column: string) => (column ? String(row[column] ?? '').trim() : '');
      // Oudere Q8 exports hadden soms lege kentekenregels. Alleen dan vullen
      // we door; zodra `Referentie kaartgebruik` bestaat, is die leidend per rij.
      const canForwardFillPlate = !headers.includes(Q8_REFERENCE_COLUMN);
      let lastPlateRef = '';
      for (const row of rows) {
        const rawDate = readCell(row, colMap.datum);
        const mappedRef = readCell(row, colMap.kenteken);
        const referenceUsage = readCell(row, Q8_REFERENCE_COLUMN);
        const q8Plate = readCell(row, Q8_PLATE_COLUMN);
        const rawCard = readCell(row, colMap.kaartnummer) || readCell(row, Q8_CARD_COLUMN);
        const plateCandidate = [mappedRef, referenceUsage, q8Plate].find(isLikelyVehiclePlateReference) ?? '';
        if (plateCandidate) lastPlateRef = plateCandidate;
        const rawRef = plateCandidate || (canForwardFillPlate ? lastPlateRef : '') || mappedRef || referenceUsage || q8Plate;
        const displayPlateRef = (isLikelyVehiclePlateReference(q8Plate) ? q8Plate : plateCandidate) || '';
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

        const normalRef = normalizeVehicleRef(rawRef);
        const normalCard = normalizeVehicleRef(rawCard);
        const vehicle = vehicleByPlate[normalRef]
          ?? vehicleByRef[rawRef.toUpperCase().trim()]
          ?? (normalCard ? vehicleByRef[normalCard] : null)
          ?? (rawCard ? vehicleByRef[rawCard.toUpperCase().trim()] : null);
        const vehicleId = vehicle?.id ?? null;
        const employeeId = vehicleId ? (assignmentByVehicle[vehicleId] ?? null) : null;
        const candidateId = vehicleId ? (candidateByVehicle[vehicleId]?.id ?? null) : null;
        if (vehicleId && rawCard && !fuelCardByVehicle[vehicleId]) {
          fuelCardByVehicle[vehicleId] = rawCard;
        }

        // Fraud checks
        let flagOverCap = false;
        if (conditions.tank_capacity_enabled && vehicle?.tank_capacity_liters) {
          const maxLiters = Number(vehicle.tank_capacity_liters) * (1 + conditions.tank_capacity_margin_pct / 100);
          flagOverCap = liters > maxLiters;
        }

        const odometer = parseFloat(rawKm);
        const validOdometer = Number.isFinite(odometer) && odometer > 0 ? odometer : null;

        // raw_data krijgt een ingevuld kenteken zodat blanco Q8-velden ook
        // het juiste kenteken tonen, zonder algemene tankpassen als kenteken te tonen.
        const filledRow = displayPlateRef && !row[Q8_PLATE_COLUMN]
          ? { ...row, [Q8_PLATE_COLUMN]: displayPlateRef }
          : row;

        const insertIndex = inserts.length;
        inserts.push({
          organization_id: orgId,
          import_batch_id: batchId,
          fuel_card_reference: rawCard || rawRef.trim(),
          license_plate: (displayPlateRef || vehicle?.license_plate || '').toUpperCase() || null,
          transaction_date: parsedDate,
          liters,
          amount_eur: amount,
          price_per_liter: price,
          station_name: rawStation?.trim() || null,
          vehicle_id: vehicleId,
          employee_id: employeeId,
          candidate_id: candidateId,
          flag_over_capacity: flagOverCap,
          raw_data: filledRow,
        });
        rowMeta[insertIndex] = {
          vehicleId,
          odometer: validOdometer,
          transactionDate: parsedDate,
          rowIndex: insertIndex,
        };

        if (vehicleId && validOdometer != null) {
          if (Number.isFinite(validOdometer) && validOdometer > 0) {
            maxKmByVehicle[vehicleId] = Math.max(maxKmByVehicle[vehicleId] ?? 0, validOdometer);
          }
        }
      }

      // Detect same-day multiples
      if (conditions.multiple_same_day_enabled) {
        const dayGroups: Record<string, number[]> = {};
        inserts.forEach((ins, i) => {
          const key = `${ins.fuel_card_reference}__${ins.transaction_date}`;
          if (!dayGroups[key]) dayGroups[key] = [];
          dayGroups[key].push(i);
        });
        Object.values(dayGroups).forEach(indices => {
          if (indices.length >= 2) indices.forEach(i => { inserts[i].flag_multiple_same_day = true; });
        });
      }

      // Consumption and odometer checks based on Q8 kilometerstanden.
      if (conditions.consumption_enabled || conditions.mileage_jump_enabled) {
        const byVehicle: Record<string, typeof rowMeta> = {};
        rowMeta.forEach((meta) => {
          if (!meta.vehicleId || meta.odometer == null) return;
          if (!byVehicle[meta.vehicleId]) byVehicle[meta.vehicleId] = [];
          byVehicle[meta.vehicleId].push(meta);
        });

        Object.entries(byVehicle).forEach(([vehicleId, metas]) => {
          const sorted = [...metas].sort((a, b) => {
            const dateCmp = a.transactionDate.localeCompare(b.transactionDate);
            return dateCmp !== 0 ? dateCmp : a.rowIndex - b.rowIndex;
          });
          const vehicle = vehicleById[vehicleId];
          const avgConsumption = Number(vehicle?.avg_consumption_per_100km);
          let lastKm: number | null = null;
          const currentMileage = Number(vehicle?.current_mileage);
          if (Number.isFinite(currentMileage) && currentMileage > 0 && sorted[0]?.odometer && currentMileage < sorted[0].odometer) {
            lastKm = currentMileage;
          }

          sorted.forEach((meta) => {
            const insert = inserts[meta.rowIndex];
            if (meta.odometer == null) return;

            if (lastKm != null) {
              const distance = meta.odometer - lastKm;
              if (conditions.mileage_jump_enabled && distance <= 0) {
                insert.flag_excessive_consumption = true;
                appendFlagNote(insert, `Kilometerstand niet oplopend: ${meta.odometer} km na ${lastKm} km.`);
              } else if (conditions.mileage_jump_enabled && distance > conditions.mileage_jump_max_km) {
                insert.flag_excessive_consumption = true;
                appendFlagNote(insert, `Kilometersprong ${Math.round(distance)} km boven grens ${conditions.mileage_jump_max_km} km.`);
              }

              if (
                conditions.consumption_enabled
                && distance > 0
                && Number.isFinite(avgConsumption)
                && avgConsumption > 0
              ) {
                const expectedLiters = (distance * avgConsumption) / 100;
                const allowedLiters = expectedLiters * (1 + conditions.consumption_margin_pct / 100);
                if (insert.liters > allowedLiters) {
                  insert.flag_excessive_consumption = true;
                  appendFlagNote(
                    insert,
                    `Verbruik ${insert.liters.toFixed(1)}L bij ${Math.round(distance)} km; verwacht ca. ${expectedLiters.toFixed(1)}L + ${conditions.consumption_margin_pct}% marge.`,
                  );
                }
              }
            }

            lastKm = meta.odometer;
          });
        });
      }

      // Route-based consumption check: home address -> active work location.
      if (conditions.route_consumption_enabled) {
        const byVehicle: Record<string, typeof rowMeta> = {};
        rowMeta.forEach((meta) => {
          if (!meta.vehicleId) return;
          if (!byVehicle[meta.vehicleId]) byVehicle[meta.vehicleId] = [];
          byVehicle[meta.vehicleId].push(meta);
        });

        const distanceCache = new Map<string, { distanceKm: number; source: 'mapbox' | 'estimated' } | null>();
        const getRouteDistance = async (homeLat: number, homeLng: number, workLat: number, workLng: number) => {
          const key = `${homeLat},${homeLng}__${workLat},${workLng}`;
          if (distanceCache.has(key)) return distanceCache.get(key) ?? null;
          const driving = await getDrivingDistance(homeLat, homeLng, workLat, workLng);
          const result = driving?.distanceKm
            ? { distanceKm: driving.distanceKm, source: 'mapbox' as const }
            : {
              distanceKm: Math.round(haversineKm(homeLat, homeLng, workLat, workLng) * conditions.route_distance_multiplier * 10) / 10,
              source: 'estimated' as const,
            };
          distanceCache.set(key, result);
          return result;
        };

        for (const [vehicleId, metas] of Object.entries(byVehicle)) {
          const vehicle = vehicleById[vehicleId];
          const avgConsumption = Number(vehicle?.avg_consumption_per_100km);
          const candidate = candidateByVehicle[vehicleId];
          if (!candidate?.id || !Number.isFinite(avgConsumption) || avgConsumption <= 0) continue;
          if (!Number.isFinite(Number(candidate.address_lat)) || !Number.isFinite(Number(candidate.address_lng))) continue;

          const sorted = [...metas].sort((a, b) => {
            const dateCmp = a.transactionDate.localeCompare(b.transactionDate);
            return dateCmp !== 0 ? dateCmp : a.rowIndex - b.rowIndex;
          });
          let lastTransactionDate: string | null = null;

          for (const meta of sorted) {
            const insert = inserts[meta.rowIndex];
            const candidatePlacements = placementsByCandidate[candidate.id] ?? [];
            const placement = candidatePlacements.find((p: any) => (
              p.start_date <= meta.transactionDate
              && (!p.end_date || p.end_date >= meta.transactionDate)
            )) ?? candidatePlacements[0];
            const company = placement?.companies;
            const workLat = Number(company?.visit_address_lat ?? company?.address_lat);
            const workLng = Number(company?.visit_address_lng ?? company?.address_lng);
            if (!placement || !Number.isFinite(workLat) || !Number.isFinite(workLng)) continue;

            const route = await getRouteDistance(Number(candidate.address_lat), Number(candidate.address_lng), workLat, workLng);
            if (!route?.distanceKm) continue;

            const periodStart = lastTransactionDate
              ? isoDate(addDays(new Date(`${lastTransactionDate}T00:00:00`), 1))
              : isoDate(addDays(new Date(`${meta.transactionDate}T00:00:00`), -6));
            const workDayCount = countWorkDays(periodStart, meta.transactionDate, placement.work_days);
            const expectedKm = route.distanceKm * 2 * workDayCount;
            const expectedLiters = (expectedKm * avgConsumption) / 100;
            const allowedLiters = expectedLiters * (1 + conditions.route_consumption_margin_pct / 100);

            if (workDayCount > 0 && insert.liters > allowedLiters) {
              insert.flag_excessive_consumption = true;
              appendFlagNote(
                insert,
                `Woon-werkverbruik ${insert.liters.toFixed(1)}L; verwacht ca. ${expectedLiters.toFixed(1)}L voor ${Math.round(expectedKm)} km (${workDayCount} werkdagen, ${route.source === 'mapbox' ? 'rijafstand' : 'geschatte routeafstand'} ${route.distanceKm} km enkele reis) + ${conditions.route_consumption_margin_pct}% marge.`,
              );
            }

            lastTransactionDate = meta.transactionDate;
          }
        }
      }

      // Maak fuel_card_imports row met aggregaten — id wordt batchId
      if (inserts.length > 0 && fileMeta) {
        const totalLiters = inserts.reduce((s, i) => s + (Number(i.liters) || 0), 0);
        const totalAmount = inserts.reduce((s, i) => s + (Number(i.amount_eur) || 0), 0);
        const dates = inserts.map(i => i.transaction_date).filter(Boolean).sort();
        await unwrap(supabase.from('fuel_card_imports').insert({
          id: batchId,
          organization_id: orgId,
          file_hash: fileMeta.hash,
          file_name: fileMeta.name,
          transaction_count: inserts.length,
          total_liters: Math.round(totalLiters * 100) / 100,
          total_amount_eur: Math.round(totalAmount * 100) / 100,
          period_start: dates[0] ?? null,
          period_end: dates[dates.length - 1] ?? null,
        }));
      }

      // Insert in batches of 100
      let totalInserted = 0;
      for (let i = 0; i < inserts.length; i += 100) {
        const batch = inserts.slice(i, i + 100);
        await unwrap(supabase.from('fuel_card_transactions').insert(batch));
        totalInserted += batch.length;
      }

      // Update vehicles.current_mileage waar Q8 hoger is dan huidige stand
      let kmUpdates = 0;
      for (const [vehicleId, km] of Object.entries(maxKmByVehicle)) {
        const v = (vehicles ?? []).find(x => x.id === vehicleId);
        const current = Number(v?.current_mileage) || 0;
        if (km > current) {
          // eslint-disable-next-line no-restricted-syntax -- per-rij best-effort: bij fout doorgaan met de loop (geen throw), unwrap zou afbreken
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

      let fuelCardUpdates = 0;
      for (const [vehicleId, fuelCardReference] of Object.entries(fuelCardByVehicle)) {
        const v = (vehicles ?? []).find(x => x.id === vehicleId);
        const current = String(v?.fuel_card_reference ?? '').trim();
        if (fuelCardReference && current !== fuelCardReference) {
          // eslint-disable-next-line no-restricted-syntax -- per-rij best-effort: bij fout doorgaan met de loop (geen throw), unwrap zou afbreken
          const { error } = await supabase.from('vehicles').update({ fuel_card_reference: fuelCardReference }).eq('id', vehicleId);
          if (!error) {
            fuelCardUpdates += 1;
            void logAudit({
              action: 'update',
              tableName: 'vehicles',
              recordId: vehicleId,
              oldValues: { fuel_card_reference: current || null },
              newValues: { fuel_card_reference: fuelCardReference },
              reason: 'q8-import-fuel-card-reference',
            });
          }
        }
      }

      const flagCount = inserts.filter(i => i.flag_over_capacity || i.flag_multiple_same_day || i.flag_excessive_consumption).length;
      setResult({ imported: totalInserted, flags: flagCount, kmUpdates, fuelCardUpdates });
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
    { key: 'kenteken', label: 'Kenteken', required: true },
    { key: 'kaartnummer', label: 'Tankpas / Kaartnummer', required: false },
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
            <Input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
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
            <CheckCircle2 className="h-12 w-12 text-stat-blue mx-auto" />
            <p className="text-lg font-semibold">{result.imported} transacties geïmporteerd</p>
            {result.flags > 0 ? (
              <Badge variant="destructive" className="text-sm">{result.flags} afwijkingen gedetecteerd</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Geen afwijkingen gevonden</p>
            )}
            {result.kmUpdates > 0 && (
              <p className="text-sm text-muted-foreground">{result.kmUpdates} voertuig{result.kmUpdates === 1 ? '' : 'en'} kilometerstand bijgewerkt</p>
            )}
            {result.fuelCardUpdates > 0 && (
              <p className="text-sm text-muted-foreground">{result.fuelCardUpdates} tankpas{result.fuelCardUpdates === 1 ? '' : 'sen'} aan kenteken gekoppeld</p>
            )}
            <Button className="mt-4" onClick={() => { reset(); onOpenChange(false); }}>Sluiten</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default FuelCardAnalysis;
