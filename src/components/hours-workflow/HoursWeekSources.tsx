import { useRef, useState } from 'react';
import { ExternalLink, FileUp, Layers, Link2, Paperclip, TableProperties } from 'lucide-react';
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
  clientLinkState, clientWeekPath, describeClientLinkProgress, describePageCount, formatSourceSize,
  HOURS_CLIENT_REPORT_LABELS, HOURS_PAGE_ASSIGNMENTS, HOURS_PAGE_ASSIGNMENT_LABELS,
  HOURS_SOURCE_ACCEPT, proposalChanges, proposalIsBlocked,
  type HoursClientLink, type HoursPageAssignment, type HoursSourcePage, type HoursSourceProposal,
  type HoursWeekSourceFile, type HoursWeekSources as HoursWeekSourcesData,
} from '@/lib/hours-sources';
import type { HoursPageEntry } from '@/lib/hours-workflow-api';
import { isReadableWorkbook } from '@/lib/hours-workbook-file';
import type { WorkbookContext, WorkbookReading } from '@/lib/hours-workbook';
import { hoursSourceViewUrl, useApplyHoursProposal, useHoursWeekSources } from '@/hooks/useHoursWeekSources';
import { usePublicUrlForOrg } from '@/hooks/usePublicUrl';
import { HoursWorkbookReading } from './HoursWorkbookReading';
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
  dayId: string; workDate: string; memberId: string; employeeName: string;
  current: { minutes: number; noHoursReason: string | null; notes: string | null; sourceInput?: HoursSourceInput | null; revisionId: string } | null;
}

function dayTargets(week: HoursWeekView): DayTarget[] {
  return week.employees.flatMap(employee => employee.days.map(day => ({
    dayId: day.id, workDate: day.workDate, memberId: employee.id, employeeName: employee.name,
    current: day.revision ? {
      minutes: day.revision.minutes ?? 0, noHoursReason: day.revision.noHoursReason,
      notes: day.revision.notes, sourceInput: day.revision.sourceInput, revisionId: day.revision.id,
    } : null,
  })));
}

