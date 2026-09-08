import { useState } from 'react';
import { Check, Clock3, FileText, Pencil, Save, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toFriendlyError } from '@/lib/errorMessages';
import { parseHoursToMinutes } from '../../../supabase/functions/_shared/hours-calculation';
import { currentConfirmation, formatHours, formatHoursDate, formatHoursDeadline, isHoursConflict } from './presentation';
import type { HoursClassifyInput, HoursDayView, HoursReviewInput, HoursRevisionView, HoursSaveDayInput, HoursWeekView } from './types';
import { compileHoursSourceInput, removedSourceSections, sourceControlIssues, sourceDraftFromInput } from './hours-day-source';
import { HoursSourceEditor } from './HoursSourceEditor';
import { HoursSourceSummary } from './HoursSourceSummary';
import { HoursClassificationDetails } from './HoursClassificationDetails';

export interface HoursWeekWorkspaceProps {
  week: HoursWeekView;
  onSaveDay: (input: HoursSaveDayInput) => Promise<void>;
  onReview?: (input: HoursReviewInput) => Promise<void>;
  onClassify?: (input: HoursClassifyInput) => Promise<void>;
  onReload?: () => void;
  readOnly?: boolean;
  /** Rendered under the week summary; the internal intake panel fetches its own data. */
  sourcesSlot?: React.ReactNode;
}

function ReviewEditor({ day, status, onReview, onClose, onReload }: {
  day: HoursDayView;
  status: HoursReviewInput['status'];
  onReview: HoursWeekWorkspaceProps['onReview'];
  onClose: () => void;
  onReload?: () => void;
}) {
  const [revisionId] = useState(day.revision.id);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const changed = conflict || revisionId !== day.revision?.id;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || changed) return;
    if (status === 'blocked' && !comment.trim()) { setError('Beschrijf welke afwijking moet worden opgelost.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onReview({ dayId: day.id, expectedRevisionId: revisionId, status, comment: comment.trim() || null });
      onClose();
    } catch (failure) {
      if (isHoursConflict(failure)) setConflict(true);
      else setError(toFriendlyError(failure, 'De controle is niet opgeslagen. Probeer het opnieuw.'));
    } finally { setBusy(false); }
  }
  return <form className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={submit} aria-label="Interne dagcontrole">
    <p className="text-sm font-medium">{status === 'checked' ? 'Handmatig gecontroleerd' : 'Afwijking vastleggen'}</p>
    <p className="text-xs text-muted-foreground">Je legt een controle op deze versie vast. Dit geeft de uren nog niet vrij voor export.</p>
    <div className="space-y-1.5"><Label htmlFor={`review-${day.id}`}>Toelichting controle{status === 'checked' ? ' (optioneel)' : ''}</Label><Textarea id={`review-${day.id}`} maxLength={4000} rows={2} value={comment} disabled={busy || changed} onChange={(event) => setComment(event.target.value)} /></div>
    {changed && <Alert variant="destructive"><AlertDescription>Deze dag is ondertussen gewijzigd. Controleer de actuele versie voordat je de controle vastlegt.
      {onReload && <div className="mt-2"><Button type="button" variant="outline" size="sm" onClick={onReload}>Actuele uren laden</Button></div>}
    </AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || changed}>{busy ? 'Opslaan…' : 'Controle opslaan'}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Annuleren</Button></div>
  </form>;
}

function RevisionSource({ revision }: { revision: HoursRevisionView }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="flex items-start gap-1.5"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Bron: <span data-no-translate="true">{revision.sourceLabel || 'Bron niet beschikbaar'}{revision.sourceReference ? ` · ${revision.sourceReference}` : ''}</span></span>
      </p>
      {revision.notes && <p className="whitespace-pre-wrap break-words" data-no-translate="true">{revision.notes}</p>}
      <HoursSourceSummary source={revision.sourceInput} />
    </div>
  );
}

