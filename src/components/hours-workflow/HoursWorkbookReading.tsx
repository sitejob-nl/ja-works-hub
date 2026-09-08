import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { hoursWorkflowError } from '@/lib/hours-workflow';
import { HOURS_READING_MAX_ENTRIES, type WorkbookCandidate, type WorkbookReading } from '@/lib/hours-workbook';
import type { HoursReadingEntry } from '@/lib/hours-workflow-api';
import { formatHoursDate } from './presentation';

const duration = (minutes: number): string => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} uur`;

export interface HoursWorkbookReadingProps {
  reading: WorkbookReading;
  /** Days that already carry an open proposal from this same source. */
  alreadyProposed: Set<string>;
  onCancel: () => void;
  onSave: (entries: HoursReadingEntry[]) => Promise<void>;
}

const entryOf = (candidate: WorkbookCandidate): HoursReadingEntry => ({
  day_id: candidate.dayId,
  minutes: candidate.minutes,
  no_hours_reason: candidate.noHoursReason,
  source_input: candidate.sourceInput,
  page_number: candidate.pageNumber,
  page_label: candidate.pageLabel,
  assignment_uncertain: candidate.assignmentUncertain,
});

/**
 * What the reader saw, before anything is recorded. Every row shows where it
 * came from and what does not add up, so the reviewer decides on facts rather
 * than on a number that appeared out of nowhere.
 */
export function HoursWorkbookReading({ reading, alreadyProposed, onCancel, onSave }: HoursWorkbookReadingProps) {
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(reading.ok === true ? reading.candidates.filter(c => alreadyProposed.has(c.dayId)).map(c => c.dayId) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reading.ok === false) {
    return <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <Alert variant="destructive"><AlertDescription>
        <p className="font-medium">Deze bron is niet uitgelezen.</p>
        {reading.issues.map((issue, index) => <p key={index} className="mt-1">{issue.message}</p>)}
        <p className="mt-2">Er zijn geen voorstellen gemaakt. Het originele bestand blijft bewaard.</p>
      </AlertDescription></Alert>
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
    if (chosen.length > HOURS_READING_MAX_ENTRIES) {
      setError(`Er kunnen maximaal ${HOURS_READING_MAX_ENTRIES} regels in één keer worden bewaard. `
        + `Vink er ${chosen.length - HOURS_READING_MAX_ENTRIES} uit en bewaar de rest daarna.`);
      return;
    }
    setBusy(true);
    try { await onSave(chosen.map(entryOf)); onCancel(); }
    catch (failure) { setError(hoursWorkflowError(failure)); }
    finally { setBusy(false); }
  }

  return <div className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" role="group" aria-label="Uitlezing van deze bron">
    <p className="text-sm font-medium">Wat er in dit bestand staat</p>
    <p className="text-xs text-muted-foreground">
      Gelezen uit {reading.sheetsRead.length === 1 ? 'werkblad' : 'de werkbladen'}{' '}
      <span data-no-translate="true">{reading.sheetsRead.join(', ')}</span>. Dit zijn nog geen uren: bewaren
      maakt er voorstellen van, en toepassen blijft per dag een aparte handeling.
    </p>

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
          const inputId = `reading-${candidate.dayId}`;
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
              {candidate.sourceInput?.categories?.length ? <p className="text-xs text-muted-foreground" data-no-translate="true">
                {candidate.sourceInput.categories.map(category => `${category.sourceCode} ${duration(category.minutes)}`).join(' · ')}
              </p> : null}
              <p className="text-xs text-muted-foreground" data-no-translate="true">Vindplaats: {candidate.pageLabel}</p>
              {candidate.assignmentUncertain && <p className="text-xs">
                In het bestand staat: <span className="font-medium" data-no-translate="true">{candidate.employeeText}</span>.
                Bevestig na het bewaren of dit inderdaad {candidate.employeeName} is.
              </p>}
              {candidate.notices.map((notice, index) => <p key={index} className="text-xs text-destructive">
                {notice.message}
                {notice.expectedMinutes !== undefined && notice.actualMinutes !== undefined
                  ? ` De delen zijn samen ${duration(notice.expectedMinutes)}, het aangeleverde totaal is ${duration(notice.actualMinutes)}.`
                  : ''}
              </p>)}
              {alreadyProposed.has(candidate.dayId) && <p className="text-xs text-muted-foreground">
                Deze dag heeft al een openstaand voorstel uit deze bron. Standaard niet opnieuw bewaard.
              </p>}
            </div>
            {candidate.assignmentUncertain && <Badge variant="destructive">Toewijzing onzeker</Badge>}
          </li>;
        })}
      </ul>
      </>}

    {reading.sheetsIgnored.length > 0 && <Alert><AlertDescription>
      <p className="font-medium">
        {reading.sheetsIgnored.length === 1 ? 'Dit werkblad is niet gelezen' : 'Deze werkbladen zijn niet gelezen'}:{' '}
        <span data-no-translate="true">{reading.sheetsIgnored.join(', ')}</span>.
      </p>
      <p className="mt-1">De indeling is daar niet herkend. Bekijk de bron zelf en leg die uren zo nodig
        handmatig als voorstel vast.</p>
    </AlertDescription></Alert>}

    {reading.rowTotals.length > 0 && <Alert><AlertDescription>
      <p className="font-medium">Een aangeleverd totaal klopt niet met de dagen eronder.</p>
      <ul className="mt-1 space-y-1 text-sm">
        {reading.rowTotals.map((total, index) => <li key={index} data-no-translate="true">
          {total.employeeName} (blad {total.sheet}, rij {total.row}): aangeleverd {duration(total.deliveredMinutes)},
          gelezen {duration(total.readMinutes)}.
          {total.unreadDays.length > 0 && ` Leeg gelaten: ${total.unreadDays.join(', ')}.`}
        </li>)}
      </ul>
      <p className="mt-2">De dagen houden precies wat er in het bestand staat; het verschil wordt niet weggerekend.</p>
    </AlertDescription></Alert>}

    {reading.skipped.length > 0 && <div className="rounded-md bg-background p-2 text-xs">
      <p className="font-medium">Hier is met opzet niets van gemaakt ({reading.skipped.length}):</p>
      <ul className="mt-1 space-y-1">
        {reading.skipped.map((row, index) => <li key={index}>
          <span data-no-translate="true">Blad {row.sheet}, rij {row.row}{row.text ? ` — ${row.text}` : ''}</span>: {row.reason}
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
  </div>;
}

export default HoursWorkbookReading;
