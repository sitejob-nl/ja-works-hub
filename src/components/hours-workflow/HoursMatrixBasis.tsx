import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toFriendlyError } from '@/lib/errorMessages';
import { formatHoursDeadline, isHoursConflict } from './presentation';
import { HoursClassificationDetails } from './HoursClassificationDetails';
import type {
  HoursDayBasisView, HoursDayView, HoursMatrixOptionsView, HoursReplaceBasisInput,
} from './types';

const scopeLabel = (scope: 'client' | 'cao') => scope === 'client' ? 'klantmatrix' : 'CAO';

function BasisEntries({ basis }: { basis: HoursDayBasisView }) {
  const superseded = basis.entries.filter(entry => entry.basisVersion !== basis.basisVersion);
  if (!superseded.length) return null;
  return <details className="text-xs">
    <summary className="cursor-pointer text-muted-foreground">Eerdere matrixbasis ({superseded.length})</summary>
    <ol className="mt-2 space-y-2 border-l pl-3">
      {superseded.map(entry => <li key={entry.basisVersion} className="space-y-0.5">
        <p>Basisversie {entry.basisVersion} · <span data-no-translate="true">{entry.matrixName}</span> · {scopeLabel(entry.scope)}</p>
        <p className="text-muted-foreground">Vastgelegd op {formatHoursDeadline(entry.createdAt)}</p>
        {entry.reason && <p className="whitespace-pre-wrap break-words">Reden: <span data-no-translate="true">{entry.reason}</span></p>}
      </li>)}
    </ol>
  </details>;
}