function DayDetails({ day }: { day: HoursDayView }) {
  const confirmation = currentConfirmation(day);
  return (
    <div className="space-y-2">
      {day.revision && <RevisionSource revision={day.revision} />}
      {confirmation?.comment && <p className="text-xs">Reactie medewerker: <span className="whitespace-pre-wrap break-words" data-no-translate="true">{confirmation.comment}</span></p>}
      {day.review?.revisionId === day.revision?.id && day.review?.comment && <p className="text-xs">Interne controle: <span className="whitespace-pre-wrap break-words" data-no-translate="true">{day.review.comment}</span></p>}
      {day.issues?.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">{day.issues.map((issue, index) => <li key={index} data-no-translate="true">{issue}</li>)}</ul>}
      {day.history?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Eerdere versies ({day.history.length})</summary>
          <ol className="mt-2 space-y-3 border-l pl-3">
            {day.history.map((revision) => <li key={revision.id} className="space-y-1">
              <p>Versie {revision.version} · {revision.noHoursReason ? 'Geen uren' : revision.minutes == null ? 'Ontbreekt' : `${formatHours(revision.minutes)} uur`}</p>
              {revision.noHoursReason && <p data-no-translate="true">{revision.noHoursReason}</p>}
              <RevisionSource revision={revision} />
              {revision.classification && <HoursClassificationDetails classification={revision.classification} revisionId={revision.id} />}
            </li>)}
          </ol>
        </details>
      )}
    </div>
  );
}

function DayStatus({ day }: { day: HoursDayView }) {
  const confirmation = currentConfirmation(day);
  if (!day.revision) return <Badge variant="outline">Ontbreekt</Badge>;
  if (confirmation?.status === 'disputed') return <Badge variant="destructive">Betwist</Badge>;
  if (confirmation?.status === 'confirmed') return <Badge variant="secondary"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Medewerker akkoord</Badge>;
  return <Badge variant="outline">Wacht op medewerker</Badge>;
}

