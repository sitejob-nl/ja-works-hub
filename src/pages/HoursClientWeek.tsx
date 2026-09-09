import { useEffect, useMemo, useState } from 'react';
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

/**
 * The personal client week page. No login, no session, no navigation into the
 * rest of the platform: a token opens exactly one week of one client.
 *
 * Everything a client fills in here becomes a *proposal*. This page cannot write
 * an hour, and the wording says so, so nobody mistakes a saved delivery for
 * approved time.
 */

interface DayDraft { hours: string; noHours: boolean; reason: string; note: string }

type PageState =
  | { kind: 'loading' }
  | { kind: 'refused'; status: ClientLinkStatus }
  | { kind: 'open'; week: ClientWeek };

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

  const call = async (body: Record<string, unknown>) => {
    const { data, error: failure } = await supabase.functions.invoke('hours-client-week', {
      body: { token, ...body },
    });
    if (failure) throw failure;
    const payload = (data ?? {}) as { error?: unknown };
    if (typeof payload.error === 'string') throw new Error(payload.error);
    return readResponse(data);
  };

  const page = useQuery({
    queryKey: ['hours-client-week', token],
    queryFn: () => call({ action: 'get' }),
    enabled: !!token,
    retry: false,
  });

  const state: PageState = page.data ?? { kind: 'loading' };
  const week = state.kind === 'open' ? state.week : null;

  // The delivery is read back from the server every time, so a client that comes
  // back later continues where it left off rather than starting from blank.
  useEffect(() => { if (week) setDrafts(draftsFor(week)); }, [week]);

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
    const filled = entries.filter(entry => entry.no_hours || entry.hours.trim() || entry.reason.trim());
    const { issues } = buildClientEntries(filled);
    if (issues.length) { setError(issues[0].message); return; }
    if (!filled.length) { setError('Er is niets ingevuld om op te slaan.'); return; }
    save.mutate(filled, { onError: failure => setError(failure instanceof Error ? failure.message : 'Opslaan is niet gelukt.') });
  }

  if (!token || state.kind === 'refused') {
    const status = state.kind === 'refused' ? state.status : 'invalid';
    return <main className="mx-auto max-w-lg p-6">
      <Card><CardHeader><CardTitle className="text-base">Urenweek</CardTitle></CardHeader>
        <CardContent><p role="status">{CLIENT_LINK_MESSAGES[status]}</p></CardContent></Card>
    </main>;
  }

  if (page.isError) {
    return <main className="mx-auto max-w-lg p-6">
      <Card><CardHeader><CardTitle className="text-base">Urenweek</CardTitle></CardHeader>
        <CardContent><p role="status">{CLIENT_LINK_MESSAGES.unavailable}</p></CardContent></Card>
    </main>;
  }

  if (!week) {
    return <main className="mx-auto max-w-lg p-6"><p role="status">Urenweek laden…</p></main>;
  }

  const busy = save.isPending || report.isPending;
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
        Vul per medewerker de gewerkte uren in. Wat u doorgeeft wordt door uw contactpersoon beoordeeld
        voordat het als uren wordt vastgelegd. Een dag die u leeg laat blijft open staan.
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
