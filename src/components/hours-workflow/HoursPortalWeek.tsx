import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { currentConfirmation, formatHours, formatHoursDate, formatHoursDeadline, hoursCopy, isHoursConflict } from './presentation';
import type { HoursConfirmAllInput, HoursDayView, HoursLanguage, HoursRespondInput, HoursWeekView } from './types';

export interface HoursPortalWeekProps {
  /** Must contain only the current employee's rows, returned by the authenticated RPC. */
  week: HoursWeekView;
  language?: HoursLanguage;
  onRespond: (input: HoursRespondInput) => Promise<void>;
  /** Only supply this when all revisions are validated atomically by one server operation. */
  onConfirmAll?: (input: HoursConfirmAllInput) => Promise<void>;
  onReload?: () => void;
  readOnly?: boolean;
}

type ResponseDraft = { dayId: string; revisionId: string; response: 'confirmed' | 'disputed'; comment: string };

function PortalDayStatus({ day, language }: { day: HoursDayView; language: HoursLanguage }) {
  const copy = hoursCopy[language];
  const confirmation = currentConfirmation(day);
  if (!day.revision) return <Badge variant="outline">{copy.missing}</Badge>;
  if (confirmation?.status === 'disputed') return <Badge variant="destructive">{copy.disputed}</Badge>;
  if (confirmation?.status === 'confirmed') return <Badge variant="secondary"><Check className="mr-1 h-3 w-3" aria-hidden="true" />{copy.confirmed}</Badge>;
  return <Badge variant="outline">{day.confirmation ? copy.previousResponse : copy.waiting}</Badge>;
}