function DayEditor({ day, onSave, onCancel, onReload }: {
  day: HoursDayView;
  onSave: HoursWeekWorkspaceProps['onSaveDay'];
  onCancel: () => void;
  onReload?: () => void;
}) {
  // The draft retains the revision that was visible when editing started.
  const [baseRevision] = useState(day.revision);
  const [hours, setHours] = useState(() => baseRevision?.minutes ? `${Math.floor(baseRevision.minutes / 60)}:${String(baseRevision.minutes % 60).padStart(2, '0')}` : '');
  const [noHours, setNoHours] = useState(Boolean(baseRevision?.noHoursReason));
  const [reason, setReason] = useState(baseRevision?.noHoursReason ?? '');
  const [notes, setNotes] = useState(baseRevision?.notes ?? '');
  const [sourceDraft, setSourceDraft] = useState(() => sourceDraftFromInput(baseRevision?.sourceInput));
  const [initialSourceDraft] = useState(JSON.stringify(sourceDraft));
  const [sourceRemovalConfirmed, setSourceRemovalConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverConflict, setServerConflict] = useState(false);
  const changed = (day.revision?.id ?? null) !== (baseRevision?.id ?? null) || serverConflict;
  const sourceChanged = JSON.stringify(sourceDraft) !== initialSourceDraft;
  const compiledSource = compileHoursSourceInput(sourceDraft);
  const sourceInput = !sourceChanged ? baseRevision?.sourceInput ?? null : compiledSource.ok ? compiledSource.value : null;
  const removesSource = sourceChanged && removedSourceSections(baseRevision?.sourceInput, sourceDraft);
  const controlTotal = noHours ? { ok: true as const, value: 0 } : parseHoursToMinutes(hours, { maxMinutes: 1440 });
  const sourceIssues = controlTotal.ok && compiledSource.ok ? sourceControlIssues(controlTotal.value, sourceInput) : [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || changed) return;
    setError(null);
    if (noHours && !reason.trim()) {
      setError('Geef een reden op voor geen uren.');
      return;
    }
    const parsed = noHours ? { ok: true as const, value: 0 } : parseHoursToMinutes(hours, { maxMinutes: 1440 });
    if (parsed.ok === false) {
      setError(parsed.issues.map((issue) => issue.message).join(' '));
      return;
    }
    if (parsed.value === 0 && !noHours) {
      setError('Kies “Geen uren” en geef een reden op om nul uren vast te leggen.');
      return;
    }
    if (compiledSource.ok === false) { setError(compiledSource.issues.map(issue => issue.message).join(' ')); return; }
    if (removesSource && !sourceRemovalConfirmed) { setError('Bevestig expliciet dat je de eerder vastgelegde brongegevens verwijdert.'); return; }
    setSaving(true);
    try {
      await onSave({ dayId: day.id, expectedRevisionId: baseRevision?.id ?? null, minutes: parsed.value, noHoursReason: noHours ? reason.trim() : null, notes: notes.trim() || null, ...(sourceInput !== null || baseRevision?.sourceInput != null ? { sourceInput } : {}) });
      onCancel();
    } catch (failure) {
      if (isHoursConflict(failure)) setServerConflict(true);
      else setError(toFriendlyError(failure, 'Opslaan is niet gelukt. Je invoer staat er nog.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" aria-label={`Uren invoeren ${formatHoursDate(day.workDate)}`}>
      {baseRevision && <p className="text-xs text-muted-foreground">Wijziging op versie {baseRevision.version}. Na opslaan moet de medewerker gewijzigde uren opnieuw bevestigen.</p>}
      <fieldset disabled={saving || changed} className="min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox id={`no-hours-${day.id}`} checked={noHours} onCheckedChange={(value) => setNoHours(value === true)} />
          <Label htmlFor={`no-hours-${day.id}`}>Geen uren</Label>
        </div>
        {noHours ? <div className="space-y-1.5">
          <Label htmlFor={`reason-${day.id}`}>Reden geen uren</Label>
          <Input id={`reason-${day.id}`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Bijvoorbeeld vrij of ziek" />
        </div> : <div className="space-y-1.5">
          <Label htmlFor={`hours-${day.id}`}>Gewerkte uren</Label>
          <Input id={`hours-${day.id}`} value={hours} onChange={(event) => setHours(event.target.value)} inputMode="decimal" placeholder="8,5 of 8:30" aria-describedby={`hours-help-${day.id}`} autoComplete="off" />
          <p id={`hours-help-${day.id}`} className="text-xs text-muted-foreground">Een leeg veld blijft ontbrekend. Gebruik bijvoorbeeld 8,5 of 8:30 voor 8 uur en 30 minuten.</p>
        </div>}
        <HoursSourceEditor idPrefix={day.id} value={sourceDraft} onChange={value => { setSourceDraft(value); setSourceRemovalConfirmed(false); }} />
        {removesSource && <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={sourceRemovalConfirmed} onChange={event => setSourceRemovalConfirmed(event.target.checked)} />Ik bevestig dat ik de uitgeschakelde brongegevens uit de nieuwe dagversie verwijder. De eerdere versie blijft bewaard.</label>}
        <div className="space-y-1.5">
          <Label htmlFor={`notes-${day.id}`}>Opmerking bij de invoer</Label>
          <Textarea id={`notes-${day.id}`} value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </div>
      </fieldset>
      {sourceIssues.length > 0 && <Alert><AlertDescription><p className="font-medium">De brongegevens vragen om controle.</p><ul className="mt-1 space-y-1">{sourceIssues.map((issue, index) => <li key={index}>{issue.message}{issue.expectedMinutes != null && issue.actualMinutes != null ? ` Berekend: ${formatHours(issue.expectedMinutes)} uur; aangeleverd: ${formatHours(issue.actualMinutes)} uur.` : ''}</li>)}</ul><p className="mt-2">Je kunt de aangeleverde feiten opslaan. De servercontrole bepaalt daarna welke afwijkingen de uurindeling blokkeren.</p></AlertDescription></Alert>}
      {changed && <Alert variant="destructive"><AlertDescription>
        Deze dag is ondertussen gewijzigd. Je invoer is niet opgeslagen. Sluit de invoer en controleer de actuele versie voordat je verdergaat.
        {onReload && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onReload}>Actuele uren laden</Button>}
      </AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving || changed}><Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{saving ? 'Opslaan…' : 'Dag opslaan'}</Button>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>{changed ? 'Invoer sluiten' : 'Annuleren'}</Button>
      </div>
    </form>
  );
}

export function HoursWeekWorkspace({ week, onSaveDay, onReview, onClassify, onReload, sourcesSlot, readOnly: permissionReadOnly = false }: HoursWeekWorkspaceProps) {
  const readOnly = permissionReadOnly || !week.enabled;
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ dayId: string; status: HoursReviewInput['status'] } | null>(null);
  const [saved, setSaved] = useState(false);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [classificationError, setClassificationError] = useState<{ dayId: string; revisionId: string; message: string; conflict: boolean } | null>(null);
  const days = week.employees.flatMap((employee) => employee.days);
  const received = days.filter((day) => day.revision);
  const confirmed = days.filter((day) => currentConfirmation(day)?.status === 'confirmed');
  const total = received.reduce((minutes, day) => minutes + (day.revision?.minutes ?? 0), 0);
  const blockedDayCount = new Set(days.filter(day => currentConfirmation(day)?.status === 'disputed'
    || (day.review?.revisionId === day.revision?.id && day.review?.status === 'blocked')
    || (day.classification?.revisionId === day.revision?.id && day.classification?.status === 'blocked')).map(day => day.id)).size;

  const employeeCount = new Set(week.employees.map((employee) => employee.candidateId)).size;

  return <section className="space-y-5" aria-label="Klantweek uren">
    <PageHeader title={<span data-no-translate="true">{week.companyName}</span>} description={`Werkweek vanaf ${formatHoursDate(week.weekStart)}. Voer de ontvangen uren per medewerker en dag in.`} />
    {!week.enabled && <Alert><AlertDescription>Deze urenstroom staat uit voor deze opdrachtgever. Bestaande uren blijven zichtbaar. Schakel de urenstroom in om uren te wijzigen of te controleren.</AlertDescription></Alert>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card><CardContent className="p-4"><Users className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden="true" /><p className="text-xl font-semibold">{employeeCount}</p><p className="text-xs text-muted-foreground">Verwachte medewerkers</p></CardContent></Card>
      <Card><CardContent className="p-4"><FileText className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden="true" /><p className="text-xl font-semibold">{received.length} / {days.length}</p><p className="text-xs text-muted-foreground">Dagen ontvangen</p></CardContent></Card>
      <Card><CardContent className="p-4"><Check className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden="true" /><p className="text-xl font-semibold">{confirmed.length} / {received.length}</p><p className="text-xs text-muted-foreground">Medewerker akkoord</p></CardContent></Card>
      <Card><CardContent className="p-4"><Clock3 className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden="true" /><p className="text-xl font-semibold">{formatHours(total)}</p><p className="text-xs text-muted-foreground">Uren ontvangen</p></CardContent></Card>
    </div>
    {(week.submissionDeadline || week.confirmationDeadline) && <div className="space-y-1 rounded-lg border p-3 text-sm">
      {week.submissionDeadline && <p>Aanleveren vóór: <strong>{formatHoursDeadline(week.submissionDeadline)}</strong></p>}
      {week.confirmationDeadline && <p>Medewerkerakkoord vóór: <strong>{formatHoursDeadline(week.confirmationDeadline)}</strong></p>}
    </div>}
    {sourcesSlot}
    <p className="text-sm text-muted-foreground">Een lege dag is ontbrekende informatie. Ook bij geen gewerkte uren is een reden nodig. Medewerkerakkoord en interne controle blijven afzonderlijk zichtbaar.</p>
    {blockedDayCount > 0 && <p className="text-sm text-destructive">{blockedDayCount} {blockedDayCount === 1 ? 'dag vraagt' : 'dagen vragen'} aandacht door een betwisting, interne blokkade of geblokkeerde uurindeling.</p>}
    {saved && <p role="status" className="text-sm text-stat-green">De dag is opgeslagen. Gewijzigde uren wachten op een nieuwe reactie van de medewerker.</p>}
    {days.length === 0 && <Card><CardContent className="p-6 text-sm text-muted-foreground">Er staan nog geen medewerkers of dagen klaar voor deze week.</CardContent></Card>}
    {week.employees.map((employee) => <Card key={employee.id}>
      <CardHeader className="pb-3"><CardTitle className="text-base" data-no-translate="true">{employee.name}</CardTitle>{employee.placementLabel && <p className="text-xs text-muted-foreground" data-no-translate="true">{employee.placementLabel}</p>}</CardHeader>
      <CardContent className="space-y-3">
        {employee.days.map((day) => <div key={day.id} className="rounded-lg border p-3" role="group" aria-label={`${employee.name}, ${formatHoursDate(day.workDate)}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{formatHoursDate(day.workDate)} <span className="ml-2 text-sm font-normal">{!day.revision ? 'Nog niet ontvangen' : day.revision.noHoursReason ? 'Geen uren' : `${formatHours(day.revision.minutes ?? 0)} uur`}</span></p>
              {day.revision?.noHoursReason && <p className="break-words text-sm" data-no-translate="true">{day.revision.noHoursReason}</p>}
              <div className="flex flex-wrap items-center gap-2"><DayStatus day={day} />{day.revision && <span className="text-xs text-muted-foreground">Versie {day.revision.version}</span>}
                {day.revision && <span className="text-xs text-muted-foreground">{day.review?.revisionId === day.revision.id ? day.review.status === 'checked' ? 'Handmatig gecontroleerd' : 'Controle geblokkeerd' : 'Intern te controleren'}</span>}
              </div>
            </div>
            {!readOnly && editingDay !== day.id && <Button variant="outline" size="sm" disabled={editingDay !== null || reviewing !== null || classifying !== null} onClick={() => { setEditingDay(day.id); setSaved(false); }}><Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{day.revision ? 'Wijzigen' : 'Invoeren'}</Button>}
          </div>
          <div className="mt-2"><DayDetails day={day} /></div>
          {day.revision && <div className="mt-3"><HoursClassificationDetails classification={day.classification} revisionId={day.revision.id} /></div>}
          {!readOnly && onClassify && day.revision && <div className="mt-3 space-y-2">
            <Button type="button" size="sm" variant="outline" disabled={editingDay !== null || reviewing !== null || classifying !== null || (classificationError?.dayId === day.id && classificationError.revisionId === day.revision.id && classificationError.conflict)} onClick={async () => {
              const revisionId = day.revision.id; setClassifying(day.id); setClassificationError(null);
              try { await onClassify({ dayId: day.id, expectedRevisionId: revisionId }); } catch (failure) { setClassificationError({ dayId: day.id, revisionId, conflict: isHoursConflict(failure), message: isHoursConflict(failure) ? 'De dagversie of matrixbasis is ondertussen gewijzigd. Laad de actuele uren voordat je opnieuw controleert.' : toFriendlyError(failure, 'De uursoortencontrole is niet gelukt. Probeer het opnieuw.') }); } finally { setClassifying(null); }
            }}>{classifying === day.id ? 'Uursoorten controleren…' : 'Uursoorten controleren'}</Button>
            {classificationError?.dayId === day.id && classificationError.revisionId === day.revision.id && <Alert variant="destructive"><AlertDescription>{classificationError.message}{classificationError.conflict && onReload && <div className="mt-2"><Button type="button" variant="outline" size="sm" onClick={() => { setClassificationError(null); onReload(); }}>Actuele uren laden</Button></div>}</AlertDescription></Alert>}
          </div>}
          {!readOnly && onReview && day.revision && reviewing?.dayId !== day.id && <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={editingDay !== null || reviewing !== null || classifying !== null} onClick={() => { setReviewing({ dayId: day.id, status: 'checked' }); setSaved(false); }}>Handmatig gecontroleerd</Button>
            <Button size="sm" variant="outline" disabled={editingDay !== null || reviewing !== null || classifying !== null} onClick={() => { setReviewing({ dayId: day.id, status: 'blocked' }); setSaved(false); }}>Afwijking vastleggen</Button>
          </div>}
          {!readOnly && onReview && reviewing?.dayId === day.id && <ReviewEditor key={day.id} day={day} status={reviewing.status} onReview={onReview} onReload={onReload} onClose={() => setReviewing(null)} />}
          {editingDay === day.id && !readOnly && <DayEditor key={day.id} day={day} onReload={onReload} onCancel={() => setEditingDay(null)} onSave={async (input) => { await onSaveDay(input); setSaved(true); }} />}
        </div>)}
      </CardContent>
    </Card>)}
  </section>;
}

export default HoursWeekWorkspace;
