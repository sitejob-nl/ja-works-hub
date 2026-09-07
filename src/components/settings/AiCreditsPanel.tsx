import { useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import ErrorState from '@/components/shared/ErrorState';
import {
  useAiCreditLedger, useAiCreditRequests, useAiCreditSummary, useManageAiCredits, useLegacyAiUsage,
  type AiCreditSummary,
} from '@/hooks/useAiCredits';
import {
  aiFeatureLabel, aiLedgerKindLabel, aiRequestStatusLabel, formatAiCreditDate,
  formatAiCreditEuro, formatAiProviderUsd, parseAiCreditCents,
} from '@/lib/ai-credits';
import { toFriendlyError } from '@/lib/errorMessages';

type PendingTopup = { amountCents: number; note: string; requestId: string };
const pendingTopupKey = (orgId: string) => `ai-credit-topup:${orgId}`;
function readPendingTopup(orgId: string): PendingTopup | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingTopupKey(orgId)) ?? 'null');
    return saved && Number.isSafeInteger(saved.amountCents) && typeof saved.note === 'string'
      && typeof saved.requestId === 'string' ? saved : null;
  } catch {
    return null;
  }
}

function CreditMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function CreditManagement({ orgId, summary }: { orgId: string; summary: AiCreditSummary }) {
  const { topup, setAllowance } = useManageAiCredits(orgId);
  const pendingTopup = useRef<PendingTopup | null>(readPendingTopup(orgId));
  const [hasPendingTopup, setHasPendingTopup] = useState(!!pendingTopup.current);
  const [amount, setAmount] = useState(pendingTopup.current ? (pendingTopup.current.amountCents / 100).toFixed(2).replace('.', ',') : '');
  const [note, setNote] = useState(pendingTopup.current?.note ?? '');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [startMonth, setStartMonth] = useState('');

  useEffect(() => {
    setMonthlyAmount((summary.monthly_allowance_cents / 100).toFixed(2).replace('.', ','));
    setStartMonth((summary.monthly_start_month ?? summary.month_start).slice(0, 7));
  }, [summary.monthly_allowance_cents, summary.monthly_start_month, summary.month_start]);

  const bookTopup = async () => {
    const amountCents = parseAiCreditCents(amount);
    if (amountCents == null || amountCents === 0 || !note.trim()) {
      toast.error('Vul een bedrag met maximaal twee decimalen en een omschrijving in.');
      return;
    }
    // Keep this key after an error: a timeout may have occurred after the DB committed.
    try {
      if (!pendingTopup.current) {
        pendingTopup.current = { amountCents, note: note.trim(), requestId: crypto.randomUUID() };
      }
      // Survives a sheet close or reload while the server response is uncertain.
      sessionStorage.setItem(pendingTopupKey(orgId), JSON.stringify(pendingTopup.current));
      setHasPendingTopup(true);
      const balance = await topup.mutateAsync(pendingTopup.current);
      sessionStorage.removeItem(pendingTopupKey(orgId));
      pendingTopup.current = null;
      setHasPendingTopup(false);
      setAmount('');
      setNote('');
      toast.success(`Boeking verwerkt. Saldo na deze boeking: ${formatAiCreditEuro(balance)}.`);
    } catch (error) {
      // A PostgREST/SQL error is a definitive rejection; allow the input to be fixed.
      // Transport errors carry no database code and keep the uncertain booking locked.
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code) {
        pendingTopup.current = null;
        sessionStorage.removeItem(pendingTopupKey(orgId));
        setHasPendingTopup(false);
        topup.reset();
      }
      toast.error(toFriendlyError(error));
    }
  };

  const saveMonthlyAllowance = async () => {
    const amountCents = parseAiCreditCents(monthlyAmount);
    if (amountCents == null || amountCents < 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) {
      toast.error('Vul een positief maandbedrag (of 0 om te stoppen) en een geldige startmaand in.');
      return;
    }
    try {
      await setAllowance.mutateAsync({ amountCents, startMonth: `${startMonth}-01` });
      toast.success('Maandregeling opgeslagen. Een verschuldigde aanvulling wordt binnen een uur verwerkt.');
    } catch (error) {
      toast.error(toFriendlyError(error));
    }
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Maandelijkse aanvulling beheren</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`ai-monthly-${orgId}`}>Bedrag per maand (€)</Label>
            <Input id={`ai-monthly-${orgId}`} inputMode="decimal" value={monthlyAmount}
              onChange={(event) => setMonthlyAmount(event.target.value)} disabled={setAllowance.isPending} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ai-start-${orgId}`}>Vanaf maand</Label>
            <Input id={`ai-start-${orgId}`} type="month" value={startMonth}
              onChange={(event) => setStartMonth(event.target.value)} disabled={setAllowance.isPending} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Resterend tegoed blijft staan. Iedere maand wordt hoogstens één keer toegevoegd.
          Een al geboekte maand verandert niet. Stel €0 in om toekomstige aanvullingen te stoppen.
        </p>
        <Button size="sm" onClick={saveMonthlyAllowance} disabled={setAllowance.isPending}>Maandregeling opslaan</Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Eenmalige bijboeking of correctie</h3>
        <div className="space-y-1">
          <Label htmlFor={`ai-topup-${orgId}`}>Bedrag (€)</Label>
          <Input id={`ai-topup-${orgId}`} inputMode="decimal" placeholder="50,00" value={amount}
            onChange={(event) => { setAmount(event.target.value); pendingTopup.current = null; topup.reset(); }}
            disabled={topup.isPending || hasPendingTopup} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ai-note-${orgId}`}>Omschrijving</Label>
          <Textarea id={`ai-note-${orgId}`} placeholder="Reden van deze bijboeking of correctie" value={note}
            onChange={(event) => { setNote(event.target.value); pendingTopup.current = null; topup.reset(); }}
            disabled={topup.isPending || hasPendingTopup} rows={2} maxLength={500} />
        </div>
        <p className="text-xs text-muted-foreground">Een negatief bedrag corrigeert het saldo. De boeking blijft zichtbaar in de historie.</p>
        {hasPendingTopup && !topup.isPending && (
          <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
            De boeking is niet bevestigd. Probeer dezelfde boeking opnieuw; deze wordt nooit dubbel verwerkt.
          </p>
        )}
        <Button size="sm" onClick={bookTopup} disabled={topup.isPending || !amount || !note.trim()}>
          {hasPendingTopup ? 'Dezelfde boeking opnieuw proberen' : 'Boeken'}
        </Button>
      </div>
    </div>
  );
}

