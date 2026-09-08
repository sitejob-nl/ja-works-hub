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

const orgId = '00000000-0000-4000-8000-000000000001';
const weekId = '00000000-0000-4000-8000-000000000002';
const dayId = '00000000-0000-4000-8000-000000000003';
const sourceId = '00000000-0000-4000-8000-000000000004';
const proposalId = '00000000-0000-4000-8000-000000000005';
const memberId = '00000000-0000-4000-8000-000000000006';
const revisionA = '00000000-0000-4000-8000-00000000000a';
const revisionB = '00000000-0000-4000-8000-00000000000b';
const clients: QueryClient[] = [];

const week = (revision: HoursWeekView['employees'][number]['days'][number]['revision'] = null): HoursWeekView => ({
  id: weekId, companyName: 'Voorbeeldopdrachtgever', weekStart: '2026-09-07', enabled: true,
  employees: [{ id: memberId, candidateId: 'candidate-a', name: 'Testmedewerker', days: [
    { id: dayId, workDate: '2026-09-07', revision, confirmation: null },
  ] }],
});

const proposal = (overrides: Record<string, unknown> = {}) => ({
  id: proposalId, day_id: dayId, member_id: memberId, work_date: '2026-09-07',
  candidate_name: 'Testmedewerker', status: 'open', minutes: 285, no_hours_reason: null,
  note: null, source_input: null, page_label: 'pagina 2', applied_revision_id: null,
  applied_created_revision: null, resolution_note: null, resolved_at: null,
  created_at: '2026-09-08T08:05:00Z', ...overrides,
});

const projection = (proposals: unknown[] = [], canManage = true) => ({
  week_id: weekId, can_manage: canManage,
  sources: [{
    id: sourceId, file_name: 'week36.pdf', content_type: 'application/pdf', byte_size: 2048,
    content_hash: 'c'.repeat(64), storage_path: `${orgId}/${weekId}/${'c'.repeat(64)}.pdf`,
    created_at: '2026-09-08T08:00:00Z', proposals,
  }],
});

const emptyProjection = { week_id: weekId, can_manage: true, sources: [] };
const ok = <T,>(data: T) => ({ data, error: null });

function show(view = week()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><HoursWeekSources organizationId={orgId} week={view} /></QueryClientProvider>);
}

/** jsdom's File has no arrayBuffer(); browsers do, so the reader is stubbed here. */
function file(name: string, type: string): File {
  const value = new File(['synthetische bron'], name, { type });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => new ArrayBuffer(17) });
  return value;
}
const pdf = (name = 'week36.pdf') => file(name, 'application/pdf');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no SubtleCrypto; the digest only has to be stable within a run.
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).fill(12).buffer } });
  vi.stubGlobal('open', vi.fn());
  rpc.mockReset(); upload.mockReset(); createSignedUrl.mockReset();
  upload.mockResolvedValue({ data: { path: 'stored' }, error: null });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.unstubAllGlobals();
});

