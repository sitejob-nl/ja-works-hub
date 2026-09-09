import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HoursClientWeek from '@/pages/HoursClientWeek';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

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

beforeEach(() => { invoke.mockReset(); });
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; });

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
