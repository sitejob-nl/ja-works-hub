import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HoursClientWeek, { CLIENT_WEEK_QUERY_OPTIONS, showRefusal } from '@/pages/HoursClientWeek';
import { parseClientWeek } from '@/lib/hours-client-week';

const { invoke, uploadToSignedUrl } = vi.hoisted(() => ({ invoke: vi.fn(), uploadToSignedUrl: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke }, storage: { from: () => ({ uploadToSignedUrl }) } },
}));
// pdf.js is loaded on demand in the browser; the count itself is what matters here.
vi.mock('@/lib/hours-pdf-pages', () => ({ countPdfPages: vi.fn(async () => 2) }));

const weekId = '00000000-0000-4000-8000-000000000002';
const memberId = '00000000-0000-4000-8000-000000000006';
const monday = '00000000-0000-4000-8000-00000000000a';
const tuesday = '00000000-0000-4000-8000-00000000000b';
const secret = 'f'.repeat(64);
const clients: QueryClient[] = [];

const day = (id: string, workDate: string, delivered: unknown = null) => ({ id, work_date: workDate, delivered });

const payload = (overrides: Record<string, unknown> = {}) => ({
  week: {
    id: weekId, company_name: 'Acme BV', week_start: '2026-09-07',
    submission_deadline_at: '2026-09-14T10:00:00Z',
  },
  label: 'Planning Acme', expires_at: '2099-09-22T08:00:00Z', report: null,
  members: [{
    id: memberId, candidate_name: 'Anna Nowak',
    days: [day(monday, '2026-09-07'), day(tuesday, '2026-09-08')],
  }],
  expected_days: 2, provided_days: 0, outstanding_days: 2, complete: false, ...overrides,
});

