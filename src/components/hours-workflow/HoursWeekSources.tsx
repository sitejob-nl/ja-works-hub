import { useRef, useState } from 'react';
import { ExternalLink, FileUp, Paperclip } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ErrorState from '@/components/shared/ErrorState';
import { toFriendlyError } from '@/lib/errorMessages';
import { hoursWorkflowError } from '@/lib/hours-workflow';
import {
  formatSourceSize, HOURS_SOURCE_ACCEPT, proposalChanges,
  type HoursSourceProposal, type HoursWeekSources as HoursWeekSourcesData,
} from '@/lib/hours-sources';
import { hoursSourceViewUrl, useApplyHoursProposal, useHoursWeekSources } from '@/hooks/useHoursWeekSources';
import { parseHoursToMinutes } from '../../../supabase/functions/_shared/hours-calculation';
import { compileHoursSourceInput, sourceControlIssues, sourceDraftFromInput, type HoursSourceInput } from './hours-day-source';
import { HoursSourceEditor } from './HoursSourceEditor';
import { HoursSourceSummary } from './HoursSourceSummary';
import { formatHoursDate, isHoursConflict } from './presentation';
import type { HoursWeekView } from './types';

export interface HoursWeekSourcesProps {
  organizationId: string;
  week: HoursWeekView;
  onReload?: () => void;
}

interface DayTarget {
  dayId: string; workDate: string; employeeName: string;
  current: { minutes: number; noHoursReason: string | null; notes: string | null; sourceInput?: HoursSourceInput | null; revisionId: string } | null;
}

function dayTargets(week: HoursWeekView): DayTarget[] {
  return week.employees.flatMap(employee => employee.days.map(day => ({
    dayId: day.id, workDate: day.workDate, employeeName: employee.name,
    current: day.revision ? {
      minutes: day.revision.minutes ?? 0, noHoursReason: day.revision.noHoursReason,
      notes: day.revision.notes, sourceInput: day.revision.sourceInput, revisionId: day.revision.id,
    } : null,
  })));
}

function ViewSourceButton({ path, fileName }: { path: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { window.open(await hoursSourceViewUrl(path), '_blank', 'noopener,noreferrer'); }
      catch (failure) { setError(toFriendlyError(failure, 'De bron kon niet worden geopend. Probeer het opnieuw.')); }
      finally { setBusy(false); }
    }}>
      <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      {busy ? 'Bron openen…' : `Bron bekijken`}
      <span className="sr-only"> — {fileName}</span>
    </Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </>;
}

