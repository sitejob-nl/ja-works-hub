import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CLIENT_LINK_MESSAGES, formatClientHours, parseClientWeek,
  type ClientLinkStatus, type ClientWeek,
} from '@/lib/hours-client-week';
import { buildClientEntries } from '../../supabase/functions/_shared/hours-client-entries.ts';
import {
  HOURS_SOURCE_ACCEPT, HOURS_SOURCE_BUCKET, hoursSourceDigest, hoursSourceTypeError,
  type HoursSourceContentType,
} from '@/lib/hours-sources';
import { countPdfPages } from '@/lib/hours-pdf-pages';
import {
  countWorkbookSheets, isReadableWorkbook, isWorkbookSource, workbookBytesError, workbookContentType,
} from '@/lib/hours-workbook-file';

/**
 * The personal client week page. No login, no session, no navigation into the
 * rest of the platform: a token opens exactly one week of one client.
 *
 * Everything a client fills in here becomes a *proposal*. This page cannot write
 * an hour, and the wording says so, so nobody mistakes a saved delivery for
 * approved time.
 */

interface DayDraft { hours: string; noHours: boolean; reason: string; note: string }

export type PageState =
  | { kind: 'loading' }
  | { kind: 'refused'; status: ClientLinkStatus }
  | { kind: 'open'; week: ClientWeek };

/**
 * This page is a form someone fills in over minutes, not a dashboard. Every read
 * also spends one attempt against the public rate limit and stamps the link as
 * opened, so it reads exactly when the visitor asks for it and never on its own.
 */
export const CLIENT_WEEK_QUERY_OPTIONS = {
  retry: false as const,
  refetchOnWindowFocus: false as const,
  refetchOnReconnect: false as const,
  refetchOnMount: false as const,
  staleTime: Infinity,
};

/**
 * Which refusal to show, if any. A failed *background* read still has the week
 * in hand: replacing the page there would destroy what is being typed, so only
 * a page with nothing to show is replaced.
 */
export function showRefusal(state: PageState, isError: boolean): ClientLinkStatus | null {
  if (state.kind === 'open') return null;
  if (state.kind === 'refused') return state.status;
  return isError ? 'unavailable' : null;
}

/** What the server sent back, without trusting that a week came with it. */
function readResponse(data: unknown): PageState {
  const body = (data ?? {}) as { status?: unknown; week?: unknown };
  if (body.status !== 'ok' || !body.week) {
    const status = typeof body.status === 'string' && body.status in CLIENT_LINK_MESSAGES
      ? body.status as ClientLinkStatus : 'unavailable';
    return { kind: 'refused', status };
  }
  return { kind: 'open', week: parseClientWeek(body.week) };
}

function draftsFor(week: ClientWeek): Record<string, DayDraft> {
  const drafts: Record<string, DayDraft> = {};
  for (const member of week.members) {
    for (const day of member.days) {
      const delivered = day.delivered;
      drafts[day.id] = {
        hours: delivered && delivered.minutes > 0 ? formatClientHours(delivered.minutes) : '',
        noHours: !!delivered && delivered.minutes === 0,
        reason: delivered?.no_hours_reason ?? '',
        note: delivered?.note ?? '',
      };
    }
  }
  return drafts;
}

/**
 * Written out in full. The internal screens abbreviate ("ma 7 sep") because a
 * reviewer scans a whole week at a time; someone filling in this page once a
 * week reads better with the day spelled out.
 */
