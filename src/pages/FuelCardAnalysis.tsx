import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useFuelCardData } from '@/hooks/useFuelCardData';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { formatDate, formatEUR } from '@/lib/format';
import { isoDate, currentWeekStart, dateInRange } from '@/lib/fuel-analysis';
import { Upload, Trash2 } from 'lucide-react';
import { endOfMonth, endOfWeek, format, startOfMonth } from 'date-fns';

import { KpiCard } from '@/components/fuel/KpiCard';
import { FuelDataQualityCard } from '@/components/fuel/FuelDataQualityCard';
import { FlagCard } from '@/components/fuel/FlagCard';
import { WeeklyOverview } from '@/components/fuel/WeeklyOverview';
import { AllTransactionsTable } from '@/components/fuel/AllTransactionsTable';
import { ConditionsTab } from '@/components/fuel/ConditionsTab';
import { ImportSheet } from '@/components/fuel/ImportSheet';

/* ─── helpers ────────────────────────────────────────────── */

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

export default FuelCardAnalysis;
