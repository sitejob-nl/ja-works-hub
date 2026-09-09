import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursWeekSources } from '@/components/hours-workflow/HoursWeekSources';
import type { HoursWeekView } from '@/components/hours-workflow/types';

const { rpc, upload, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(), upload: vi.fn(), createSignedUrl: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc, storage: { from: () => ({ upload, createSignedUrl }) } },
}));
vi.mock('@/lib/hours-pdf-pages', () => ({ countPdfPages: vi.fn() }));
const { buildUrl, domainState } = vi.hoisted(() => ({
  buildUrl: vi.fn((path: string) => `https://uren.acme.nl${path}`),
  domainState: { isLoading: false },
}));
vi.mock('@/hooks/usePublicUrl', () => ({
  usePublicUrlForOrg: () => ({ buildUrl, primaryDomain: null, isLoading: domainState.isLoading }),
}));

const orgId = '00000000-0000-4000-8000-000000000001';
const weekId = '00000000-0000-4000-8000-000000000002';
const dayId = '00000000-0000-4000-8000-000000000003';
const memberId = '00000000-0000-4000-8000-000000000006';
const linkId = '00000000-0000-4000-8000-00000000000c';
const proposalId = '00000000-0000-4000-8000-00000000000d';
const secret = 'a'.repeat(64);
const clients: QueryClient[] = [];

const week = (): HoursWeekView => ({
  id: weekId, companyName: 'Voorbeeldopdrachtgever', weekStart: '2026-09-07', enabled: true,
  employees: [{ id: memberId, candidateId: 'candidate-a', name: 'Testmedewerker', days: [
    { id: dayId, workDate: '2026-09-07', revision: null, confirmation: null },
  ] }],
});

const clientProposal = (overrides: Record<string, unknown> = {}) => ({
  id: proposalId, day_id: dayId, member_id: memberId, work_date: '2026-09-07',
  candidate_name: 'Testmedewerker', status: 'open', minutes: 510, no_hours_reason: null,
  note: null, source_input: null, page_label: null, page_number: null,
  assignment_uncertain: false, assignment_confirmed_at: null, assignment_note: null,
  applied_revision_id: null, applied_created_revision: null, resolution_note: null,
  resolved_at: null, created_at: '2026-09-08T09:00:00Z', ...overrides,
});

const link = (overrides: Record<string, unknown> = {}) => ({
  id: linkId, label: 'Planning Acme', created_at: '2026-09-08T08:00:00Z',
  expires_at: '2099-09-22T08:00:00Z', last_opened_at: null, revoked_at: null, revoke_note: null,
  report: null, expected_days: 7, provided_days: 0, outstanding_days: 7, complete: false,
  proposals: [], ...overrides,
});

const projection = (links: unknown[] = [], canManage = true) => ({
  week_id: weekId, can_manage: canManage,
  open_proposals: (links as { proposals?: { status?: string }[] }[])
    .flatMap(entry => entry.proposals ?? []).filter(entry => entry.status === 'open').length,
  undecided_assignments: 0, client_links: links, sources: [],
});

const ok = <T,>(data: T) => ({ data, error: null });