function ReplaceForm({ day, basis, options, onReplaceBasis, onBusyChange, onClose, onReload }: {
  day: HoursDayView;
  basis: HoursDayBasisView;
  options: HoursMatrixOptionsView;
  onReplaceBasis: (input: HoursReplaceBasisInput) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onReload?: () => void;
}) {
  // The form keeps the day version and the basis version it was opened on.
  // Both are sent as-is: a week that refetched meanwhile must not quietly
  // feed the server a fresher value and defeat its compare-and-swap.
  const [revisionId] = useState(day.revision?.id ?? '');
  const [basisVersion] = useState(basis.basisVersion);
  const [matrixVersionId, setMatrixVersionId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [done, setDone] = useState(false);
  const changed = conflict || revisionId !== (day.revision?.id ?? '') || basisVersion !== basis.basisVersion;
  const choices = options.options.filter(option => !option.isCurrent);

  if (options.released) {
    return <Alert className="mt-3"><AlertDescription>
      Deze urendag is al vrijgegeven. Een andere matrixbasis loopt dan via de correctieroute na export; die bestaat nog niet.
    </AlertDescription></Alert>;
  }
  if (done) {
    return <Alert className="mt-3"><AlertDescription>
      De matrixbasis is vervangen. De getoonde uitkomst hoort nog bij de vorige basis. Voer de uursoortencontrole opnieuw uit om de dag op de nieuwe basis in te delen.
      <div className="mt-2"><Button type="button" variant="outline" size="sm" onClick={onClose}>Sluiten</Button></div>
    </AlertDescription></Alert>;
  }
  if (!choices.length) {
    return <Alert className="mt-3"><AlertDescription>
      Er is voor deze werkdatum geen andere gepubliceerde matrixversie beschikbaar. Publiceer eerst de bedoelde versie of koppel de juiste CAO.
      <div className="mt-2"><Button type="button" variant="outline" size="sm" onClick={onClose}>Sluiten</Button></div>
    </AlertDescription></Alert>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || changed) return;
    if (!matrixVersionId) { setError('Kies de matrixversie die voortaan voor deze dag geldt.'); return; }
    if (!reason.trim()) { setError('Leg vast waarom deze dag op een andere matrixbasis komt.'); return; }
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      await onReplaceBasis({
        dayId: day.id, expectedRevisionId: revisionId, expectedBasisVersion: basisVersion,
        matrixVersionId, reason: reason.trim(),
      });
      setDone(true);
    } catch (failure) {
      if (isHoursConflict(failure)) setConflict(true);
      else setError(toFriendlyError(failure, 'De matrixbasis is niet vervangen. Probeer het opnieuw.'));
    } finally { setBusy(false); onBusyChange?.(false); }
  }

  return <form className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={submit} aria-label="Matrixbasis vervangen">
    <p className="text-xs text-muted-foreground">
      De vastgelegde basis blijft staan en eerdere uitkomsten blijven bewaard. Deze handeling rekent niets uit; daarna volgt de uursoortencontrole opnieuw.
    </p>
    <fieldset disabled={busy || changed} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`basis-matrix-${day.id}`}>Nieuwe matrixbasis</Label>
        <select id={`basis-matrix-${day.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={matrixVersionId} onChange={event => setMatrixVersionId(event.target.value)}>
          <option value="">Kies een matrixversie</option>
          {choices.map(option => <option key={option.matrixVersionId} value={option.matrixVersionId}>
            {`${option.matrixName} · ${scopeLabel(option.scope)} · vanaf ${option.validFrom}${option.validUntil ? ` tot ${option.validUntil}` : ''}`}
          </option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`basis-reason-${day.id}`}>Reden van de vervanging</Label>
        <Textarea id={`basis-reason-${day.id}`} rows={2} maxLength={500} value={reason}
          onChange={event => setReason(event.target.value)} />
        <p className="text-xs text-muted-foreground">Deze toelichting wordt bewaard bij de vervanging en wordt nooit als uurgegeven toegepast.</p>
      </div>
    </fieldset>
    {changed && <Alert variant="destructive"><AlertDescription>
      Deze dag of de matrixbasis is ondertussen gewijzigd. Er is niets vervangen. Controleer de actuele gegevens voordat je verdergaat.
      {onReload && <div className="mt-2"><Button type="button" variant="outline" size="sm" onClick={onReload}>Actuele uren laden</Button></div>}
    </AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={busy || changed}>{busy ? 'Vervangen…' : 'Matrixbasis vervangen'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Annuleren</Button>
    </div>
  </form>;
}

export interface HoursMatrixBasisProps {
  day: HoursDayView;
  readOnly: boolean;
  busy: boolean;
  onLoadMatrixOptions?: (dayId: string) => Promise<HoursMatrixOptionsView>;
  onReplaceBasis?: (input: HoursReplaceBasisInput) => Promise<void>;
  /** Reports an in-flight replacement, so sibling day actions can hold off. */
  onBusyChange?: (busy: boolean) => void;
  onReload?: () => void;
}

/**
 * The basis a day stands on, everything it has stood on before, and the
 * outcomes those bases produced. Replacing is an explicit, reasoned act; it
 * never rewrites what is shown here.
 */
export function HoursMatrixBasis({ day, readOnly, busy, onLoadMatrixOptions, onReplaceBasis, onBusyChange, onReload }: HoursMatrixBasisProps) {
  const [options, setOptions] = useState<HoursMatrixOptionsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const basis = day.matrixBasis;
  if (!basis) return null;
  const current = basis.entries.find(entry => entry.basisVersion === basis.basisVersion);
  // Compared by basis version, not by matrix: a chain that returns to an earlier
  // matrix still needs a recalculation on the newer basis. An outcome recorded
  // before basis versions existed can only have used the first basis.
  const outdated = day.classification && day.classification.matrixVersionId
    && (day.classification.basisVersion ?? 0) !== basis.basisVersion;
  const superseded = day.previousClassifications ?? [];
  const canReplace = !readOnly && !!onReplaceBasis && !!onLoadMatrixOptions && !!day.revision;

  return <section className="mt-3 space-y-2 rounded-lg border p-3" aria-label="Matrixbasis">
    <p className="text-sm">Huidige matrixbasis: <span data-no-translate="true">{basis.matrixName}</span> · {scopeLabel(basis.scope)} · basisversie {basis.basisVersion}</p>
    {current?.reason && <p className="whitespace-pre-wrap break-words text-xs">Vervangen omdat: <span data-no-translate="true">{current.reason}</span></p>}
    {outdated && <Alert><AlertDescription>
      De getoonde uitkomst hoort nog bij een eerdere matrixbasis. Voer de uursoortencontrole opnieuw uit om deze dag op de huidige basis in te delen.
    </AlertDescription></Alert>}
    <BasisEntries basis={basis} />
    {superseded.length > 0 && <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Eerdere uitkomsten ({superseded.length})</summary>
      <ol className="mt-2 space-y-2 border-l pl-3">
        {superseded.map(entry => <li key={entry.id} className="space-y-1">
          <p>{entry.basisVersion == null
            ? 'Uitkomst zonder vastgelegde matrixbasis'
            : `Uitkomst op basisversie ${entry.basisVersion}`}</p>
          <HoursClassificationDetails classification={entry} revisionId={entry.revisionId} />
        </li>)}
      </ol>
    </details>}
    {canReplace && options === null && <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={async () => {
        setLoading(true);
        setLoadError(null);
        try { setOptions(await onLoadMatrixOptions(day.id)); }
        catch (failure) { setLoadError(toFriendlyError(failure, 'De beschikbare matrixversies konden niet worden geladen.')); }
        finally { setLoading(false); }
      }}>{loading ? 'Matrixversies laden…' : 'Andere matrixbasis vastleggen'}</Button>
      {loadError && <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>}
    </div>}
    {canReplace && options !== null && <ReplaceForm day={day} basis={basis} options={options}
      onReplaceBasis={onReplaceBasis} onBusyChange={onBusyChange} onReload={onReload} onClose={() => setOptions(null)} />}
  </section>;
}

export default HoursMatrixBasis;