export default function AiCreditsPanel({ orgId, canManage = false }: { orgId: string; canManage?: boolean }) {
  const summaryQuery = useAiCreditSummary(orgId);
  const requestsQuery = useAiCreditRequests(orgId);
  const ledgerQuery = useAiCreditLedger(orgId);
  const legacyQuery = useLegacyAiUsage(orgId);
  const summary = summaryQuery.data;
  const requests = requestsQuery.data?.pages.flat() ?? [];
  const ledger = ledgerQuery.data?.pages.flat() ?? [];
  const legacyUsage = legacyQuery.data?.pages.flat() ?? [];

  if (summaryQuery.isPending) return <p className="text-sm text-muted-foreground" role="status">AI-tegoed laden…</p>;
  if (summaryQuery.isError) return <ErrorState title="AI-tegoed kon niet worden geladen" error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} className="py-6" />;
  if (!summary) return <p className="text-sm text-muted-foreground">Er is nog geen AI-tegoed ingesteld.</p>;

  const reconciliationIssue = summary.ledger_difference_cents !== 0 || summary.reservation_difference_cents !== 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4" /> AI-tegoed en verbruik</h3>
        <Button variant="ghost" size="sm" aria-label="AI-tegoed en historie verversen"
          disabled={summaryQuery.isFetching || requestsQuery.isFetching || ledgerQuery.isFetching}
          onClick={() => { void summaryQuery.refetch(); void requestsQuery.refetch(); void ledgerQuery.refetch(); void legacyQuery.refetch(); }}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <CreditMetric label="Beschikbaar AI-tegoed" value={formatAiCreditEuro(summary.available_cents)} note="Voor nieuwe AI-aanvragen" />
        <CreditMetric label="Gereserveerd" value={formatAiCreditEuro(summary.reserved_cents)} note="Lopende of nog onbekende uitkomsten" />
        <CreditMetric label="Totaal saldo" value={formatAiCreditEuro(summary.balance_cents)} note="Inclusief gereserveerd tegoed" />
      </div>

      <div className="rounded-lg border p-3 text-sm">
        {summary.monthly_allowance_cents > 0 ? (
          <>
            <p><strong>{formatAiCreditEuro(summary.monthly_allowance_cents)}</strong> erbij per kalendermaand. Resterend tegoed blijft staan.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.next_grant_at ? `Volgende aanvulling: ${formatAiCreditDate(summary.next_grant_at)} (Nederlandse tijd).` : 'Volgende aanvulling wordt bepaald zodra de maandregeling actief is.'}
            </p>
          </>
        ) : <p>Er is geen maandelijkse aanvulling ingesteld. Het bestaande tegoed blijft beschikbaar.</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <CreditMetric label="Afgeschreven deze maand" value={formatAiCreditEuro(summary.month_charged_cents)} note="Van het AI-tegoed van deze organisatie" />
        <CreditMetric label="Geschatte providerkosten deze maand" value={formatAiProviderUsd(summary.month_provider_cost_usd)}
          note={summary.month_provider_cost_unknown_count > 0 ? `${summary.month_provider_cost_unknown_count} aanvraag/aanvragen met onbekende kosten; bedrag is onvolledig.` : 'Berekend uit geregistreerd tokenverbruik'} />
      </div>
      <p className="text-xs text-muted-foreground">
        Klanttegoed in euro en geschatte providerkosten in dollars zijn afzonderlijke bedragen.
        Providerkosten zijn geen gecontroleerde factuur. Oudere tarieven zijn geen bewijs van werkelijke providerkosten.
      </p>

      {(summary.unresolved_requests > 0 || summary.stale_requests > 0) && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {summary.unresolved_requests} aanvraag/aanvragen hebben nog geen definitieve uitkomst.
          {summary.stale_requests > 0 && ` Daarvan wachten er ${summary.stale_requests} langer dan verwacht op afhandeling.`}
          {' '}Het bijbehorende tegoed blijft gereserveerd totdat de uitkomst is vastgesteld.
        </p>
      )}
      {reconciliationIssue && (
        <div className="flex gap-2 rounded-md border border-destructive p-3 text-xs text-destructive" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p>De saldo-controle meldt een verschil. SiteJob moet dit onderzoeken.
            {' '}Boekingen: {formatAiCreditEuro(summary.ledger_difference_cents)}; reserveringen: {formatAiCreditEuro(summary.reservation_difference_cents)}.</p>
        </div>
      )}
      {summary.unreviewed_overrun_cents > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Er is {formatAiCreditEuro(summary.unreviewed_overrun_cents)} aan verbruik boven reserveringen geregistreerd voor controle door SiteJob. Dit is niet extra afgeschreven.</p>
      )}
      {summary.historical_unexplained_cents !== 0 && (
        <p className="text-xs text-muted-foreground">Bij de overgang is een historisch verschil van {formatAiCreditEuro(summary.historical_unexplained_cents)} vastgelegd bij het openingssaldo. Het bestaande saldo is daarbij behouden.</p>
      )}

      {canManage && <CreditManagement key={orgId} orgId={orgId} summary={summary} />}

      <Tabs defaultValue="requests">
        <TabsList><TabsTrigger value="requests">AI-aanvragen</TabsTrigger><TabsTrigger value="ledger">Boekingen</TabsTrigger><TabsTrigger value="legacy">Eerder verbruik</TabsTrigger></TabsList>
        <TabsContent value="requests" className="space-y-2">
          {requestsQuery.isError ? <ErrorState error={requestsQuery.error} onRetry={() => requestsQuery.refetch()} className="py-6" />
            : requestsQuery.isPending ? <p className="text-sm text-muted-foreground">Aanvragen laden…</p>
              : requests.length === 0 ? <p className="text-sm text-muted-foreground">Nog geen aanvragen sinds de nieuwe registratie.</p>
                : requests.map((request) => (
                  <div key={request.id} className="space-y-2 rounded-lg border p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{aiFeatureLabel(request.feature)}</span>
                      <Badge variant={request.status === 'succeeded' ? 'secondary' : 'outline'}>{aiRequestStatusLabel(request.status)}</Badge>
                    </div>
                    <div className="flex flex-wrap justify-between gap-1 text-muted-foreground">
                      <span data-no-translate="true">{request.provider} · {request.model}</span><span>{formatAiCreditDate(request.created_at, true)}</span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>Afgeschreven: <strong>{formatAiCreditEuro(request.charged_cents)}</strong></span>
                      <span>Provider geschat: {formatAiProviderUsd(request.provider_cost_usd)}</span>
                    </div>
                    {(request.status === 'reserved' || request.status === 'unknown') && (
                      <p className="text-muted-foreground">Gereserveerd: {formatAiCreditEuro(request.reservation_cents)}. Nog geen definitieve afrekening.</p>
                    )}
                    <details className="text-muted-foreground">
                      <summary className="cursor-pointer">Verbruiksdetails</summary>
                      <p className="mt-1">Tokens: {request.input_tokens ?? '?'} invoer · {request.output_tokens ?? '?'} uitvoer · {request.thinking_tokens ?? '?'} denkwerk</p>
                      {request.duration_ms != null && <p>Duur: {(request.duration_ms / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} seconden</p>}
                      <p className="break-all">Aanvraag: {request.id}</p>
                    </details>
                  </div>
                ))}
          {requestsQuery.hasNextPage && <Button variant="outline" size="sm" disabled={requestsQuery.isFetchingNextPage} onClick={() => requestsQuery.fetchNextPage()}>Meer aanvragen laden</Button>}
        </TabsContent>
        <TabsContent value="ledger" className="space-y-2">
          {ledgerQuery.isError ? <ErrorState error={ledgerQuery.error} onRetry={() => ledgerQuery.refetch()} className="py-6" />
            : ledgerQuery.isPending ? <p className="text-sm text-muted-foreground">Boekingen laden…</p>
              : ledger.length === 0 ? <p className="text-sm text-muted-foreground">Nog geen boekingen.</p>
                : ledger.map((entry) => (
                  <div key={entry.id} className="space-y-1 rounded-lg border p-3 text-xs">
                    <div className="flex justify-between gap-2"><strong>{aiLedgerKindLabel(entry.kind)}</strong><strong className="tabular-nums">{entry.amount_cents > 0 ? '+' : ''}{formatAiCreditEuro(entry.amount_cents)}</strong></div>
                    {entry.grant_month && <p>Voor maand {entry.grant_month.slice(0, 7)}</p>}
                    {entry.note && <p className="text-muted-foreground" data-no-translate="true">{entry.note}</p>}
                    <div className="flex flex-wrap justify-between gap-2 text-muted-foreground"><span>{formatAiCreditDate(entry.created_at, true)}</span><span>Saldo erna: {formatAiCreditEuro(entry.balance_after_cents)}</span></div>
                    {entry.request_id && <details className="text-muted-foreground"><summary className="cursor-pointer">Bijbehorende aanvraag</summary><p className="break-all">{entry.request_id}</p></details>}
                  </div>
                ))}
          {ledgerQuery.hasNextPage && <Button variant="outline" size="sm" disabled={ledgerQuery.isFetchingNextPage} onClick={() => ledgerQuery.fetchNextPage()}>Meer boekingen laden</Button>}
        </TabsContent>
        <TabsContent value="legacy" className="space-y-2">
          <p className="text-xs text-muted-foreground">Oorspronkelijke gebruiksregistratie van vóór de nieuwe boekhouding. Deze bedragen zijn historische klantcredits; de werkelijke providerkosten en ontbrekende aanroepen kunnen hiermee niet achteraf worden vastgesteld.</p>
          {legacyQuery.isError ? <ErrorState error={legacyQuery.error} onRetry={() => legacyQuery.refetch()} className="py-6" />
            : legacyQuery.isPending ? <p className="text-sm text-muted-foreground">Eerder verbruik laden…</p>
              : legacyUsage.length === 0 ? <p className="text-sm text-muted-foreground">Geen eerder verbruik geregistreerd.</p>
                : legacyUsage.map((usage) => (
                  <div key={usage.id} className="space-y-1 rounded-lg border p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2"><strong>{aiFeatureLabel(usage.feature)}</strong><span>Geregistreerde credits: {formatAiCreditEuro(usage.cost_cents)}</span></div>
                    <div className="flex flex-wrap justify-between gap-2 text-muted-foreground"><span data-no-translate="true">{usage.provider} · {usage.model}</span><span>{formatAiCreditDate(usage.created_at, true)}</span></div>
                    <p className="text-muted-foreground">Tokens: {usage.input_tokens ?? '?'} invoer · {usage.output_tokens ?? '?'} uitvoer</p>
                  </div>
                ))}
          {legacyQuery.hasNextPage && <Button variant="outline" size="sm" disabled={legacyQuery.isFetchingNextPage} onClick={() => legacyQuery.fetchNextPage()}>Meer eerder verbruik laden</Button>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