function ProposalForm({ targets, onCancel, onSubmit }: {
  targets: DayTarget[];
  onCancel: () => void;
  onSubmit: (input: { dayId: string; minutes: number; noHoursReason: string | null; note: string | null; sourceInput: HoursSourceInput | null; pageLabel: string | null }) => Promise<void>;
}) {
  const [dayId, setDayId] = useState('');
  const [hours, setHours] = useState('');
  const [noHours, setNoHours] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pageLabel, setPageLabel] = useState('');
  const [draft, setDraft] = useState(() => sourceDraftFromInput(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compiled = compileHoursSourceInput(draft);
  const controlTotal = noHours ? { ok: true as const, value: 0 } : parseHoursToMinutes(hours, { maxMinutes: 1440 });
  const issues = controlTotal.ok && compiled.ok ? sourceControlIssues(controlTotal.value, compiled.value) : [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!dayId) { setError('Kies de medewerker en werkdag waar dit voorstel bij hoort.'); return; }
    if (noHours && !reason.trim()) { setError('Geef een reden op voor geen uren.'); return; }
    const parsed = noHours ? { ok: true as const, value: 0 } : parseHoursToMinutes(hours, { maxMinutes: 1440 });
    if (parsed.ok === false) { setError(parsed.issues.map(issue => issue.message).join(' ')); return; }
    if (parsed.value === 0 && !noHours) { setError('Kies “Geen uren” en geef een reden op om nul uren voor te stellen.'); return; }
    if (compiled.ok === false) { setError(compiled.issues.map(issue => issue.message).join(' ')); return; }
    setBusy(true);
    try {
      await onSubmit({
        dayId, minutes: parsed.value, noHoursReason: noHours ? reason.trim() : null,
        note: note.trim() || null, sourceInput: compiled.value, pageLabel: pageLabel.trim() || null,
      });
      onCancel();
    } catch (failure) { setError(hoursWorkflowError(failure)); }
    finally { setBusy(false); }
  }

  return <form className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={submit} aria-label="Invoervoorstel uit bron">
    <p className="text-sm font-medium">Invoervoorstel vastleggen</p>
    <p className="text-xs text-muted-foreground">Neem over wat er in de bron staat. Een voorstel is nog geen urenversie; toepassen is een aparte stap.</p>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="proposal-day">Medewerker en werkdag</Label>
        <select id="proposal-day" className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={dayId} onChange={event => setDayId(event.target.value)}>
          <option value="">Kies medewerker en dag</option>
          {targets.map(target => <option key={target.dayId} value={target.dayId}>{target.employeeName} — {formatHoursDate(target.workDate)}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="proposal-no-hours" checked={noHours} onCheckedChange={value => setNoHours(value === true)} />
        <Label htmlFor="proposal-no-hours">Geen uren</Label>
      </div>
      {noHours ? <div className="space-y-1.5">
        <Label htmlFor="proposal-reason">Reden geen uren</Label>
        <Input id="proposal-reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="Bijvoorbeeld vrij of ziek" />
      </div> : <div className="space-y-1.5">
        <Label htmlFor="proposal-hours">Gewerkte uren volgens de bron</Label>
        <Input id="proposal-hours" value={hours} inputMode="decimal" autoComplete="off" placeholder="8,5 of 8:30" onChange={event => setHours(event.target.value)} />
      </div>}
      <div className="space-y-1.5">
        <Label htmlFor="proposal-page">Vindplaats in de bron</Label>
        <Input id="proposal-page" value={pageLabel} maxLength={200} onChange={event => setPageLabel(event.target.value)} placeholder="Bijvoorbeeld pagina 2 of tabelregel 4" />
      </div>
      <HoursSourceEditor idPrefix="proposal" value={draft} onChange={setDraft} />
      <div className="space-y-1.5">
        <Label htmlFor="proposal-note">Opmerking bij het voorstel</Label>
        <Textarea id="proposal-note" rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} />
      </div>
    </fieldset>
    {issues.length > 0 && <Alert><AlertDescription>
      <p className="font-medium">De brongegevens vragen om controle.</p>
      <ul className="mt-1 space-y-1">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
      <p className="mt-2">Je kunt het voorstel bewaren; de servercontrole bepaalt wat de urenindeling blokkeert.</p>
    </AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Opslaan…' : 'Voorstel bewaren'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Annuleren</Button>
    </div>
  </form>;
}

function ProposalRow({ proposal, target, canManage, onApply, onDiscard, onReload }: {
  proposal: HoursSourceProposal;
  target: DayTarget | undefined;
  canManage: boolean;
  onApply: (input: { proposalId: string; expectedRevisionId: string | null }) => Promise<{ createdRevision: boolean }>;
  onDiscard: (input: { proposalId: string; note: string | null }) => Promise<unknown>;
  onReload?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardNote, setDiscardNote] = useState('');
  const changes = proposal.status === 'open' ? proposalChanges(proposal, target?.current ?? null) : [];

  async function apply() {
    setBusy(true); setError(null);
    try {
      const result = await onApply({ proposalId: proposal.id, expectedRevisionId: target?.current?.revisionId ?? null });
      setOutcome(result.createdRevision
        ? 'Toegepast als nieuwe dagversie. De medewerker moet de gewijzigde uren opnieuw bevestigen.'
        : 'Het voorstel kwam overeen met de huidige dagversie. Er is geen nieuwe versie gemaakt en het bestaande akkoord blijft geldig.');
    } catch (failure) {
      if (isHoursConflict(failure)) { setConflict(true); setError('Deze dag is ondertussen gewijzigd. Laad de actuele uren en beoordeel het voorstel opnieuw.'); }
      else setError(hoursWorkflowError(failure));
    } finally { setBusy(false); }
  }

  return <div className="space-y-2 rounded-lg border p-3" role="group" aria-label={`Voorstel ${proposal.candidate_name} ${proposal.work_date}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <p className="font-medium"><span data-no-translate="true">{proposal.candidate_name}</span> — {formatHoursDate(proposal.work_date)}</p>
        <p className="text-sm">{proposal.no_hours_reason
          ? `Geen uren · ${proposal.no_hours_reason}`
          : `${Math.floor(proposal.minutes / 60)}:${String(proposal.minutes % 60).padStart(2, '0')} uur`}</p>
        {proposal.page_label && <p className="text-xs text-muted-foreground" data-no-translate="true">Vindplaats: {proposal.page_label}</p>}
        {proposal.note && <p className="whitespace-pre-wrap break-words text-xs" data-no-translate="true">{proposal.note}</p>}
        <HoursSourceSummary source={proposal.source_input} />
      </div>
      {proposal.status === 'open' ? <Badge variant="outline">Nog te beoordelen</Badge>
        : proposal.status === 'applied' ? <Badge variant="secondary">{proposal.applied_created_revision ? 'Toegepast' : 'Toegepast · geen wijziging'}</Badge>
        : <Badge variant="outline">Verworpen</Badge>}
    </div>
    {proposal.status === 'discarded' && proposal.resolution_note && <p className="text-xs text-muted-foreground" data-no-translate="true">Reden: {proposal.resolution_note}</p>}
    {/* The outcome stays visible after the proposal has resolved and the actions are gone. */}
    {outcome && <p role="status" className="text-sm text-stat-green">{outcome}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}
      {conflict && onReload && <div className="mt-2"><Button type="button" size="sm" variant="outline" onClick={() => { setConflict(false); setError(null); onReload(); }}>Actuele uren laden</Button></div>}
    </AlertDescription></Alert>}
    {proposal.status === 'open' && canManage && <>
      <div className="rounded-md bg-muted/40 p-2 text-xs">
        <p className="font-medium">Wat verandert er aan de dag?</p>
        {changes.length === 0 ? <p className="mt-1">Niets — dit voorstel is gelijk aan de huidige dagversie.</p> : <ul className="mt-1 space-y-1">
          {changes.map(change => <li key={change.field}><span className="font-medium">{change.field}:</span> <span data-no-translate="true">{change.current}</span> → <span data-no-translate="true">{change.proposed}</span></li>)}
        </ul>}
      </div>
      {discarding ? <div className="space-y-2">
        <Label htmlFor={`discard-${proposal.id}`}>Waarom vervalt dit voorstel? (optioneel)</Label>
        <Textarea id={`discard-${proposal.id}`} rows={2} maxLength={2000} value={discardNote} onChange={event => setDiscardNote(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await onDiscard({ proposalId: proposal.id, note: discardNote.trim() || null }); }
            catch (failure) { setError(hoursWorkflowError(failure)); }
            finally { setBusy(false); setDiscarding(false); }
          }}>Voorstel verwerpen</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDiscarding(false)}>Annuleren</Button>
        </div>
      </div> : <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || conflict} onClick={apply}>{busy ? 'Toepassen…' : 'Toepassen als dagversie'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDiscarding(true)}>Verwerpen</Button>
      </div>}
    </>}
  </div>;
}

/** Internal intake: keep the original privately, propose, then apply explicitly. */
export function HoursWeekSources({ organizationId, week, onReload }: HoursWeekSourcesProps) {
  const sources = useHoursWeekSources(organizationId, week.id, true);
  const apply = useApplyHoursProposal(organizationId, week.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [proposingFor, setProposingFor] = useState<string | null>(null);
  const targets = dayTargets(week);
  const targetById = new Map(targets.map(target => [target.dayId, target]));
  const data: HoursWeekSourcesData | undefined = sources.data;
  const canManage = (data?.can_manage ?? false) && week.enabled;
  const openCount = data?.sources.reduce((total, source) => total + source.proposals.filter(proposal => proposal.status === 'open').length, 0) ?? 0;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setNotice(null); setUploadError(null);
    for (const file of Array.from(files)) {
      try {
        const result = await sources.upload.mutateAsync(file);
        setNotice(result.duplicate
          ? `“${file.name}” was al eerder bij deze week ontvangen. Er is geen tweede bron aangemaakt.`
          : `“${file.name}” is als bron bewaard.`);
      } catch (failure) {
        setUploadError(hoursWorkflowError(failure));
        break;
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  return <Card>
    <CardHeader className="pb-3">
      <CardTitle className="text-base">Ontvangen bronnen</CardTitle>
      <p className="text-sm text-muted-foreground">
        Bewaar het originele urenbriefje privé bij deze week, leg vast wat erin staat en pas dat pas na beoordeling toe als dagversie.
        PDF, JPG en PNG worden nu ondersteund; een bron levert nooit vanzelf uren op.
      </p>
    </CardHeader>
    <CardContent className="space-y-4">
      {sources.error ? <ErrorState message={hoursWorkflowError(sources.error)} onRetry={() => void sources.refetch()} /> : <>
        {canManage && <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" className="sr-only" accept={HOURS_SOURCE_ACCEPT} multiple
            aria-label="Urenbriefje uploaden" onChange={event => void handleFiles(event.target.files)} />
          <Button type="button" size="sm" disabled={sources.upload.isPending} onClick={() => fileInput.current?.click()}>
            <FileUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {sources.upload.isPending ? 'Bron bewaren…' : 'Urenbriefje uploaden'}
          </Button>
          <span className="text-xs text-muted-foreground">PDF, JPG of PNG, maximaal 25 MB per bestand.</span>
        </div>}
        {!week.enabled && <p className="text-sm text-muted-foreground">De urenstroom staat uit voor deze opdrachtgever. Bestaande bronnen blijven zichtbaar.</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {uploadError && <Alert variant="destructive"><AlertDescription>{uploadError}</AlertDescription></Alert>}
        {openCount > 0 && <p className="text-sm">{openCount} {openCount === 1 ? 'voorstel wacht' : 'voorstellen wachten'} op beoordeling.</p>}
        {sources.isPending ? <p role="status" className="text-sm text-muted-foreground">Bronnen laden…</p>
          : data?.sources.length === 0 ? <p className="text-sm text-muted-foreground">Er zijn nog geen bronnen bij deze week bewaard.</p>
          : data?.sources.map(source => <div key={source.id} className="space-y-3 rounded-lg border p-3"
              role="group" aria-label={`Bron ${source.file_name}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-start gap-1.5 font-medium">
                  <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="break-words" data-no-translate="true">{source.file_name}</span>
                </p>
                <p className="text-xs text-muted-foreground">{formatSourceSize(source.byte_size)} · ontvangen {formatHoursDate(source.created_at.slice(0, 10))}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ViewSourceButton path={source.storage_path} fileName={source.file_name} />
                {canManage && proposingFor !== source.id && <Button type="button" size="sm" variant="outline" disabled={!!proposingFor} onClick={() => setProposingFor(source.id)}>Voorstel maken</Button>}
              </div>
            </div>
            {proposingFor === source.id && <ProposalForm targets={targets} onCancel={() => setProposingFor(null)}
              onSubmit={async input => { await sources.createProposal.mutateAsync({ sourceId: source.id, ...input }); }} />}
            {source.proposals.length === 0
              ? <p className="text-sm text-muted-foreground">Nog geen invoervoorstel uit deze bron.</p>
              : source.proposals.map(proposal => <ProposalRow key={proposal.id} proposal={proposal} canManage={canManage}
                  target={targetById.get(proposal.day_id)} onReload={onReload}
                  onApply={input => apply.mutateAsync(input)}
                  onDiscard={input => sources.discardProposal.mutateAsync(input)} />)}
          </div>)}
      </>}
    </CardContent>
  </Card>;
}

export default HoursWeekSources;