describe('internal hours intake', () => {
  it('stores an uploaded original and reports a repeat as one source, not a second', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'hours_get_week_sources') return ok(emptyProjection);
      return ok({ ...projection(), duplicate: rpc.mock.calls.filter(call => call[0] === 'hours_add_week_source').length > 1, source_id: sourceId });
    });
    show();
    await screen.findByText('Er zijn nog geen bronnen bij deze week bewaard.');
    const input = screen.getByLabelText('Urenbriefje uploaden');
    fireEvent.change(input, { target: { files: [pdf()] } });
    await screen.findByText('“week36.pdf” is als bron bewaard.');
    expect(upload).toHaveBeenCalledWith(`${orgId}/${weekId}/${'0c'.repeat(32)}.pdf`, expect.anything(),
      { contentType: 'application/pdf', upsert: false });
    expect(await screen.findByText('week36.pdf')).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [pdf('week36-doorgestuurd.pdf')] } });
    await screen.findByText('“week36-doorgestuurd.pdf” was al eerder bij deze week ontvangen. Er is geen tweede bron aangemaakt.');
    expect(screen.getAllByText('week36.pdf')).toHaveLength(1);
  });

  it('refuses an unsupported file before anything reaches storage', async () => {
    rpc.mockResolvedValue(ok(emptyProjection));
    show();
    await screen.findByText('Er zijn nog geen bronnen bij deze week bewaard.');
    fireEvent.change(screen.getByLabelText('Urenbriefje uploaden'), {
      target: { files: [file('uren.xlsx', 'application/vnd.ms-excel')] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Alleen PDF, JPG en PNG');
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('hours_add_week_source', expect.anything());
  });

  it('opens the original through a short-lived link instead of a public url', async () => {
    rpc.mockResolvedValue(ok(projection()));
    createSignedUrl.mockResolvedValue(ok({ signedUrl: 'https://storage.example/signed' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Bron bekijken/ }));
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledWith(`${orgId}/${weekId}/${'c'.repeat(64)}.pdf`, 300));
    expect(window.open).toHaveBeenCalledWith('https://storage.example/signed', '_blank', 'noopener,noreferrer');
  });

  it('records a reviewed proposal without touching the day', async () => {
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_get_week_sources' ? projection() : projection([proposal()])));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Voorstel maken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voorstel bewaren' }));
    expect(await screen.findByText(/Kies de medewerker en werkdag/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Medewerker en werkdag'), { target: { value: dayId } });
    fireEvent.change(screen.getByLabelText('Gewerkte uren volgens de bron'), { target: { value: '4,75' } });
    fireEvent.change(screen.getByLabelText('Vindplaats in de bron'), { target: { value: 'pagina 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voorstel bewaren' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_create_source_proposal', {
      p_source_id: sourceId, p_day_id: dayId, p_minutes: 285, p_no_hours_reason: null,
      p_note: null, p_source_input: null, p_page_label: 'pagina 2',
    }));
    expect(rpc).not.toHaveBeenCalledWith('hours_save_day_source', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('hours_apply_source_proposal', expect.anything());
    expect(await screen.findByText('Nog te beoordelen')).toBeInTheDocument();
  });

  it('shows what applying changes and only then writes a new day version', async () => {
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_apply_source_proposal'
      ? { applied_created_revision: true, sources: projection([proposal({ status: 'applied', applied_created_revision: true, applied_revision_id: revisionB })]) }
      : projection([proposal()])));
    show(week({ id: revisionA, version: 1, minutes: 570, noHoursReason: null, notes: null }));
    const row = await screen.findByRole('group', { name: /Voorstel Testmedewerker/ });
    expect(within(row).getByRole('listitem')).toHaveTextContent('Uren: 9:30 uur → 4:45 uur');
    fireEvent.click(within(row).getByRole('button', { name: 'Toepassen als dagversie' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_apply_source_proposal', {
      p_proposal_id: proposalId, p_expected_revision_id: revisionA,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Toegepast als nieuwe dagversie');
  });

  it('reports an unchanged application without pretending a new version exists', async () => {
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_apply_source_proposal'
      ? { applied_created_revision: false, sources: projection([proposal({ status: 'applied', applied_created_revision: false, applied_revision_id: revisionA })]) }
      : projection([proposal({ minutes: 570 })])));
    show(week({ id: revisionA, version: 1, minutes: 570, noHoursReason: null, notes: null }));
    const row = await screen.findByRole('group', { name: /Voorstel Testmedewerker/ });
    expect(within(row).getByText(/dit voorstel is gelijk aan de huidige dagversie/i)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Toepassen als dagversie' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Er is geen nieuwe versie gemaakt');
  });

  it('keeps a stale application recoverable instead of overwriting newer hours', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'hours_apply_source_proposal') throw Object.assign(new Error('conflict'), { code: 'PT409' });
      return ok(projection([proposal()]));
    });
    show(week({ id: revisionA, version: 1, minutes: 570, noHoursReason: null, notes: null }));
    const row = await screen.findByRole('group', { name: /Voorstel Testmedewerker/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Toepassen als dagversie' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ondertussen gewijzigd');
    expect(within(row).getByRole('button', { name: 'Toepassen als dagversie' })).toBeDisabled();
  });

  it('records why a proposal was discarded', async () => {
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_discard_source_proposal'
      ? projection([proposal({ status: 'discarded', resolved_at: '2026-09-08T09:00:00Z', resolution_note: 'Onleesbare pauzeregel' })])
      : projection([proposal()])));
    show();
    const row = await screen.findByRole('group', { name: /Voorstel Testmedewerker/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Verwerpen' }));
    fireEvent.change(screen.getByLabelText(/Waarom vervalt dit voorstel/), { target: { value: 'Onleesbare pauzeregel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voorstel verwerpen' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_discard_source_proposal', {
      p_proposal_id: proposalId, p_note: 'Onleesbare pauzeregel',
    }));
    expect(await screen.findByText('Verworpen')).toBeInTheDocument();
    expect(screen.getByText(/Reden: Onleesbare pauzeregel/)).toBeInTheDocument();
  });

  it('hides every intake action from a reader without manage rights', async () => {
    rpc.mockResolvedValue(ok(projection([proposal()], false)));
    show();
    expect(await screen.findByText('week36.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('Urenbriefje uploaden')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voorstel maken' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toepassen als dagversie' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bron bekijken/ })).toBeInTheDocument();
  });
});