/** What the reader is allowed to recognise: the members and days of this week. */
function workbookContext(week: HoursWeekView): WorkbookContext {
  return {
    members: week.employees.map(employee => ({ id: employee.id, name: employee.name })),
    days: week.employees.flatMap(employee => employee.days.map(day => ({
      id: day.id, memberId: employee.id, workDate: day.workDate,
    }))),
  };
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

/** Recording who a page belongs to; only "one employee" needs a name. */
function PageDecisionForm({ source, employees, existing, onCancel, onSubmit }: {
  source: HoursWeekSourceFile;
  employees: { id: string; name: string }[];
  existing: HoursSourcePage | null;
  onCancel: () => void;
  onSubmit: (input: { pageNumber: number; assignment: HoursPageAssignment; memberId: string | null; note: string | null }) => Promise<void>;
}) {
  const [pageNumber, setPageNumber] = useState(String(existing?.page_number ?? 1));
  const [assignment, setAssignment] = useState<HoursPageAssignment>(existing?.assignment ?? 'single');
  const [memberId, setMemberId] = useState(existing?.member_id ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recording a decision for a page that already has one replaces it. That is
  // allowed, but never a surprise.
  const replacing = existing ? null
    : source.pages.find(item => String(item.page_number) === pageNumber.trim()) ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const page = Number(pageNumber);
    if (!Number.isInteger(page) || page < 1 || (source.page_count !== null && page > source.page_count)) {
      setError(source.page_count === null
        ? 'Vul een paginanummer van 1 of hoger in.'
        : `Deze bron heeft ${source.page_count} ${source.page_count === 1 ? 'pagina' : "pagina's"}.`);
      return;
    }
    if (assignment === 'single' && !memberId) { setError('Kies de medewerker die op deze pagina staat.'); return; }
    setBusy(true);
    try {
      await onSubmit({
        pageNumber: page, assignment,
        memberId: assignment === 'single' ? memberId : null, note: note.trim() || null,
      });
      onCancel();
    } catch (failure) { setError(hoursWorkflowError(failure)); }
    finally { setBusy(false); }
  }

  return <form className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={submit} aria-label="Paginatoewijzing vastleggen">
    <p className="text-sm font-medium">Wie staat er op deze pagina?</p>
    <p className="text-xs text-muted-foreground">
      Eén bestand kan briefjes van meerdere medewerkers bevatten. Leg vast wat je ziet; een pagina met meerdere
      personen kan nooit in één handeling aan één persoon worden toegewezen.
    </p>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="page-number">Pagina{source.page_count !== null ? ` (1 t/m ${source.page_count})` : ''}</Label>
        <Input id="page-number" value={pageNumber} inputMode="numeric" autoComplete="off"
          disabled={existing !== null} onChange={event => setPageNumber(event.target.value)} />
        {existing && <p className="text-xs text-muted-foreground">
          Je wijzigt het besluit over deze pagina. Voor een andere pagina leg je een eigen toewijzing vast.
        </p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="page-assignment">Toewijzing</Label>
        <select id="page-assignment" className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          value={assignment} onChange={event => setAssignment(event.target.value as HoursPageAssignment)}>
          {HOURS_PAGE_ASSIGNMENTS.map(value => <option key={value} value={value}>{HOURS_PAGE_ASSIGNMENT_LABELS[value]}</option>)}
        </select>
      </div>
      {assignment === 'single' && <div className="space-y-1.5">
        <Label htmlFor="page-member">Medewerker op deze pagina</Label>
        <select id="page-member" className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          value={memberId} onChange={event => setMemberId(event.target.value)}>
          <option value="">Kies medewerker</option>
          {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
      </div>}
      <div className="space-y-1.5">
        <Label htmlFor="page-note">Toelichting (optioneel)</Label>
        <Textarea id="page-note" rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} />
      </div>
    </fieldset>
    {replacing && <Alert><AlertDescription>
      Pagina {replacing.page_number} heeft al een toewijzing: {HOURS_PAGE_ASSIGNMENT_LABELS[replacing.assignment]}
      {replacing.candidate_name ? <>, <span data-no-translate="true">{replacing.candidate_name}</span></> : null}.
      Opslaan vervangt die; de oude blijft als historie bewaard.
    </AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Opslaan…' : 'Toewijzing vastleggen'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Annuleren</Button>
    </div>
  </form>;
}

/** Turning one page that is on a single name into a proposal per workday. */
function PageTakeoverForm({ page, days, onCancel, onSubmit }: {
  page: HoursSourcePage;
  days: DayTarget[];
  onCancel: () => void;
  onSubmit: (entries: HoursPageEntry[]) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, { hours: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valueFor = (dayId: string) => values[dayId] ?? { hours: '', reason: '' };
  const update = (dayId: string, patch: Partial<{ hours: string; reason: string }>) =>
    setValues(current => ({ ...current, [dayId]: { ...valueFor(dayId), ...patch } }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const entries: HoursPageEntry[] = [];
    for (const day of days) {
      const { hours, reason } = valueFor(day.dayId);
      if (!hours.trim() && !reason.trim()) continue;
      if (hours.trim() && reason.trim()) {
        setError(`Kies bij ${formatHoursDate(day.workDate)} óf uren óf een reden voor geen uren, niet allebei.`);
        return;
      }
      if (reason.trim()) { entries.push({ day_id: day.dayId, minutes: 0, no_hours_reason: reason.trim() }); continue; }
      const parsed = parseHoursToMinutes(hours, { maxMinutes: 1440 });
      if (parsed.ok === false) {
        setError(`${formatHoursDate(day.workDate)}: ${parsed.issues.map(issue => issue.message).join(' ')}`);
        return;
      }
      if (parsed.value === 0) {
        setError(`Geef bij ${formatHoursDate(day.workDate)} een reden op om nul uren voor te stellen.`);
        return;
      }
      entries.push({ day_id: day.dayId, minutes: parsed.value });
    }
    if (!entries.length) { setError('Vul minstens één dag in om over te nemen.'); return; }
    setBusy(true);
    try { await onSubmit(entries); onCancel(); }
    catch (failure) { setError(hoursWorkflowError(failure)); }
    finally { setBusy(false); }
  }

  return <form className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={submit}
    aria-label={`Pagina ${page.page_number} overnemen`}>
    <p className="text-sm font-medium">Pagina {page.page_number} overnemen voor <span data-no-translate="true">{page.candidate_name}</span></p>
    <p className="text-xs text-muted-foreground">
      Neem over wat er op deze pagina staat. Elke ingevulde dag wordt een afzonderlijk voorstel; toepassen blijft
      per dag een aparte handeling. Laat een dag leeg om die over te slaan.
    </p>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      {days.map(day => <div key={day.dayId} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr]">
        <p className="self-center text-sm">{formatHoursDate(day.workDate)}</p>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`takeover-hours-${day.dayId}`}>Uren</Label>
          <Input id={`takeover-hours-${day.dayId}`} value={valueFor(day.dayId).hours} inputMode="decimal"
            autoComplete="off" placeholder="8,5 of 8:30" onChange={event => update(day.dayId, { hours: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`takeover-reason-${day.dayId}`}>Geen uren — reden</Label>
          <Input id={`takeover-reason-${day.dayId}`} value={valueFor(day.dayId).reason} maxLength={500}
            autoComplete="off" onChange={event => update(day.dayId, { reason: event.target.value })} />
        </div>
      </div>)}
    </fieldset>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Voorstellen bewaren…' : 'Voorstellen bewaren'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Annuleren</Button>
    </div>
  </form>;
}

function ProposalForm({ targets, pageCount, pageDecided, onCancel, onSubmit }: {
  targets: DayTarget[];
  pageCount: number | null;
  /** The source has been judged per page, so a proposal has to say which page. */
  pageDecided: boolean;
  onCancel: () => void;
  onSubmit: (input: { dayId: string; minutes: number; noHoursReason: string | null; note: string | null; sourceInput: HoursSourceInput | null; pageLabel: string | null; pageNumber: number | null; assignmentUncertain: boolean }) => Promise<void>;
}) {
  const [dayId, setDayId] = useState('');
  const [hours, setHours] = useState('');
  const [noHours, setNoHours] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [pageLabel, setPageLabel] = useState('');
  const [uncertain, setUncertain] = useState(false);
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
    const page = pageNumber.trim() ? Number(pageNumber) : null;
    if (page !== null && (!Number.isInteger(page) || page < 1 || (pageCount !== null && page > pageCount))) {
      setError(pageCount === null
        ? 'Vul een paginanummer van 1 of hoger in.'
        : `Deze bron heeft ${pageCount} ${pageCount === 1 ? 'pagina' : "pagina's"}.`);
      return;
    }
    if (page === null && pageDecided) {
      setError('Deze bron is per pagina beoordeeld; geef aan uit welke pagina dit voorstel komt.');
      return;
    }
    const parsed = noHours ? { ok: true as const, value: 0 } : parseHoursToMinutes(hours, { maxMinutes: 1440 });
    if (parsed.ok === false) { setError(parsed.issues.map(issue => issue.message).join(' ')); return; }
    if (parsed.value === 0 && !noHours) { setError('Kies “Geen uren” en geef een reden op om nul uren voor te stellen.'); return; }
    if (compiled.ok === false) { setError(compiled.issues.map(issue => issue.message).join(' ')); return; }
    setBusy(true);
    try {
      await onSubmit({
        dayId, minutes: parsed.value, noHoursReason: noHours ? reason.trim() : null,
        note: note.trim() || null, sourceInput: compiled.value, pageLabel: pageLabel.trim() || null,
        pageNumber: page, assignmentUncertain: uncertain,
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="proposal-page-number">Pagina{pageCount !== null ? ` (1 t/m ${pageCount})` : ''}</Label>
          <Input id="proposal-page-number" value={pageNumber} inputMode="numeric" autoComplete="off"
            placeholder="Bijvoorbeeld 2" onChange={event => setPageNumber(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proposal-page">Vindplaats op die pagina</Label>
          <Input id="proposal-page" value={pageLabel} maxLength={200} onChange={event => setPageLabel(event.target.value)} placeholder="Bijvoorbeeld tabelregel 4" />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="proposal-uncertain" checked={uncertain} onCheckedChange={value => setUncertain(value === true)} />
        <div>
          <Label htmlFor="proposal-uncertain">Toewijzing onzeker</Label>
          <p className="text-xs text-muted-foreground">Weet je niet zeker om wie het gaat? Vink dit aan. Het voorstel kan dan pas worden toegepast nadat iemand de medewerker bevestigt.</p>
        </div>
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

function ProposalRow({ proposal, target, canManage, onApply, onDiscard, onConfirmAssignment, onReload }: {
  proposal: HoursSourceProposal;
  target: DayTarget | undefined;
  canManage: boolean;
  onApply: (input: { proposalId: string; expectedRevisionId: string | null }) => Promise<{ createdRevision: boolean }>;
  onDiscard: (input: { proposalId: string; note: string | null }) => Promise<unknown>;
  onConfirmAssignment: (input: { proposalId: string; note: string | null }) => Promise<unknown>;
  onReload?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardNote, setDiscardNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmNote, setConfirmNote] = useState('');
  const changes = proposal.status === 'open' ? proposalChanges(proposal, target?.current ?? null) : [];
  const blocked = proposalIsBlocked(proposal);

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

  const location = [
    proposal.page_number !== null ? `pagina ${proposal.page_number}` : null,
    proposal.page_label,
  ].filter(Boolean).join(' · ');

  return <div className="space-y-2 rounded-lg border p-3" role="group" aria-label={`Voorstel ${proposal.candidate_name} ${proposal.work_date}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <p className="font-medium"><span data-no-translate="true">{proposal.candidate_name}</span> — {formatHoursDate(proposal.work_date)}</p>
        <p className="text-sm">{proposal.no_hours_reason
          ? `Geen uren · ${proposal.no_hours_reason}`
          : `${Math.floor(proposal.minutes / 60)}:${String(proposal.minutes % 60).padStart(2, '0')} uur`}</p>
        {location && <p className="text-xs text-muted-foreground" data-no-translate="true">Vindplaats: {location}</p>}
        {proposal.note && <p className="whitespace-pre-wrap break-words text-xs" data-no-translate="true">{proposal.note}</p>}
        <HoursSourceSummary source={proposal.source_input} />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {blocked && <Badge variant="destructive">Toewijzing onbeslist</Badge>}
        {proposal.status === 'open' ? <Badge variant="outline">Nog te beoordelen</Badge>
          : proposal.status === 'applied' ? <Badge variant="secondary">{proposal.applied_created_revision ? 'Toegepast' : 'Toegepast · geen wijziging'}</Badge>
          : <Badge variant="outline">Verworpen</Badge>}
      </div>
    </div>
    {blocked && <p className="text-sm">
      Er is nog niet vastgesteld om welke medewerker dit voorstel gaat. Toepassen kan pas nadat iemand dat
      bevestigt; klopt de medewerker niet, verwerp dit voorstel dan en leg een nieuw voorstel vast.
    </p>}
    {proposal.assignment_uncertain && proposal.assignment_confirmed_at && <p className="text-xs text-muted-foreground">
      Toewijzing bevestigd{proposal.assignment_note ? <> — <span data-no-translate="true">{proposal.assignment_note}</span></> : null}
    </p>}
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
      {confirming ? <div className="space-y-2">
        <Label htmlFor={`confirm-${proposal.id}`}>Hoe heb je vastgesteld dat het om {proposal.candidate_name} gaat? (optioneel)</Label>
        <Textarea id={`confirm-${proposal.id}`} rows={2} maxLength={2000} value={confirmNote} onChange={event => setConfirmNote(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await onConfirmAssignment({ proposalId: proposal.id, note: confirmNote.trim() || null }); setConfirming(false); }
            catch (failure) { setError(hoursWorkflowError(failure)); }
            finally { setBusy(false); }
          }}>Medewerker bevestigen</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Annuleren</Button>
        </div>
      </div> : discarding ? <div className="space-y-2">
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
        {blocked && <Button type="button" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Toewijzing bevestigen</Button>}
        <Button type="button" size="sm" disabled={busy || conflict || blocked} onClick={apply}>{busy ? 'Toepassen…' : 'Toepassen als dagversie'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDiscarding(true)}>Verwerpen</Button>
      </div>}
    </>}
  </div>;
}

/** Internal intake: keep the original privately, propose per page, then apply explicitly. */
/**
 * Handing out a personal week link, and what came back through it.
 *
 * The address is shown exactly once. The database keeps only the digest of the
 * secret, so a lost link is replaced rather than looked up — the form says so
 * plainly rather than leaving the reader to find out later.
 */
/** What still asks something of the reviewer; the rest is history. */
const needsAttention = (proposal: HoursSourceProposal) => proposal.status === 'open';

function ClientLinksSection({ organizationId, links, canManage, targets, onIssue, onRevoke, onApply,
  onDiscard, onConfirmAssignment, onReload }: {
  organizationId: string;
  links: HoursClientLink[];
  canManage: boolean;
  targets: Map<string, DayTarget>;
  onIssue: (input: { label: string; validDays: number }) => Promise<{ secret: string; linkId: string }>;
  onRevoke: (input: { linkId: string; note: string | null }) => Promise<unknown>;
  onApply: (input: { proposalId: string; expectedRevisionId: string | null }) => Promise<{ createdRevision: boolean }>;
  onDiscard: (input: { proposalId: string; note: string | null }) => Promise<unknown>;
  onConfirmAssignment: (input: { proposalId: string; note: string | null }) => Promise<unknown>;
  onReload?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [validDays, setValidDays] = useState('14');
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeNote, setRevokeNote] = useState('');
  const [showHistory, setShowHistory] = useState<string | null>(null);
  // The organization's own verified domain, exactly as every other public token
  // link uses. The secret is shown once, so a link issued from a preview host
  // would be unrecoverable.
  const { buildUrl, isLoading: domainLoading, primaryDomain } = usePublicUrlForOrg(organizationId);
  // The address is shown once, so name it before the link is made: on a host
  // that is not the organization's own, the link is unusable and unrecoverable.
  const linkHost = domainLoading ? null : new URL(buildUrl(clientWeekPath('x'))).host;

  async function issue() {
    const trimmed = label.trim();
    if (!trimmed) { setError('Geef een herkenbare naam aan deze link, bijvoorbeeld de contactpersoon.'); return; }
    const days = Number(validDays);
    if (!Number.isInteger(days) || days < 1 || days > 180) {
      setError('Kies een geldigheidsduur van één tot honderdtachtig dagen.'); return;
    }
    setBusy(true); setError(null);
    try {
      const result = await onIssue({ label: trimmed, validDays: days });
      setIssued(buildUrl(clientWeekPath(result.secret)));
      setCreating(false); setLabel('');
    } catch (failure) {
      setError(hoursWorkflowError(failure));
    } finally { setBusy(false); }
  }

  async function revoke(linkId: string) {
    setBusy(true); setError(null);
    try {
      await onRevoke({ linkId, note: revokeNote.trim() || null });
      setRevoking(null); setRevokeNote('');
    } catch (failure) {
      setError(hoursWorkflowError(failure));
    } finally { setBusy(false); }
  }

  return <div className="space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="flex items-center gap-1.5 font-medium">
          <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Persoonlijke klantlinks
        </p>
        <p className="text-xs text-muted-foreground">
          De opdrachtgever vult zijn uren in zonder inloggen. Wat hij doorgeeft komt hier als voorstel binnen
          en wordt pas een dagversie als u het toepast.
        </p>
      </div>
      {canManage && !creating && <div className="flex flex-wrap items-center gap-2">
        {domainLoading && <span className="text-xs text-muted-foreground">Het adres van uw organisatie wordt opgehaald…</span>}
        <Button type="button" size="sm" variant="outline" disabled={busy || domainLoading}
          onClick={() => { setCreating(true); setIssued(null); setError(null); }}>Klantlink maken</Button>
      </div>}
    </div>

    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

    {creating && <div className="space-y-3 rounded-md bg-muted/40 p-3">
      {linkHost && <p className="text-xs text-muted-foreground">
        De link krijgt het adres <span data-no-translate="true">{linkHost}</span>
        {primaryDomain ? '.' : '. Er is nog geen geverifieerd eigen domein ingesteld; controleer of dit adres klopt voordat u de link verstuurt.'}
      </p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="client-link-label">Voor wie is deze link?</Label>
          <Input id="client-link-label" value={label} disabled={busy} maxLength={200}
            placeholder="Bijvoorbeeld: Planning Acme"
            onChange={event => setLabel(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="client-link-days">Geldig (dagen)</Label>
          <Input id="client-link-days" type="number" min={1} max={180} value={validDays} disabled={busy}
            onChange={event => setValidDays(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || domainLoading}
          onClick={() => void issue()}>Link aanmaken</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy}
          onClick={() => { setCreating(false); setError(null); }}>Annuleren</Button>
      </div>
    </div>}

    {issued && <Alert>
      <AlertDescription className="space-y-2">
        <p>Stuur dit adres naar de opdrachtgever. Het is hierna <strong>niet opnieuw te zien</strong>:
          er wordt alleen een versleutelde afdruk bewaard. Kwijt? Maak een nieuwe link en trek deze in.</p>
        <code className="block break-all rounded bg-background p-2 text-xs" data-no-translate="true">{issued}</code>
        <Button type="button" size="sm" variant="outline"
          onClick={() => void navigator.clipboard?.writeText(issued)}>Adres kopiëren</Button>
      </AlertDescription>
    </Alert>}

    {links.length === 0
      ? <p className="text-sm text-muted-foreground">Er is nog geen klantlink voor deze week.</p>
      : links.map(link => {
        const state = clientLinkState(link);
        const openProposals = link.proposals.filter(proposal => proposal.status === 'open');
        const settled = link.proposals.filter(proposal => !needsAttention(proposal));
        return <div key={link.id} className="space-y-2 rounded-md border p-3"
          role="group" aria-label={`Klantlink ${link.label}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium" data-no-translate="true">{link.label}</p>
              <p className="text-xs text-muted-foreground">
                {describeClientLinkProgress(link)}
                {link.last_opened_at ? ` · voor het laatst geopend ${formatHoursDate(link.last_opened_at.slice(0, 10))}` : ' · nog niet geopend'}
              </p>
              {link.report && <p className="text-xs text-muted-foreground">
                <span>{HOURS_CLIENT_REPORT_LABELS[link.report.kind]}</span>
                {link.report.note ? <span data-no-translate="true"> · {link.report.note}</span> : null}
              </p>}
              {link.revoke_note && <p className="text-xs text-muted-foreground" data-no-translate="true">{link.revoke_note}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={state === 'active' ? 'secondary' : 'outline'}>
                {state === 'active' ? 'Actief' : state === 'revoked' ? 'Ingetrokken' : 'Verlopen'}
              </Badge>
              {canManage && state === 'active' && revoking !== link.id &&
                <Button type="button" size="sm" variant="ghost" disabled={busy}
                  onClick={() => { setRevoking(link.id); setRevokeNote(''); }}>Intrekken</Button>}
            </div>
          </div>
          {revoking === link.id && <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <div className="space-y-1">
              <Label htmlFor={`revoke-${link.id}`}>Waarom trekt u deze link in?</Label>
              <Input id={`revoke-${link.id}`} value={revokeNote} disabled={busy} maxLength={2000}
                onChange={event => setRevokeNote(event.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Wat de opdrachtgever al heeft doorgegeven blijft staan. Intrekken kan niet ongedaan worden gemaakt.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={busy}
                onClick={() => void revoke(link.id)}>Definitief intrekken</Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy}
                onClick={() => setRevoking(null)}>Annuleren</Button>
            </div>
          </div>}
          {link.proposals.length === 0
            ? <p className="text-sm text-muted-foreground">Deze opdrachtgever heeft nog niets doorgegeven.</p>
            : <>
              {openProposals.length > 0 && <p className="text-sm">
                {openProposals.length} {openProposals.length === 1 ? 'dag wacht' : 'dagen wachten'} op uw beoordeling.
              </p>}
              {/* A client that keeps correcting leaves a withdrawn delivery
                  behind each time. What needs a decision stays in view; the
                  history is one click away instead of pushing it off screen. */}
              {(showHistory === link.id ? link.proposals : link.proposals.filter(needsAttention))
                .map(proposal => <ProposalRow key={proposal.id} proposal={proposal}
                  canManage={canManage} target={targets.get(proposal.day_id)} onReload={onReload}
                  onApply={onApply} onConfirmAssignment={onConfirmAssignment} onDiscard={onDiscard} />)}
              {settled.length > 0 && <Button type="button" size="sm" variant="ghost"
                onClick={() => setShowHistory(showHistory === link.id ? null : link.id)}>
                {showHistory === link.id
                  ? `${settled.length} eerdere aanleveringen verbergen`
                  : `${settled.length} eerdere aanleveringen tonen`}
              </Button>}
            </>}
        </div>;
      })}
  </div>;
}

export function HoursWeekSources({ organizationId, week, onReload }: HoursWeekSourcesProps) {
  const sources = useHoursWeekSources(organizationId, week.id, true);
  const apply = useApplyHoursProposal(organizationId, week.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [proposingFor, setProposingFor] = useState<string | null>(null);
  const [pagingFor, setPagingFor] = useState<{ sourceId: string; page: HoursSourcePage | null } | null>(null);
  const [takingOver, setTakingOver] = useState<string | null>(null);
  const [reading, setReading] = useState<{ sourceId: string; result: WorkbookReading } | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [readingSource, setReadingSource] = useState<string | null>(null);
  const targets = dayTargets(week);
  const targetById = new Map(targets.map(target => [target.dayId, target]));
  // One panel at a time: every one of them writes to the same source.
  const busyElsewhere = !!proposingFor || !!takingOver || !!pagingFor || !!reading || !!readingSource;
  const employees = week.employees.map(employee => ({ id: employee.id, name: employee.name }));
  const data: HoursWeekSourcesData | undefined = sources.data;
  const canManage = (data?.can_manage ?? false) && week.enabled;

  /** Reading is deliberately explicit: it never happens as a side effect of uploading. */
  async function readSource(sourceId: string, path: string) {
    setReadingError(null); setNotice(null); setReadingSource(sourceId);
    try {
      setReading({ sourceId, result: await sources.readWorkbook.mutateAsync({ path, context: workbookContext(week) }) });
    } catch (failure) {
      setReadingError(hoursWorkflowError(failure));
    } finally {
      setReadingSource(null);
    }
  }

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
        Bewaar het originele urenbriefje privé bij deze week, leg per pagina vast wie erop staat, en pas een
        voorstel pas na beoordeling toe als dagversie. PDF, JPG, PNG en Excel worden ondersteund; een Excel- of
        tabelbestand kan worden uitgelezen, maar een bron levert nooit vanzelf uren op.
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
          <span className="text-xs text-muted-foreground">PDF, JPG, PNG of Excel, maximaal 25 MB per bestand.</span>
        </div>}
        {!week.enabled && <p className="text-sm text-muted-foreground">De urenstroom staat uit voor deze opdrachtgever. Bestaande bronnen blijven zichtbaar.</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {uploadError && <Alert variant="destructive"><AlertDescription>{uploadError}</AlertDescription></Alert>}
        {readingError && <Alert variant="destructive"><AlertDescription>{readingError}</AlertDescription></Alert>}
        {/* Counted by the server, so this covers the whole week and not just what is on screen. */}
        {(data?.open_proposals ?? 0) > 0 && <p className="text-sm">{data.open_proposals} {data.open_proposals === 1 ? 'voorstel wacht' : 'voorstellen wachten'} op beoordeling.</p>}
        {(data?.undecided_assignments ?? 0) > 0 && <p className="text-sm text-destructive">
          {data.undecided_assignments} {data.undecided_assignments === 1 ? 'voorstel heeft' : 'voorstellen hebben'} een
          onbesliste toewijzing en {data.undecided_assignments === 1 ? 'blokkeert' : 'blokkeren'} toepassen tot de medewerker is bevestigd.
        </p>}
        {!sources.isPending && data && <ClientLinksSection organizationId={organizationId}
          links={data.client_links} canManage={canManage}
          targets={targetById} onReload={onReload}
          onIssue={input => sources.issueClientLink.mutateAsync(input)}
          onRevoke={input => sources.revokeClientLink.mutateAsync(input)}
          onApply={input => apply.mutateAsync(input)}
          onConfirmAssignment={input => sources.confirmAssignment.mutateAsync(input)}
          onDiscard={input => sources.discardProposal.mutateAsync(input)} />}
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
                <p className="text-xs text-muted-foreground">
                  {describePageCount(source.page_count)} · {formatSourceSize(source.byte_size)} · ontvangen {formatHoursDate(source.created_at.slice(0, 10))}
                </p>
                {/* Who delivered this file matters for how it is weighed; an
                    office upload and a client delivery look identical without it. */}
                {source.client_link_id && <Badge variant="outline" className="mt-1">
                  Meegestuurd door de opdrachtgever
                </Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <ViewSourceButton path={source.storage_path} fileName={source.file_name} />
                {canManage && isReadableWorkbook(source.content_type) && reading?.sourceId !== source.id &&
                  <Button type="button" size="sm" variant="outline" disabled={busyElsewhere}
                    onClick={() => void readSource(source.id, source.storage_path)}>
                    <TableProperties className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {readingSource === source.id ? 'Uitlezen…' : 'Uitlezen'}
                  </Button>}
                {canManage && !pagingFor && <Button type="button" size="sm" variant="outline" disabled={busyElsewhere}
                  onClick={() => setPagingFor({ sourceId: source.id, page: null })}>
                  <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Paginatoewijzing
                </Button>}
                {canManage && proposingFor !== source.id && <Button type="button" size="sm" variant="outline" disabled={busyElsewhere} onClick={() => setProposingFor(source.id)}>Voorstel maken</Button>}
              </div>
            </div>
            {pagingFor?.sourceId === source.id && <PageDecisionForm source={source} employees={employees}
              existing={pagingFor.page} onCancel={() => setPagingFor(null)}
              onSubmit={async input => { await sources.setPage.mutateAsync({ sourceId: source.id, ...input }); }} />}
            {source.pages.length > 0 && <div className="space-y-2 rounded-md bg-muted/40 p-2 text-sm">
              <p className="font-medium">Paginatoewijzing</p>
              {source.pages.map(page => <div key={page.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Pagina {page.page_number} — {HOURS_PAGE_ASSIGNMENT_LABELS[page.assignment]}
                  {page.candidate_name ? <>: <span data-no-translate="true">{page.candidate_name}</span></> : null}
                  {page.note ? <span className="text-xs text-muted-foreground" data-no-translate="true"> · {page.note}</span> : null}
                </span>
                {canManage && <span className="flex flex-wrap gap-2">
                  {page.assignment === 'single' && takingOver !== page.id && <Button type="button" size="sm" variant="outline"
                    disabled={busyElsewhere}
                    onClick={() => setTakingOver(page.id)}>Hele pagina overnemen</Button>}
                  <Button type="button" size="sm" variant="ghost" disabled={busyElsewhere}
                    onClick={() => setPagingFor({ sourceId: source.id, page })}>Wijzigen</Button>
                </span>}
              </div>)}
            </div>}
            {source.pages.filter(page => takingOver === page.id).map(page => <PageTakeoverForm key={page.id} page={page}
              days={targets.filter(target => target.memberId === page.member_id)}
              onCancel={() => setTakingOver(null)}
              onSubmit={async entries => { await sources.takeOverPage.mutateAsync({ sourceId: source.id, pageNumber: page.page_number, entries }); }} />)}
            {reading?.sourceId === source.id && <HoursWorkbookReading reading={reading.result}
              alreadyProposed={new Set(source.proposals.filter(proposal => proposal.status !== 'discarded')
                .map(proposal => proposal.day_id))}
              onCancel={() => setReading(null)}
              onSave={async entries => { await sources.saveReading.mutateAsync({ sourceId: source.id, entries }); }} />}
            {proposingFor === source.id && <ProposalForm targets={targets} pageCount={source.page_count}
              pageDecided={source.pages.length > 0} onCancel={() => setProposingFor(null)}
              onSubmit={async input => { await sources.createProposal.mutateAsync({ sourceId: source.id, ...input }); }} />}
            {source.proposals.length === 0
              ? <p className="text-sm text-muted-foreground">Nog geen invoervoorstel uit deze bron.</p>
              : source.proposals.map(proposal => <ProposalRow key={proposal.id} proposal={proposal} canManage={canManage}
                  target={targetById.get(proposal.day_id)} onReload={onReload}
                  onApply={input => apply.mutateAsync(input)}
                  onConfirmAssignment={input => sources.confirmAssignment.mutateAsync(input)}
                  onDiscard={input => sources.discardProposal.mutateAsync(input)} />)}
          </div>)}
      </>}
    </CardContent>
  </Card>;
}

export default HoursWeekSources;