export function HoursPortalWeek({ week, language = 'nl', onRespond, onConfirmAll, onReload, readOnly = false }: HoursPortalWeekProps) {
  const copy = hoursCopy[language];
  const [draft, setDraft] = useState<ResponseDraft | null>(null);
  const [allComment, setAllComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const days = week.employees.flatMap((employee) => employee.days);
  const received = days.filter((day) => day.revision && day.revision.minutes != null);
  const awaiting = received.filter((day) => currentConfirmation(day)?.status !== 'confirmed');
  const total = received.reduce((minutes, day) => minutes + day.revision.minutes, 0);
  const currentDraftDay = days.find((day) => day.id === draft?.dayId);
  const draftChanged = draft && currentDraftDay?.revision?.id !== draft.revisionId;

  function startResponse(day: HoursDayView, response: ResponseDraft['response']) {
    setError(null);
    setConflict(false);
    setSaved(false);
    setDraft({ dayId: day.id, revisionId: day.revision.id, response, comment: '' });
  }

  async function submitResponse(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly || !draft || busy || draftChanged || conflict) return;
    if (draft.response === 'disputed' && !draft.comment.trim()) {
      setError(copy.requiredNote);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRespond({ dayId: draft.dayId, expectedRevisionId: draft.revisionId, response: draft.response, comment: draft.comment.trim() || null });
      setDraft(null);
      setSaved(true);
    } catch (failure) {
      if (isHoursConflict(failure)) setConflict(true);
      else setError(copy.failure);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAll() {
    if (readOnly || !onConfirmAll || busy || draft || !awaiting.length || conflict) return;
    const revisions = awaiting.map((day) => ({ dayId: day.id, expectedRevisionId: day.revision.id }));
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onConfirmAll({ revisions, comment: allComment.trim() || null });
      setAllComment('');
      setSaved(true);
    } catch (failure) {
      if (isHoursConflict(failure)) setConflict(true);
      else setError(copy.failure);
    } finally {
      setBusy(false);
    }
  }

  if (!week.enabled) return <Alert data-no-translate="true" lang={language}><AlertDescription>{copy.dormant}</AlertDescription></Alert>;

  return <section className="space-y-4" data-no-translate="true" lang={language} aria-label={copy.title}>
    <PageHeader title={copy.title} description={copy.introduction} />
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="font-medium break-words">{week.companyName}</p>
        <p className="text-sm text-muted-foreground">{formatHoursDate(week.weekStart, language)}</p>
        <p className="text-2xl font-semibold">{formatHours(total, language)} <span className="text-sm font-normal text-muted-foreground">{copy.hours} · {copy.receivedTotal}</span></p>
        {week.confirmationDeadline && <p className="text-sm">{copy.deadline}: <strong>{formatHoursDeadline(week.confirmationDeadline, language)}</strong></p>}
      </CardContent>
    </Card>
    {(conflict || draftChanged) && <Alert variant="destructive"><AlertDescription>{copy.conflict}
      {onReload && <div className="mt-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(null); setConflict(false); setError(null); onReload(); }}>{copy.reload}</Button></div>}
    </AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <p role="status" className="text-sm text-stat-green">{copy.saved}</p>}
    {days.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{copy.empty}</p>}
    {week.employees.map((employee) => <Card key={employee.id}>
      <CardHeader className="pb-3"><CardTitle className="text-base break-words">{employee.name}</CardTitle>{employee.placementLabel && <p className="text-sm text-muted-foreground break-words">{employee.placementLabel}</p>}</CardHeader>
      <CardContent className="space-y-3">
        {employee.days.map((day) => {
          const confirmation = currentConfirmation(day);
          const isEditing = draft?.dayId === day.id;
          const canRespond = day.revision && day.revision.minutes != null && !readOnly;
          return <div key={day.id} className="space-y-3 rounded-lg border p-3" role="group" aria-label={formatHoursDate(day.workDate, language)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1"><p className="font-medium">{formatHoursDate(day.workDate, language)}</p><PortalDayStatus day={day} language={language} /></div>
              <p className="font-semibold">{!day.revision || day.revision.minutes == null ? '—' : day.revision.noHoursReason ? copy.noHours : `${formatHours(day.revision.minutes, language)} ${copy.hours}`}</p>
            </div>
            {day.revision?.noHoursReason && <p className="text-sm break-words">{day.revision.noHoursReason}</p>}
            {day.revision?.notes && <p className="text-sm whitespace-pre-wrap break-words"><span className="text-muted-foreground">{copy.note}: </span>{day.revision.notes}</p>}
            {day.revision && <div className="space-y-1 text-xs text-muted-foreground">
              <p>{copy.revision} {day.revision.version}</p>
              {day.revision.sourceLabel && <p className="break-words">{copy.source}: {day.revision.sourceLabel}{day.revision.sourceReference ? ` · ${day.revision.sourceReference}` : ''}</p>}
              {day.review?.revisionId === day.revision.id && day.review.status === 'blocked' ? <p>{copy.blocked}</p> : day.review?.revisionId !== day.revision.id ? <p>{copy.pendingReview}</p> : null}
            </div>}
            {confirmation?.comment && <p className="text-sm whitespace-pre-wrap break-words"><span className="text-muted-foreground">{copy.yourNote}: </span>{confirmation.comment}</p>}
            {canRespond && !isEditing && <div className="flex flex-wrap gap-2">
              {confirmation?.status !== 'confirmed' && <Button size="sm" disabled={busy || Boolean(draft) || conflict} onClick={() => startResponse(day, 'confirmed')}><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />{copy.confirm}</Button>}
              <Button size="sm" variant="outline" disabled={busy || Boolean(draft) || conflict} onClick={() => startResponse(day, 'disputed')}><MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />{copy.dispute}</Button>
            </div>}
            {!readOnly && isEditing && <form className="space-y-3 border-t pt-3" onSubmit={submitResponse} aria-label={`${draft.response === 'confirmed' ? copy.confirm : copy.dispute} ${formatHoursDate(day.workDate, language)}`}>
              <div className="space-y-1.5"><Label htmlFor={`response-${day.id}`}>{copy.responseNote}{draft.response === 'confirmed' ? ` (${copy.optional})` : ''}</Label>
                <Textarea id={`response-${day.id}`} rows={3} maxLength={4000} value={draft.comment} disabled={busy || Boolean(draftChanged) || conflict} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={busy || Boolean(draftChanged) || conflict}>{busy ? copy.saving : copy.save}</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>{copy.cancel}</Button>
              </div>
            </form>}
          </div>;
        })}
      </CardContent>
    </Card>)}
    {!readOnly && onConfirmAll && awaiting.length > 0 && <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">{copy.allHelp}</p>
      <div className="space-y-1.5"><Label htmlFor={`all-comment-${week.id}`}>{copy.responseNote} ({copy.optional})</Label><Textarea id={`all-comment-${week.id}`} rows={2} maxLength={4000} value={allComment} disabled={busy || Boolean(draft) || conflict} onChange={(event) => setAllComment(event.target.value)} /></div>
      <Button className="h-auto min-h-10 w-full whitespace-normal" disabled={busy || Boolean(draft) || conflict} onClick={confirmAll}>{busy ? copy.saving : copy.all}</Button>
    </CardContent></Card>}
    {received.length > 0 && awaiting.length === 0 && <p className="text-sm text-stat-green">{copy.complete}</p>}
  </section>;
}

export default HoursPortalWeek;