function show(view = week()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>
    <HoursWeekSources organizationId={orgId} week={view} />
  </QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset(); domainState.isLoading = false;
  vi.stubGlobal('location', { origin: 'https://ats.sitejob.nl' } as unknown as Location);
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

describe('handing out a personal client week link', () => {
  it('shows the address exactly once, with a warning that it will not come back', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'hours_get_week_sources') return Promise.resolve(ok(projection()));
      if (name === 'hours_issue_client_week_link') {
        return Promise.resolve(ok({ ...projection([link()]), secret, link_id: linkId }));
      }
      throw new Error(`unexpected ${name}`);
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Klantlink maken' }));
    fireEvent.change(screen.getByLabelText('Voor wie is deze link?'), { target: { value: 'Planning Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link aanmaken' }));

    // The secret is shown once, so a link issued from a preview host would be
    // unrecoverable: it has to carry the organization's verified primary domain.
    const address = await screen.findByText(`https://uren.acme.nl/urenweek/${secret}`);
    expect(address).toBeTruthy();
    expect(buildUrl).toHaveBeenCalledWith(`/urenweek/${secret}`);
    expect(screen.getByText(/niet opnieuw te zien/i)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('hours_issue_client_week_link',
      { p_week_id: weekId, p_label: 'Planning Acme', p_valid_days: 14 });
  });

  it('shows the address even when the rest of the projection cannot be read', async () => {
    // The link is committed server-side and only its digest is stored. Losing
    // the one-time address over an unreadable neighbouring field would mean
    // revoking and issuing a new one.
    rpc.mockImplementation((name: string) => {
      if (name === 'hours_get_week_sources') return Promise.resolve(ok(projection()));
      if (name === 'hours_issue_client_week_link') {
        return Promise.resolve(ok({ ...projection([link()]), sources: 'kapot', secret, link_id: linkId }));
      }
      throw new Error(`unexpected ${name}`);
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Klantlink maken' }));
    fireEvent.change(screen.getByLabelText('Voor wie is deze link?'), { target: { value: 'Planning Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link aanmaken' }));
    expect(await screen.findByText(`https://uren.acme.nl/urenweek/${secret}`)).toBeTruthy();
  });

  it('never shows the address again on a later read', async () => {
    rpc.mockResolvedValue(ok(projection([link({ last_opened_at: '2026-09-09T07:00:00Z' })])));
    show();
    expect(await screen.findByText('Planning Acme')).toBeTruthy();
    expect(screen.queryByText(new RegExp(secret))).toBeNull();
    expect(screen.queryByText(/urenweek\//)).toBeNull();
  });

  it('says which address the link will carry when there is no verified domain', async () => {
    rpc.mockResolvedValue(ok(projection()));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Klantlink maken' }));
    expect(screen.getByText(/uren\.acme\.nl/), 'the host is named before the link is made').toBeTruthy();
  });

  it('waits for the organization domain instead of handing out a fallback host', async () => {
    // The secret is shown once, so a link built on the fallback host cannot be
    // regenerated: recovery would mean revoking and issuing a new one.
    domainState.isLoading = true;
    rpc.mockResolvedValue(ok(projection()));
    show();
    expect(await screen.findByRole('button', { name: 'Klantlink maken' })).toBeDisabled();
    expect(screen.getByText(/adres van uw organisatie/i)).toBeTruthy();
  });

  it('refuses to hand out a link without a name for it', async () => {
    rpc.mockResolvedValue(ok(projection()));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Klantlink maken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link aanmaken' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/naam/i);
    expect(rpc).not.toHaveBeenCalledWith('hours_issue_client_week_link', expect.anything());
  });
});

describe('what the office sees about a delivery', () => {
  it('says how much of the week the client has delivered', async () => {
    rpc.mockResolvedValue(ok(projection([link({ provided_days: 3, outstanding_days: 4 })])));
    show();
    expect(await screen.findByText(/3 van 7 dagen aangeleverd/)).toBeTruthy();
    expect(screen.getByText(/4 nog open/)).toBeTruthy();
  });

  it('shows a complete delivery as complete', async () => {
    rpc.mockResolvedValue(ok(projection([link({ provided_days: 7, outstanding_days: 0, complete: true })])));
    show();
    expect(await screen.findByText(/Alle 7 dagen aangeleverd/)).toBeTruthy();
  });

  it('shows that the client announced a later delivery', async () => {
    rpc.mockResolvedValue(ok(projection([link({
      report: { kind: 'later', note: 'Zaterdag volgt maandag', created_at: '2026-09-09T07:00:00Z' },
    })])));
    show();
    expect(await screen.findByText(/levert later aan/i)).toBeTruthy();
    expect(screen.getByText(/Zaterdag volgt maandag/)).toBeTruthy();
  });

  it('does not call an incomplete week complete just because the client did', async () => {
    rpc.mockResolvedValue(ok(projection([link({
      provided_days: 2, outstanding_days: 5, complete: false,
      report: { kind: 'complete', note: null, created_at: '2026-09-09T07:00:00Z' },
    })])));
    show();
    expect(await screen.findByText(/meldt dit als volledig/i)).toBeTruthy();
    expect(screen.getByText(/2 van 7 dagen aangeleverd/)).toBeTruthy();
    expect(screen.queryByText(/Alle 7 dagen aangeleverd/)).toBeNull();
  });

  it('marks an expired link as expired without pretending it still works', async () => {
    rpc.mockResolvedValue(ok(projection([link({ expires_at: '2020-01-01T00:00:00Z' })])));
    show();
    expect(await screen.findByText('Verlopen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
  });

  it('keeps a withdrawn link visible with what it delivered', async () => {
    rpc.mockResolvedValue(ok(projection([link({
      revoked_at: '2026-09-09T08:00:00Z', revoke_note: 'Verkeerde contactpersoon',
      provided_days: 1, outstanding_days: 6, proposals: [clientProposal()],
    })])));
    show();
    expect(await screen.findByText('Ingetrokken')).toBeTruthy();
    expect(screen.getByText(/Verkeerde contactpersoon/)).toBeTruthy();
    expect(screen.getByText(/1 van 7 dagen aangeleverd/)).toBeTruthy();
  });
});

describe('a delivery is a proposal, and stays one', () => {
  it('keeps a long history of corrections out of the way', async () => {
    const many = Array.from({ length: 9 }, (_, index) => clientProposal({
      id: `00000000-0000-4000-8000-0000000000${(index + 20).toString(16).padStart(2, '0')}`,
      status: 'discarded', minutes: 400 + index,
      resolution_note: 'Vervangen door een latere aanlevering van de opdrachtgever',
      resolved_at: '2026-09-09T09:00:00Z',
    }));
    rpc.mockResolvedValue(ok(projection([link({ proposals: [...many, clientProposal()] })])));
    show();
    const row = await screen.findByRole('group', { name: /Klantlink Planning Acme/ });
    expect(within(row).getAllByRole('button', { name: 'Toepassen als dagversie' })).toHaveLength(1);
    const toggle = within(row).getByRole('button', { name: /eerdere aanleveringen/i });
    expect(toggle).toBeTruthy();
    expect(within(row).queryByText(/8:20 uur/)).toBeNull();
    fireEvent.click(toggle);
    expect(within(row).getAllByText(/Vervangen door een latere aanlevering/).length).toBeGreaterThan(1);
  });

  it('offers the same review as any other proposal, never a direct write', async () => {
    rpc.mockResolvedValue(ok(projection([link({ proposals: [clientProposal()] })])));
    show();
    const row = await screen.findByRole('group', { name: /Klantlink Planning Acme/ });
    expect(within(row).getAllByText(/8:30 uur/).length).toBeGreaterThan(0);
    expect(within(row).getByRole('button', { name: 'Toepassen als dagversie' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Verwerpen' })).toBeTruthy();
  });

  it('shows a delivery the client replaced as withdrawn, not as the standing one', async () => {
    rpc.mockResolvedValue(ok(projection([link({ proposals: [
      clientProposal({ id: '00000000-0000-4000-8000-0000000000e1', status: 'discarded', minutes: 480,
        resolution_note: 'Vervangen door een latere aanlevering van de opdrachtgever',
        resolved_at: '2026-09-09T09:00:00Z' }),
      clientProposal({ id: '00000000-0000-4000-8000-0000000000e2', minutes: 510 }),
    ] })])));
    show();
    const row = await screen.findByRole('group', { name: /Klantlink Planning Acme/ });
    expect(within(row).getAllByRole('button', { name: 'Toepassen als dagversie' }),
      'only the standing delivery asks for a decision').toHaveLength(1);
    fireEvent.click(within(row).getByRole('button', { name: /eerdere aanleveringen/i }));
    expect(within(row).getByText(/Vervangen door een latere aanlevering/)).toBeTruthy();
  });

  it('withdraws a link only after an explicit act', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'hours_get_week_sources') return Promise.resolve(ok(projection([link()])));
      if (name === 'hours_revoke_client_week_link') {
        return Promise.resolve(ok(projection([link({ revoked_at: '2026-09-09T08:00:00Z' })])));
      }
      throw new Error(`unexpected ${name}`);
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Intrekken' }));
    fireEvent.change(screen.getByLabelText('Waarom trekt u deze link in?'),
      { target: { value: 'Verkeerde contactpersoon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definitief intrekken' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_revoke_client_week_link',
      { p_link_id: linkId, p_note: 'Verkeerde contactpersoon' }));
  });
});

describe('a file the client delivered', () => {
  it('is marked as such next to the office\u2019s own uploads', async () => {
    rpc.mockResolvedValue(ok({
      ...projection([link()]),
      sources: [{
        id: '00000000-0000-4000-8000-0000000000f1', file_name: 'week37.pdf',
        content_type: 'application/pdf', byte_size: 2048, content_hash: 'c'.repeat(64),
        storage_path: `${orgId}/${weekId}/${'c'.repeat(64)}.pdf`, created_at: '2026-09-09T08:00:00Z',
        page_count: 1, client_link_id: linkId, pages: [], proposals: [],
      }, {
        id: '00000000-0000-4000-8000-0000000000f2', file_name: 'kantoor.pdf',
        content_type: 'application/pdf', byte_size: 2048, content_hash: 'd'.repeat(64),
        storage_path: `${orgId}/${weekId}/${'d'.repeat(64)}.pdf`, created_at: '2026-09-09T09:00:00Z',
        page_count: 1, client_link_id: null, pages: [], proposals: [],
      }],
    }));
    show();
    const delivered = await screen.findByRole('group', { name: 'Bron week37.pdf' });
    expect(within(delivered).getByText(/door de opdrachtgever/i)).toBeTruthy();
    const own = screen.getByRole('group', { name: 'Bron kantoor.pdf' });
    expect(within(own).queryByText(/door de opdrachtgever/i)).toBeNull();
  });
});

describe('a reader without the right to manage', () => {
  it('sees the delivery but cannot hand out or withdraw a link', async () => {
    rpc.mockResolvedValue(ok(projection([link({ provided_days: 2, outstanding_days: 5 })], false)));
    show();
    expect(await screen.findByText('Planning Acme')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Klantlink maken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
  });
});