function dayLabel(workDate: string): string {
  return new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${workDate}T12:00:00Z`));
}

export default function HoursClientWeek() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DayDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<'later' | 'complete' | null>(null);
  const [reportNote, setReportNote] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * supabase-js hands a non-2xx back as an error with `data: null` and the body
   * on `error.context`. Reading only `data` would show the visitor the transport
   * message instead of the server's own words about what it refused.
   */
  const call = async (body: Record<string, unknown>) => {
    const { data, error: failure } = await supabase.functions.invoke('hours-client-week', {
      body: { token, ...body },
    });
    if (failure) {
      if (failure.context instanceof Response) {
        const refusal = await failure.context.clone().json().catch(() => null) as { error?: unknown } | null;
        if (refusal && typeof refusal.error === 'string') throw new Error(refusal.error);
      }
      throw failure;
    }
    const payload = (data ?? {}) as { error?: unknown };
    if (typeof payload.error === 'string') throw new Error(payload.error);
    return readResponse(data);
  };

  const page = useQuery({
    queryKey: ['hours-client-week', token],
    queryFn: () => call({ action: 'get' }),
    enabled: !!token,
    ...CLIENT_WEEK_QUERY_OPTIONS,
  });

  const state: PageState = page.data ?? { kind: 'loading' };
  const week = state.kind === 'open' ? state.week : null;

  // The delivery is read back from the server, so a client that comes back later
  // continues where it left off. It is keyed on the delivery itself and not on
  // the payload: announcing a later delivery changes the week object but not one
  // recorded hour, and re-seeding there would wipe what is being typed.
  const deliverySignature = week ? JSON.stringify(week.members.map(member =>
    member.days.map(day => [day.id, day.delivered?.minutes ?? null,
      day.delivered?.no_hours_reason ?? null, day.delivered?.note ?? null]))) : '';
  useEffect(() => {
    if (week) setDrafts(draftsFor(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the delivery, deliberately not on the payload
  }, [deliverySignature]);

  // Every write returns the whole projection, so the screen shows exactly what
  // the server now holds instead of a second, possibly different, read.
  const store = (result: PageState) => qc.setQueryData(['hours-client-week', token], result);

  const save = useMutation({
    mutationFn: async (entries: unknown[]) => call({ action: 'save', entries }),
    onSuccess: result => {
      store(result);
      if (result.kind === 'open') setNotice('Uw uren zijn doorgegeven aan uw contactpersoon.');
    },
  });

  const report = useMutation({
    mutationFn: async (input: { kind: 'later' | 'complete'; note: string }) =>
      call({ action: 'report', kind: input.kind, note: input.note }),
    onSuccess: result => { store(result); setReporting(null); setReportNote(''); },
  });

  /**
   * Delivering the timesheet itself. The bytes never pass through the server
   * that hands out the address: it signs a one-off upload for exactly this
   * object, whose path it derives from the link. What arrives is a source, not
   * hours — reading it stays a separate act by someone at the office.
   */
  const deliverFile = useMutation({
    mutationFn: async (chosen: File) => {
      const rejection = hoursSourceTypeError(chosen);
      if (rejection) throw new Error(rejection);
      const bytes = await chosen.arrayBuffer();
      // The declared media type is not proof; a workbook has to be one, and is
      // stored as what it really is so a mislabelled .xlsx stays readable.
      const notAWorkbook = isWorkbookSource(chosen.type) ? workbookBytesError(bytes) : null;
      if (notAWorkbook) throw new Error(notAWorkbook);
      const contentType = (workbookContentType(chosen.type, bytes) ?? chosen.type) as HoursSourceContentType;
      const digest = await hoursSourceDigest(bytes);
      let pageCount: number | null = null;
      try {
        if (contentType === 'application/pdf') pageCount = await countPdfPages(bytes);
        else if (isReadableWorkbook(contentType)) pageCount = await countWorkbookSheets(bytes);
      } catch { pageCount = null; }

      const { data, error: failure } = await supabase.functions.invoke('hours-client-week', {
        body: { token, action: 'upload', content_hash: digest, content_type: contentType },
      });
      if (failure) throw failure;
      const signed = (data ?? {}) as { status?: string; path?: string; token?: string; already_uploaded?: boolean; error?: string };
      if (typeof signed.error === 'string') throw new Error(signed.error);
      if (signed.status !== 'ok' || !signed.path) throw new Error(CLIENT_LINK_MESSAGES.unavailable);
      if (!signed.already_uploaded) {
        if (!signed.token) throw new Error('Uw bestand kon niet worden meegestuurd. Probeer het opnieuw.');
        const upload = await supabase.storage.from(HOURS_SOURCE_BUCKET)
          .uploadToSignedUrl(signed.path, signed.token, chosen, { contentType });
        if (upload.error) {
          throw new Error('Uw bestand is niet meegestuurd. Probeer het opnieuw.');
        }
      }
      const result = await call({
        action: 'register', content_hash: digest, file_name: chosen.name,
        content_type: contentType, page_count: pageCount,
      });
      return { state: result, duplicate: signed.already_uploaded === true, name: chosen.name };
    },
    onSuccess: outcome => {
      store(outcome.state);
      setNotice(outcome.duplicate
        ? `“${outcome.name}” was al ontvangen. Er is geen tweede bestand bewaard.`
        : `“${outcome.name}” is meegestuurd met uw uren.`);
    },
    onError: failure => setError(failure instanceof Error ? failure.message
      : 'Uw bestand is niet meegestuurd. Probeer het opnieuw.'),
  });

  const update = (dayId: string, change: Partial<DayDraft>) => {
    setError(null); setNotice(null);
    setDrafts(current => ({ ...current, [dayId]: { ...current[dayId], ...change } }));
  };

  const entries = useMemo(() => Object.entries(drafts).map(([dayId, draft]) => ({
    day_id: dayId, hours: draft.hours, no_hours: draft.noHours,
    reason: draft.reason, note: draft.note,
  })), [drafts]);

  function submit() {
    setError(null); setNotice(null);
    // Only the days that were actually filled in travel: an untouched day stays
    // unknown. The same reader runs on the server, so nothing slips past here.
    const filled = entries.filter(entry =>
      entry.no_hours || entry.hours.trim() || entry.reason.trim() || entry.note.trim());
    const { issues } = buildClientEntries(filled);
    if (issues.length) { setError(issues[0].message); return; }
    if (!filled.length) { setError('Er is niets ingevuld om op te slaan.'); return; }
    save.mutate(filled, { onError: failure => setError(failure instanceof Error ? failure.message : 'Opslaan is niet gelukt.') });
  }

  const refused = !token ? 'invalid' : showRefusal(state, page.isError);
  if (refused) {
    return <main className="mx-auto max-w-lg p-6">
      <Card><CardHeader><CardTitle className="text-base">Urenweek</CardTitle></CardHeader>
        <CardContent><p role="status">{CLIENT_LINK_MESSAGES[refused]}</p></CardContent></Card>
    </main>;
  }

  if (!week) {
    return <main className="mx-auto max-w-lg p-6"><p role="status">Urenweek laden…</p></main>;
  }

  const busy = save.isPending || report.isPending || deliverFile.isPending;
  return <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <header className="space-y-1">
      <h1 className="text-xl font-semibold" data-no-translate="true">{week.week.company_name}</h1>
      <p className="text-sm text-muted-foreground">
        Werkweek vanaf {dayLabel(week.week.week_start)}
        {week.week.submission_deadline_at
          ? ` · graag aanleveren vóór ${new Date(week.week.submission_deadline_at).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' })}`
          : ''}
      </p>
      <p className="text-sm text-muted-foreground">
        Vul per medewerker de gewerkte uren in. U kunt ook uw eigen urenbriefje meesturen als PDF, foto
        of Excel. Wat u doorgeeft wordt door uw contactpersoon beoordeeld voordat het als uren wordt
        vastgelegd. Een dag die u leeg laat blijft open staan.
      </p>
    </header>

    <p className="rounded-lg bg-muted/40 p-3 text-sm" role="status">
      {week.complete
        ? 'Alle dagen zijn aangeleverd. U kunt een correctie doorgeven zolang deze link geldig is.'
        : `${week.provided_days} van ${week.expected_days} dagen aangeleverd · ${week.outstanding_days} ${week.outstanding_days === 1 ? 'dag nog open' : 'dagen nog open'}.`}
    </p>
    {week.report && <p className="text-sm text-muted-foreground">
      <span>{week.report.kind === 'later'
        ? 'U heeft gemeld dat u later aanlevert.'
        : 'U heeft deze week als volledig gemeld.'}</span>
      {week.report.note ? <span data-no-translate="true"> {week.report.note}</span> : null}
    </p>}

    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm">{notice}</p>}

    {week.members.map(member => <Card key={member.id}>
      <CardHeader className="pb-3"><CardTitle className="text-base" data-no-translate="true">{member.candidate_name}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {member.days.map(day => {
          const draft = drafts[day.id] ?? { hours: '', noHours: false, reason: '', note: '' };
          const label = `${dayLabel(day.work_date)}`;
          return <div key={day.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_1fr]">
            <p className="text-sm font-medium">{label}</p>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`hours-${day.id}`} className="text-xs">Gewerkte uren {label}</Label>
                  <Input id={`hours-${day.id}`} inputMode="text" placeholder="8,5 of 8:30"
                    className="w-32" value={draft.hours} disabled={draft.noHours || busy}
                    onChange={event => update(day.id, { hours: event.target.value })} />
                </div>
                <label className="flex items-center gap-2 pt-4 text-sm">
                  <Checkbox id={`nohours-${day.id}`} checked={draft.noHours} disabled={busy}
                    aria-label={`Geen uren ${label}`}
                    onCheckedChange={checked => update(day.id, { noHours: checked === true, hours: '' })} />
                  Geen uren
                </label>
              </div>
              {draft.noHours && <div className="space-y-1">
                <Label htmlFor={`reason-${day.id}`} className="text-xs">Reden {label}</Label>
                <Input id={`reason-${day.id}`} value={draft.reason} disabled={busy}
                  placeholder="Bijvoorbeeld: ziek, vrij, feestdag"
                  onChange={event => update(day.id, { reason: event.target.value })} />
              </div>}
              <div className="space-y-1">
                <Label htmlFor={`note-${day.id}`} className="text-xs">Opmerking {label} (optioneel)</Label>
                <Input id={`note-${day.id}`} value={draft.note} disabled={busy}
                  onChange={event => update(day.id, { note: event.target.value })} />
              </div>
            </div>
          </div>;
        })}
      </CardContent>
    </Card>)}

    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={busy} onClick={submit}>
        {save.isPending ? 'Uren doorgeven…' : 'Uren opslaan'}
      </Button>
      <input ref={fileInput} type="file" className="sr-only" accept={HOURS_SOURCE_ACCEPT}
        aria-label="Urenbriefje meesturen" disabled={busy}
        onChange={event => {
          const chosen = event.target.files?.[0];
          setError(null); setNotice(null);
          if (chosen) deliverFile.mutate(chosen);
          if (fileInput.current) fileInput.current.value = '';
        }} />
      <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
        {deliverFile.isPending ? 'Bestand meesturen…' : 'Urenbriefje meesturen'}
      </Button>
      {!reporting && <>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setReporting('later')}>
          Ik lever later aan
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setReporting('complete')}>
          Dit is alles
        </Button>
      </>}
    </div>

    {reporting && <Card><CardContent className="space-y-3 pt-4">
      <p className="text-sm">
        {reporting === 'later'
          ? 'U laat uw contactpersoon weten dat er nog uren volgen.'
          : 'U laat uw contactpersoon weten dat u alles heeft doorgegeven. De openstaande dagen blijven zichtbaar.'}
      </p>
      <div className="space-y-1">
        <Label htmlFor="report-note">Toelichting (optioneel)</Label>
        <Textarea id="report-note" rows={2} value={reportNote} disabled={busy}
          onChange={event => setReportNote(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy}
          onClick={() => report.mutate({ kind: reporting, note: reportNote })}>Melding versturen</Button>
        <Button type="button" variant="ghost" disabled={busy}
          onClick={() => { setReporting(null); setReportNote(''); }}>Annuleren</Button>
      </div>
      {report.error && <Alert variant="destructive"><AlertDescription>
        {report.error instanceof Error ? report.error.message : 'De melding kon niet worden verstuurd.'}
      </AlertDescription></Alert>}
    </CardContent></Card>}
  </main>;
}
