import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { hoursWorkflowError } from '@/lib/hours-workflow';
import { describeUncertainFields, type HoursUncertainField } from '@/lib/hours-sources';
import type { HoursReadingEntry } from '@/lib/hours-workflow-api';
import { HOURS_SCAN_MAX_ENTRIES, type ScanCandidate, type ScanReading } from '../../../supabase/functions/_shared/hours-scan';
import { formatHoursDate } from './presentation';

const duration = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} uur`;
const euro = (cents: number): string => `€ ${(cents / 100).toFixed(2).replace('.', ',')}`;

export interface HoursScanReadingProps {
  reading: ScanReading;
  /** What this one paid reading cost, so the price is never invisible. */
  costCents: number;
  balanceCents: number;
  model: string;
  durationMs: number;
  /** Days that already carry a proposal from this same source. */
  alreadyProposed: Set<string>;
  onCancel: () => void;
  onSave: (entries: HoursReadingEntry[]) => Promise<void>;
  maxEntries?: number;
}

const entryOf = (candidate: ScanCandidate): HoursReadingEntry => ({
  day_id: candidate.dayId,
  minutes: candidate.minutes,
  no_hours_reason: candidate.noHoursReason,
  source_input: candidate.sourceInput,
  page_number: candidate.pageNumber,
  page_label: candidate.pageLabel,
  assignment_uncertain: candidate.assignmentUncertain,
  uncertain_fields: candidate.uncertainFields.length
    ? candidate.uncertainFields as HoursUncertainField[] : null,
});

/** What the paper literally said, beside what the reader made of it. */
function ReadAloud({ candidate }: { candidate: ScanCandidate }) {
  const parts = [
    candidate.readText.total ? `totaal “${candidate.readText.total}”` : null,
    candidate.readText.start ? `begin “${candidate.readText.start}”` : null,
    candidate.readText.end ? `eind “${candidate.readText.end}”` : null,
    candidate.readText.break ? `pauze “${candidate.readText.break}”` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-xs text-muted-foreground" data-no-translate="true">
    Gelezen: {parts.join(' · ')}
  </p>;
}

/**
 * What the reader saw, before anything is recorded. Every row shows where it
 * came from, what it literally read and what does not add up, so the reviewer
 * decides on the paper rather than on a number that appeared out of nowhere.
 */
export function HoursScanReading({
  reading, costCents, balanceCents, model, durationMs, alreadyProposed, onCancel, onSave,
  maxEntries = HOURS_SCAN_MAX_ENTRIES,
}: HoursScanReadingProps) {
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(reading.ok === true ? reading.candidates.filter(c => alreadyProposed.has(c.dayId)).map(c => c.dayId) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The call was paid for either way, so what it cost stays visible even when
  // the answer turned out to be unusable.
  const price = <p className="text-xs text-muted-foreground">
    Deze uitlezing kostte {euro(costCents)}. Resterend tegoed {euro(balanceCents)}.
  </p>;

  if (reading.ok === false) {
    return <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <Alert variant="destructive"><AlertDescription>
        <p className="font-medium">Deze bron is niet uitgelezen.</p>
        {reading.issues.map((issue, index) => <p key={index} className="mt-1">{issue.message}</p>)}
        <p className="mt-2">Er zijn geen voorstellen gemaakt. Het originele bestand blijft bewaard;
          bekijk het zelf en leg de uren zo nodig handmatig als voorstel vast.</p>
      </AlertDescription></Alert>
      {price}
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>Sluiten</Button>
    </div>;
  }

  const chosen = reading.candidates.filter(candidate => !excluded.has(candidate.dayId));
  const toggle = (dayId: string, include: boolean) => setExcluded(current => {
    const next = new Set(current);
    if (include) next.delete(dayId); else next.add(dayId);
    return next;
  });

  async function save() {
    if (busy) return;
    setError(null);
    if (!chosen.length) { setError('Kies minstens één regel om als voorstel te bewaren.'); return; }
    if (chosen.length > maxEntries) {
      setError(`Er kunnen maximaal ${maxEntries} regels in één keer worden bewaard. `
        + `Vink er ${chosen.length - maxEntries} uit en bewaar de rest daarna.`);
      return;
    }
    setBusy(true);
    try { await onSave(chosen.map(entryOf)); onCancel(); }
    catch (failure) { setError(hoursWorkflowError(failure)); }
    finally { setBusy(false); }
  }

  return <div className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" role="group" aria-label="Uitlezing van deze bron">
    <p className="text-sm font-medium">Wat er op dit briefje staat</p>
    <p className="text-xs text-muted-foreground">
      {reading.pagesRead.length > 0 && <>
        Gelezen van {reading.pagesRead.length === 1 ? 'pagina' : 'de pagina’s'}{' '}
        <span data-no-translate="true">{reading.pagesRead.join(', ')}</span>.{' '}
      </>}
      Dit zijn nog geen uren: bewaren maakt er voorstellen van, en toepassen blijft per dag een
      aparte handeling.
    </p>
    {price}

    {reading.candidates.length === 0
      ? <p className="text-sm">Er is geen enkele regel gevonden die bij een medewerker en werkdag van deze week hoort.</p>
      : <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>{chosen.length} van {reading.candidates.length} gekozen.</span>
        <Button type="button" size="sm" variant="ghost" disabled={busy || !chosen.length}
          onClick={() => setExcluded(new Set(reading.candidates.map(candidate => candidate.dayId)))}>
          Alles uitvinken
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || chosen.length === reading.candidates.length}
          onClick={() => setExcluded(new Set())}>Alles aanvinken</Button>
      </div>
      <ul className="space-y-2">
        {reading.candidates.map(candidate => {
          const include = !excluded.has(candidate.dayId);
          const inputId = `scan-${candidate.dayId}`;
          return <li key={candidate.dayId} className="flex flex-wrap items-start gap-2 rounded-md border bg-background p-2">
            <Checkbox id={inputId} checked={include} disabled={busy}
              onCheckedChange={value => toggle(candidate.dayId, value === true)} />
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={inputId} className="font-medium">
                <span data-no-translate="true">{candidate.employeeName}</span> — {formatHoursDate(candidate.workDate)}
              </Label>
              <p className="text-sm">{candidate.noHoursReason
                ? <>Geen uren · <span data-no-translate="true">{candidate.noHoursReason}</span></>
                : duration(candidate.minutes)}</p>
              <ReadAloud candidate={candidate} />
              {candidate.sourceInput?.categories?.length ? <p className="text-xs text-muted-foreground" data-no-translate="true">
                {candidate.sourceInput.categories.map(category => `${category.sourceCode} ${duration(category.minutes)}`).join(' · ')}
              </p> : null}
              <p className="text-xs text-muted-foreground" data-no-translate="true">
                Vindplaats: pagina {candidate.pageNumber}{candidate.pageLabel ? ` · ${candidate.pageLabel}` : ''}
              </p>
              {candidate.assignmentUncertain && <p className="text-xs">
                Op het briefje staat: <span className="font-medium" data-no-translate="true">{candidate.employeeText}</span>.
                Bevestig na het bewaren of dit inderdaad {candidate.employeeName} is.
              </p>}
              {candidate.uncertainFields.length > 0 && <p className="text-xs">
                De uitlezing was niet zeker van {describeUncertainFields(candidate.uncertainFields as HoursUncertainField[])}.
                Toepassen kan pas nadat iemand dat tegen de bron heeft gecontroleerd.
              </p>}
              {candidate.notices.map((notice, index) => <p key={index} className="text-xs text-destructive">
                {notice.message}
                {notice.expectedMinutes !== undefined && notice.actualMinutes !== undefined
                  ? ` De delen zijn samen ${duration(notice.expectedMinutes)}, het opgeschreven totaal is ${duration(notice.actualMinutes)}.`
                  : ''}
              </p>)}
              {alreadyProposed.has(candidate.dayId) && <p className="text-xs text-muted-foreground">
                Deze dag heeft al een voorstel uit deze bron. Standaard niet opnieuw bewaard.
              </p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              {candidate.assignmentUncertain && <Badge variant="destructive">Toewijzing onzeker</Badge>}
              {candidate.uncertainFields.length > 0 && <Badge variant="destructive">Gelezen waarde onzeker</Badge>}
            </div>
          </li>;
        })}
      </ul>
      </>}

    {reading.pagesUnread.length > 0 && <Alert><AlertDescription>
      <p className="font-medium">
        {reading.pagesUnread.length === 1 ? 'Deze pagina is niet gelezen' : 'Deze pagina’s zijn niet gelezen'}:
      </p>
      <ul className="mt-1 space-y-1 text-sm">
        {reading.pagesUnread.map((page, index) => <li key={index}>
          Pagina {page.pageNumber} — <span data-no-translate="true">{page.reason}</span>
        </li>)}
      </ul>
      <p className="mt-2">Bekijk de bron zelf en leg die uren zo nodig handmatig als voorstel vast.</p>
    </AlertDescription></Alert>}

    {reading.skipped.length > 0 && <div className="rounded-md bg-background p-2 text-xs">
      <p className="font-medium">Hier is met opzet niets van gemaakt ({reading.skipped.length}):</p>
      <ul className="mt-1 space-y-1">
        {reading.skipped.map((line, index) => <li key={index}>
          <span data-no-translate="true">{line.text}</span>: {line.reason}
        </li>)}
      </ul>
    </div>}

    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={busy || !chosen.length} onClick={() => void save()}>
        {busy ? 'Voorstellen bewaren…' : `${chosen.length} ${chosen.length === 1 ? 'voorstel' : 'voorstellen'} bewaren`}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Annuleren</Button>
    </div>
    <p className="sr-only">Uitgelezen met {model} in {Math.round(durationMs / 100) / 10} seconden.</p>
  </div>;
}

export default HoursScanReading;
