import { useCallback, useState } from 'react';
import {
  configFromDefinition, emptyMatrixConfig, hoursMatrixError, matrixPublicationIssue,
  matrixPreviewDefinition, matrixDefinitionForCalculation, validateMatrixDraft, type MatrixDetail, type MatrixDraftInput, type MatrixVersion,
} from '@/lib/hours-matrices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MatrixConfigFields } from './MatrixConfigFields';
import { MatrixPreview } from './MatrixPreview';

export interface MatrixVersionEditorProps {
  matrix: MatrixDetail;
  version?: MatrixVersion;
  canManage: boolean;
  onSave: (input: MatrixDraftInput) => Promise<void>;
  onPublish: (version: MatrixVersion) => Promise<void>;
  onReload: () => void;
}

export function MatrixVersionEditor({ matrix, version, canManage, onSave, onPublish, onReload }: MatrixVersionEditorProps) {
  const [draft, setDraft] = useState<MatrixDraftInput>(() => ({
    validFrom: version?.valid_from ?? '', validUntil: version?.valid_until ?? null,
    config: version ? configFromDefinition(version.definition) : emptyMatrixConfig(),
  }));
  const [initialDraft] = useState(JSON.stringify(draft));
  const [initialRevision] = useState(version?.revision);
  const [previewReady, setPreviewReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const handlePreviewReady = useCallback((ready: boolean) => { setPreviewReady(ready); if (!ready) setConfirmed(false); }, []);
  const published = version?.status === 'published';
  const readOnly = !canManage || published;
  const stale = conflict || version?.revision !== initialRevision;
  const dirty = JSON.stringify(draft) !== initialDraft;
  const validation = validateMatrixDraft(matrix, draft);
  const publicationIssue = matrixPublicationIssue(draft, matrix.versions, version?.id);
  const update = (next: MatrixDraftInput) => { setDraft(next); setPreviewReady(false); setConfirmed(false); setError(null); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (failure) {
      setError(failure);
      if (typeof failure === 'object' && failure !== null && 'code' in failure && (failure.code === 'PT409' || failure.code === '40001')) setConflict(true);
    } finally { setBusy(false); }
  };
  const canPublish = !readOnly && !!version && !dirty && !stale && !busy && validation.ok && !publicationIssue && previewReady && confirmed;
  return <div className="space-y-6 min-w-0">
    <div className="space-y-1"><h2 className="text-lg font-semibold">{version ? `Versie ${version.version_number}` : 'Nieuwe conceptversie'}{published ? ' · gepubliceerd' : ' · concept'}</h2>
      {published ? <p className="text-sm text-muted-foreground">Deze gepubliceerde versie is onveranderlijk. Maak een nieuwe versie voor gewijzigde afspraken.</p> : <p className="text-sm text-muted-foreground">Sla het concept op, controleer een rekenvoorbeeld en bevestig daarna de publicatie.</p>}
    </div>
    {stale && <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-sm"><p>Dit concept is ondertussen gewijzigd. Je invoer blijft zichtbaar; laden van de actuele versie vervangt deze invoer.</p><Button type="button" variant="outline" onClick={onReload}>Actuele matrix laden</Button></div>}
    <fieldset disabled={readOnly || busy || stale} className="space-y-6 min-w-0">
      <legend className="sr-only">Matrixversie bewerken</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="matrix-valid-from">Geldig vanaf</Label><Input id="matrix-valid-from" type="date" value={draft.validFrom} onChange={event => update({ ...draft, validFrom: event.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="matrix-valid-until">Geldig tot (exclusief, optioneel)</Label><Input id="matrix-valid-until" type="date" value={draft.validUntil ?? ''} onChange={event => update({ ...draft, validUntil: event.target.value || null })} /></div>
      </div>
      <p className="text-sm text-muted-foreground">De einddatum zelf valt buiten de versie. Een nieuwe gepubliceerde versie sluit de vorige effectief af op de nieuwe startdatum. De oorspronkelijke afspraken blijven bewaard.</p>
      {published && version.effective_valid_until !== version.valid_until && <p className="text-sm">Effectief geldig tot {version.effective_valid_until} door een opvolgende versie.</p>}
      <MatrixConfigFields config={draft.config} onChange={config => update({ ...draft, config })} readOnly={!!readOnly} />
    </fieldset>
    {!readOnly && <div className="space-y-3">
      {validation.ok === false && <div role="alert" className="text-sm text-destructive">{validation.issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</div>}
      <Button type="button" disabled={busy || stale || !validation.ok} onClick={() => void run(() => onSave(draft))}>{busy ? 'Bezig…' : 'Concept opslaan'}</Button>
      {dirty && version && <p className="text-sm text-muted-foreground">Sla je wijzigingen op voordat je deze versie publiceert.</p>}
    </div>}
    {error && <div role="alert" className="text-sm text-destructive">{hoursMatrixError(error)}</div>}
    <MatrixPreview matrix={published ? matrixDefinitionForCalculation(version.definition) : matrixPreviewDefinition(matrix, draft, version?.id)} onReady={handlePreviewReady} />
    {!readOnly && <section className="space-y-3 rounded-xl border p-4" aria-label="Versie publiceren">
      <h3 className="font-medium">Versie publiceren</h3>
      <p className="text-sm text-muted-foreground">Publiceer uitsluitend de door opdrachtgever of CAO bevestigde afspraken. Publicatie maakt deze versie beschikbaar voor urencontrole; het is geen payrollvrijgave.</p>
      {publicationIssue && <p role="alert" className="text-sm text-destructive">{publicationIssue}</p>}
      {!version && <p className="text-sm text-muted-foreground">Sla eerst een conceptversie op.</p>}
      <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={!version || dirty || stale || busy || !previewReady || !validation.ok || !!publicationIssue} onChange={event => setConfirmed(event.target.checked)} />Ik heb de afspraken, geldigheid en het actuele rekenvoorbeeld gecontroleerd en bevestig publicatie.</label>
      <Button type="button" disabled={!canPublish} onClick={() => void run(() => onPublish(version!))}>Bevestigen en publiceren</Button>
    </section>}
  </div>;
}