const ok = (data: unknown) => ({ data, error: null });

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/urenweek/${secret}`]}>
      <Routes><Route path="/urenweek/:token" element={<HoursClientWeek />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

const hoursField = (name: string) => screen.getByLabelText(`Gewerkte uren ${name}`);

beforeEach(() => {
  invoke.mockReset(); uploadToSignedUrl.mockReset();
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } });
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

describe('opening a personal week link', () => {
  it('shows the expected employees and days of exactly one week', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    expect(await screen.findByText('Acme BV')).toBeTruthy();
    expect(screen.getByText('Anna Nowak')).toBeTruthy();
    expect(hoursField('maandag 7 september')).toBeTruthy();
    expect(hoursField('dinsdag 8 september')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('hours-client-week', { body: { token: secret, action: 'get' } });
  });

  it('says plainly what is wrong when the link does not open', async () => {
    for (const [status, wording] of [['expired', /verlopen/i], ['revoked', /ingetrokken/i],
      ['invalid', /werkt niet/i], ['unavailable', /niet beschikbaar/i]] as const) {
      invoke.mockResolvedValue(ok({ status }));
      show();
      expect(await screen.findByText(wording)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Uren opslaan' })).toBeNull();
      cleanup();
    }
  });

  it('never renders a week that the server refused', async () => {
    invoke.mockResolvedValue(ok({ status: 'expired', week: payload() }));
    show();
    expect(await screen.findByText(/verlopen/i)).toBeTruthy();
    expect(screen.queryByText('Anna Nowak')).toBeNull();
  });
});

describe('filling in the week', () => {
  it('sends 8,5 and 8:30 as the same duration', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    fireEvent.change(await screen.findByLabelText('Gewerkte uren maandag 7 september'), { target: { value: '8,5' } });
    fireEvent.change(hoursField('dinsdag 8 september'), { target: { value: '8:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('hours-client-week', {
      body: {
        token: secret, action: 'save',
        entries: [
          { day_id: monday, hours: '8,5', no_hours: false, reason: '', note: '' },
          { day_id: tuesday, hours: '8:30', no_hours: false, reason: '', note: '' },
        ],
      },
    }));
  });

  it('leaves an untouched day out of the delivery entirely', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    fireEvent.change(await screen.findByLabelText('Gewerkte uren maandag 7 september'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    await waitFor(() => {
      const call = invoke.mock.calls.find(([, options]) => options?.body?.action === 'save');
      expect(call?.[1].body.entries).toEqual([
        { day_id: monday, hours: '8', no_hours: false, reason: '', note: '' },
      ]);
    });
  });

  it('asks for a reason before it will send no hours', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    fireEvent.click(await screen.findByLabelText('Geen uren maandag 7 september'));
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reden/i);
    expect(invoke.mock.calls.filter(([, options]) => options?.body?.action === 'save')).toHaveLength(0);
  });

  it('refuses a duration it cannot read, without sending anything', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    fireEvent.change(await screen.findByLabelText('Gewerkte uren maandag 7 september'), { target: { value: 'acht' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/8,5/);
    expect(invoke.mock.calls.filter(([, options]) => options?.body?.action === 'save')).toHaveLength(0);
  });

  it('says there is nothing to save when nothing was filled in', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uren opslaan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/niets ingevuld/i);
    expect(invoke.mock.calls.filter(([, options]) => options?.body?.action === 'save')).toHaveLength(0);
  });

  it('reads back what was delivered, so a partial delivery can be continued', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload({
      provided_days: 1, outstanding_days: 1,
      members: [{
        id: memberId, candidate_name: 'Anna Nowak',
        days: [
          day(monday, '2026-09-07', { minutes: 510, no_hours_reason: null, note: 'Overwerk',
            status: 'open', created_at: '2026-09-08T09:00:00Z' }),
          day(tuesday, '2026-09-08'),
        ],
      }],
    }) }));
    show();
    await waitFor(() => expect((hoursField('maandag 7 september') as HTMLInputElement).value).toBe('8:30'));
    expect((hoursField('dinsdag 8 september') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/1 van 2 dagen/)).toBeTruthy();
  });

  it('shows the server refusal instead of pretending the delivery landed', async () => {
    // supabase-js hands a non-2xx back as an error with the body on `context`
    // and `data: null`. Reading only `data.error` would show the visitor
    // "Edge Function returned a non-2xx status code" and nothing useful.
    const refusal = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'Vul geldige uren in; geen uren vereist een reden' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }),
    });
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve({ data: null, error: refusal }));
    show();
    fireEvent.change(await screen.findByLabelText('Gewerkte uren maandag 7 september'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/geen uren vereist een reden/);
  });

  it('keeps the filled-in page when one workday is refused', async () => {
    // A day that no longer belongs to this week is a refusal about the request,
    // not a dead link: replacing the whole page would discard the other days.
    const refusal = Object.assign(new Error('non-2xx'), {
      context: new Response(JSON.stringify({ error: 'Deze werkdag hoort niet bij deze urenweek' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }),
    });
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve({ data: null, error: refusal }));
    show();
    fireEvent.change(await screen.findByLabelText('Gewerkte uren maandag 7 september'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/hoort niet bij deze urenweek/);
    expect((hoursField('maandag 7 september') as HTMLInputElement).value).toBe('8');
    expect(screen.getByText('Anna Nowak')).toBeTruthy();
  });
});

describe('saying something about the delivery', () => {
  it('announces a later delivery without claiming the week is done', async () => {
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve(ok({ status: 'ok', week: payload({
            report: { kind: 'later', note: 'Zaterdag volgt', created_at: '2026-09-09T07:00:00Z' },
          }) })));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Ik lever later aan' }));
    fireEvent.change(screen.getByLabelText('Toelichting (optioneel)'), { target: { value: 'Zaterdag volgt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Melding versturen' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('hours-client-week',
      { body: { token: secret, action: 'report', kind: 'later', note: 'Zaterdag volgt' } }));
    expect(await screen.findByText(/U heeft gemeld dat u later aanlevert/i)).toBeTruthy();
  });

  it('keeps hours the client typed but has not saved yet', async () => {
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve(ok({ status: 'ok', week: payload({
            report: { kind: 'later', note: null, created_at: '2026-09-09T07:00:00Z' },
          }) })));
    show();
    fireEvent.change(await screen.findByLabelText('Gewerkte uren maandag 7 september'), { target: { value: '8:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ik lever later aan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Melding versturen' }));
    await screen.findByText(/U heeft gemeld dat u later aanlevert/i);
    expect((hoursField('maandag 7 september') as HTMLInputElement).value,
      'a message about the delivery may not throw away the delivery').toBe('8:15');
  });

  it('keeps showing the open days after the client calls it complete', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload({
      provided_days: 1, outstanding_days: 1,
      report: { kind: 'complete', note: null, created_at: '2026-09-09T07:00:00Z' },
    }) }));
    show();
    expect(await screen.findByText(/1 van 2 dagen/)).toBeTruthy();
    expect(screen.getByText(/1 dag nog open/i)).toBeTruthy();
  });

  it('celebrates nothing until the server says the week is complete', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload({
      provided_days: 2, outstanding_days: 0, complete: true,
    }) }));
    show();
    expect(await screen.findByText(/Alle dagen zijn aangeleverd/i)).toBeTruthy();
  });
});

describe('keeping what the client is working on', () => {
  it('only replaces the form when there is no week to show', () => {
    // A failed *background* read still has the week in hand. Replacing the page
    // there would destroy a form someone is halfway through filling in.
    const open = { kind: 'open', week: parseClientWeek(payload()) } as const;
    expect(showRefusal(open, true)).toBe(null);
    expect(showRefusal(open, false)).toBe(null);
    expect(showRefusal({ kind: 'loading' }, true)).toBe('unavailable');
    expect(showRefusal({ kind: 'loading' }, false)).toBe(null);
    expect(showRefusal({ kind: 'refused', status: 'expired' }, false)).toBe('expired');
    expect(showRefusal({ kind: 'refused', status: 'revoked' }, true)).toBe('revoked');
  });

  it('never reloads by itself, because every read costs a throttled attempt', () => {
    // Refocusing a tab must not spend an attempt against the public rate limit,
    // and must not overwrite an open form with the server's older copy.
    expect(CLIENT_WEEK_QUERY_OPTIONS.refetchOnWindowFocus).toBe(false);
    expect(CLIENT_WEEK_QUERY_OPTIONS.refetchOnReconnect).toBe(false);
    expect(CLIENT_WEEK_QUERY_OPTIONS.refetchOnMount).toBe(false);
    expect(CLIENT_WEEK_QUERY_OPTIONS.retry).toBe(false);
  });

  it('says what it will not send instead of reporting a silent success', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    fireEvent.change(await screen.findByLabelText('Opmerking maandag 7 september (optioneel)'),
      { target: { value: 'Anna heeft overgewerkt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uren opslaan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/uren/i);
    expect(invoke.mock.calls.filter(([, options]) => options?.body?.action === 'save')).toHaveLength(0);
  });
});

describe('delivering the timesheet itself', () => {
  /** jsdom's File has no arrayBuffer(); browsers do, so the reader is stubbed here. */
  function file(name: string, type: string, bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])): File {
    const handle = new File([bytes], name, { type });
    Object.defineProperty(handle, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(0),
    });
    return handle;
  }

  it('uploads through a signed address and registers the source', async () => {
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) => {
      if (options.body.action === 'get') return Promise.resolve(ok({ status: 'ok', week: payload() }));
      if (options.body.action === 'upload') {
        return Promise.resolve(ok({ status: 'ok', path: 'org/week/abc.pdf', token: 'signed-token' }));
      }
      return Promise.resolve(ok({ status: 'ok', week: payload(), duplicate: false, source_id: 'src-1' }));
    });
    uploadToSignedUrl.mockResolvedValue({ data: { path: 'org/week/abc.pdf' }, error: null });
    show();
    await screen.findByText('Acme BV');
    fireEvent.change(screen.getByLabelText('Urenbriefje meesturen'),
      { target: { files: [file('week37.pdf', 'application/pdf')] } });
    await waitFor(() => expect(uploadToSignedUrl).toHaveBeenCalledWith(
      'org/week/abc.pdf', 'signed-token', expect.anything(), { contentType: 'application/pdf' }));
    const register = invoke.mock.calls.find(([, options]) => options?.body?.action === 'register');
    expect(register?.[1].body.file_name).toBe('week37.pdf');
    expect(register?.[1].body.content_type).toBe('application/pdf');
    expect(await screen.findByText(/is meegestuurd/i)).toBeTruthy();
  });

  it('registers a file the server already holds without uploading it again', async () => {
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) => {
      if (options.body.action === 'get') return Promise.resolve(ok({ status: 'ok', week: payload() }));
      if (options.body.action === 'upload') {
        return Promise.resolve(ok({ status: 'ok', path: 'org/week/abc.pdf', already_uploaded: true }));
      }
      return Promise.resolve(ok({ status: 'ok', week: payload(), duplicate: true, source_id: 'src-1' }));
    });
    show();
    await screen.findByText('Acme BV');
    fireEvent.change(screen.getByLabelText('Urenbriefje meesturen'),
      { target: { files: [file('week37.pdf', 'application/pdf')] } });
    await screen.findByText(/was al ontvangen/i);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a file type that can never be a timesheet, before it travels', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    show();
    await screen.findByText('Acme BV');
    fireEvent.change(screen.getByLabelText('Urenbriefje meesturen'),
      { target: { files: [file('uren.txt', 'text/plain')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/PDF/i);
    expect(invoke.mock.calls.filter(([, options]) => options?.body?.action === 'upload')).toHaveLength(0);
  });

  it('shows the server refusal when the upload address is refused', async () => {
    const refusal = Object.assign(new Error('non-2xx'), {
      context: new Response(JSON.stringify({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }),
    });
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve({ data: null, error: refusal }));
    show();
    await screen.findByText('Acme BV');
    fireEvent.change(screen.getByLabelText('Urenbriefje meesturen'),
      { target: { files: [file('week37.pdf', 'application/pdf')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Te veel verzoeken/);
  });

  it('replaces the page when the link died during an upload', async () => {
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve(ok({ status: 'revoked' })));
    show();
    await screen.findByText('Acme BV');
    fireEvent.change(screen.getByLabelText('Urenbriefje meesturen'),
      { target: { files: [file('week37.pdf', 'application/pdf')] } });
    expect(await screen.findByText(/ingetrokken/i),
      'the client must stop retrying a dead link').toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Uren opslaan' })).toBeNull();
  });

  it('does not claim a delivery when the upload itself failed', async () => {
    invoke.mockImplementation((_name: string, options: { body: { action: string } }) =>
      options.body.action === 'get'
        ? Promise.resolve(ok({ status: 'ok', week: payload() }))
        : Promise.resolve(ok({ status: 'ok', path: 'org/week/abc.pdf', token: 'signed-token' })));
    uploadToSignedUrl.mockResolvedValue({ data: null, error: new Error('storage unreachable') });
    show();
    await screen.findByText('Acme BV');
    fireEvent.change(screen.getByLabelText('Urenbriefje meesturen'),
      { target: { files: [file('week37.pdf', 'application/pdf')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/niet meegestuurd|opnieuw/i);
    expect(invoke.mock.calls.filter(([, options]) => options?.body?.action === 'register')).toHaveLength(0);
  });
});

describe('what the page must never show', () => {
  it('has no login, no internal navigation and no other week', async () => {
    invoke.mockResolvedValue(ok({ status: 'ok', week: payload() }));
    const { container } = show();
    await screen.findByText('Acme BV');
    expect(screen.queryByRole('link', { name: /inloggen/i })).toBeNull();
    expect(container.querySelectorAll('a[href^="/uren"]')).toHaveLength(0);
    expect(screen.queryByText(/Planning Acme/)).toBeNull();
  });
});
