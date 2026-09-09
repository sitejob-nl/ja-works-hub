import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursWeekSources } from '@/components/hours-workflow/HoursWeekSources';
import type { HoursWeekView } from '@/components/hours-workflow/types';

const { rpc, upload, createSignedUrl, countPdfPages } = vi.hoisted(() => ({
  rpc: vi.fn(), upload: vi.fn(), createSignedUrl: vi.fn(), countPdfPages: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc, storage: { from: () => ({ upload, createSignedUrl }) } },
}));
// pdf.js is loaded on demand in the browser; the count itself is what matters here.
vi.mock('@/lib/hours-pdf-pages', () => ({ countPdfPages }));

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
  note: null, source_input: null, page_label: 'tabelregel 4', page_number: 2,
  assignment_uncertain: false, assignment_confirmed_at: null, assignment_note: null,
  applied_revision_id: null,
  applied_created_revision: null, resolution_note: null, resolved_at: null,
  created_at: '2026-09-08T08:05:00Z', ...overrides,
});

const projection = (proposals: unknown[] = [], canManage = true, source: Record<string, unknown> = {}) => {
  const undecided = (proposals as { status?: string; assignment_uncertain?: boolean; assignment_confirmed_at?: string | null }[])
    .filter(entry => entry.status === 'open' && entry.assignment_uncertain && !entry.assignment_confirmed_at).length;
  return {
    week_id: weekId, can_manage: canManage,
    open_proposals: (proposals as { status?: string }[]).filter(entry => entry.status === 'open').length,
    undecided_assignments: undecided,
    sources: [{
      id: sourceId, file_name: 'week36.pdf', content_type: 'application/pdf', byte_size: 2048,
      content_hash: 'c'.repeat(64), storage_path: `${orgId}/${weekId}/${'c'.repeat(64)}.pdf`,
      created_at: '2026-09-08T08:00:00Z', page_count: 3, pages: [], proposals, ...source,
    }],
  };
};

const emptyProjection = {
  week_id: weekId, can_manage: true, open_proposals: 0, undecided_assignments: 0, sources: [],
};
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
  rpc.mockReset(); upload.mockReset(); createSignedUrl.mockReset(); countPdfPages.mockReset();
  upload.mockResolvedValue({ data: { path: 'stored' }, error: null });
  countPdfPages.mockResolvedValue(3);
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

  it('records how many pages a delivered pdf has, and shows it', async () => {
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_get_week_sources'
      ? emptyProjection : { ...projection(), duplicate: false, source_id: sourceId }));
    show();
    await screen.findByText('Er zijn nog geen bronnen bij deze week bewaard.');
    fireEvent.change(screen.getByLabelText('Urenbriefje uploaden'), { target: { files: [pdf()] } });
    await screen.findByText('“week36.pdf” is als bron bewaard.');
    expect(rpc).toHaveBeenCalledWith('hours_add_week_source', expect.objectContaining({ p_page_count: 3 }));
    expect(await screen.findByText(/3 pagina/)).toBeInTheDocument();
  });

  it('keeps an uncountable pdf honest instead of guessing one page', async () => {
    countPdfPages.mockRejectedValue(new Error('beschadigd'));
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_get_week_sources'
      ? emptyProjection : { ...projection([], true, { page_count: null }), duplicate: false, source_id: sourceId }));
    show();
    await screen.findByText('Er zijn nog geen bronnen bij deze week bewaard.');
    fireEvent.change(screen.getByLabelText('Urenbriefje uploaden'), { target: { files: [pdf()] } });
    await screen.findByText('“week36.pdf” is als bron bewaard.');
    expect(rpc).toHaveBeenCalledWith('hours_add_week_source', expect.objectContaining({ p_page_count: null }));
    expect(await screen.findByText(/aantal pagina.s onbekend/)).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText(/^Pagina/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Vindplaats op die pagina'), { target: { value: 'tabelregel 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voorstel bewaren' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_create_source_proposal', {
      p_source_id: sourceId, p_day_id: dayId, p_minutes: 285, p_no_hours_reason: null,
      p_note: null, p_source_input: null, p_page_label: 'tabelregel 4', p_page_number: 2,
      p_assignment_uncertain: false,
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

  it('will not apply a proposal whose employee is still undecided, until someone confirms', async () => {
    const undecided = proposal({ assignment_uncertain: true });
    // A discarded proposal keeps neither the badge nor the instruction.
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_confirm_proposal_assignment'
      ? projection([proposal({ assignment_uncertain: true, assignment_confirmed_at: '2026-09-08T09:00:00Z',
                               assignment_note: 'Naam vergeleken met de plaatsingslijst' })])
      : projection([undecided])));
    show();
    const row = await screen.findByRole('group', { name: /Voorstel Testmedewerker/ });
    expect(within(row).getByText('Toewijzing onbeslist')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Toepassen als dagversie' })).toBeDisabled();
    expect(await screen.findByText(/1 voorstel heeft een onbesliste toewijzing/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Toewijzing bevestigen' }));
    fireEvent.change(screen.getByLabelText(/Hoe heb je vastgesteld/), { target: { value: 'Naam vergeleken met de plaatsingslijst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Medewerker bevestigen' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_confirm_proposal_assignment', {
      p_proposal_id: proposalId, p_note: 'Naam vergeleken met de plaatsingslijst',
    }));
    expect(rpc).not.toHaveBeenCalledWith('hours_apply_source_proposal', expect.anything());
    const confirmed = await screen.findByRole('group', { name: /Voorstel Testmedewerker/ });
    await waitFor(() => expect(within(confirmed).getByRole('button', { name: 'Toepassen als dagversie' })).toBeEnabled());
  });

  it('records who a page belongs to and only then offers to take the whole page over', async () => {
    const single = {
      id: '00000000-0000-4000-8000-00000000000c', page_number: 1, assignment: 'single',
      member_id: memberId, candidate_name: 'Testmedewerker', note: null, created_at: '2026-09-08T08:10:00Z',
    };
    rpc.mockImplementation(async (name: string) => ok(name === 'hours_set_source_page'
      ? projection([], true, { pages: [single] }) : projection()));
    show();
    await screen.findByText('week36.pdf');
    expect(screen.queryByRole('button', { name: 'Hele pagina overnemen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Paginatoewijzing/ }));
    const decision = await screen.findByRole('form', { name: 'Paginatoewijzing vastleggen' });
    fireEvent.change(within(decision).getByLabelText(/^Pagina/), { target: { value: '1' } });
    fireEvent.change(within(decision).getByLabelText('Medewerker op deze pagina'), { target: { value: memberId } });
    fireEvent.click(within(decision).getByRole('button', { name: 'Toewijzing vastleggen' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_set_source_page', {
      p_source_id: sourceId, p_page_number: 1, p_assignment: 'single', p_member_id: memberId, p_note: null,
    }));
    expect(await screen.findByText(/Pagina 1 — Eén medewerker/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Hele pagina overnemen' })).toBeInTheDocument();
  });

  it('keeps an existing page explanation when the decision is edited', async () => {
    const decided = {
      id: '00000000-0000-4000-8000-00000000000c', page_number: 1, assignment: 'single',
      member_id: memberId, candidate_name: 'Testmedewerker', note: 'Handtekening onderaan gecontroleerd',
      created_at: '2026-09-08T08:10:00Z',
    };
    rpc.mockResolvedValue(ok(projection([], true, { pages: [decided] })));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Wijzigen' }));
    const form = await screen.findByRole('form', { name: 'Paginatoewijzing vastleggen' });
    expect(within(form).getByLabelText(/Toelichting/)).toHaveValue('Handtekening onderaan gecontroleerd');
    // Editing page one may never quietly replace the decision on another page.
    expect(within(form).getByLabelText(/^Pagina/), 'the page being edited is fixed').toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Toewijzing'), { target: { value: 'multiple' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Toewijzing vastleggen' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_set_source_page', {
      p_source_id: sourceId, p_page_number: 1, p_assignment: 'multiple', p_member_id: null,
      p_note: 'Handtekening onderaan gecontroleerd',
    }));
  });

  it('asks which page a proposal came from once the source has been judged per page', async () => {
    const judged = {
      id: '00000000-0000-4000-8000-00000000000c', page_number: 1, assignment: 'unclear',
      member_id: null, candidate_name: null, note: null, created_at: '2026-09-08T08:10:00Z',
    };
    rpc.mockResolvedValue(ok(projection([], true, { pages: [judged] })));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Voorstel maken' }));
    const form = await screen.findByRole('form', { name: 'Invoervoorstel uit bron' });
    fireEvent.change(within(form).getByLabelText('Medewerker en werkdag'), { target: { value: dayId } });
    fireEvent.change(within(form).getByLabelText('Gewerkte uren volgens de bron'), { target: { value: '8:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Voorstel bewaren' }));
    expect(await within(form).findByText(/uit welke pagina/)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith('hours_create_source_proposal', expect.anything());
  });

  it('says so before a new decision replaces the one a page already has', async () => {
    const decided = {
      id: '00000000-0000-4000-8000-00000000000c', page_number: 1, assignment: 'single',
      member_id: memberId, candidate_name: 'Testmedewerker', note: null, created_at: '2026-09-08T08:10:00Z',
    };
    rpc.mockResolvedValue(ok(projection([], true, { pages: [decided] })));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Paginatoewijzing/ }));
    const form = await screen.findByRole('form', { name: 'Paginatoewijzing vastleggen' });
    expect(within(form).getByText(/Pagina 1 heeft al een toewijzing/)).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^Pagina/), { target: { value: '2' } });
    expect(within(form).queryByText(/heeft al een toewijzing/)).not.toBeInTheDocument();
  });

  it('offers no one-click take-over for a page that carries several employees', async () => {
    const shared = {
      id: '00000000-0000-4000-8000-00000000000d', page_number: 1, assignment: 'multiple',
      member_id: null, candidate_name: null, note: 'Twee briefjes op één scan', created_at: '2026-09-08T08:10:00Z',
    };
    rpc.mockResolvedValue(ok(projection([], true, { pages: [shared] })));
    show();
    expect(await screen.findByText(/Pagina 1 — Meerdere medewerkers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hele pagina overnemen' })).not.toBeInTheDocument();
  });

  it('turns one page on one name into a proposal per day, and still no hours', async () => {
    const single = {
      id: '00000000-0000-4000-8000-00000000000c', page_number: 2, assignment: 'single',
      member_id: memberId, candidate_name: 'Testmedewerker', note: null, created_at: '2026-09-08T08:10:00Z',
    };
    rpc.mockResolvedValue(ok(projection([], true, { pages: [single] })));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Hele pagina overnemen' }));
    const form = await screen.findByRole('form', { name: 'Pagina 2 overnemen' });
    fireEvent.change(within(form).getByLabelText('Uren'), { target: { value: '8:15' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Voorstellen bewaren' }));
    // The page number is stored on the proposal itself, so repeating it as a
    // free-text location would show up twice on the applied revision's origin.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_create_page_proposals', {
      p_source_id: sourceId, p_page_number: 2,
      p_entries: [{ day_id: dayId, minutes: 495 }],
    }));
    expect(rpc).not.toHaveBeenCalledWith('hours_save_day_source', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('hours_apply_source_proposal', expect.anything());
  });

  it('hides every intake action from a reader without manage rights', async () => {
    rpc.mockResolvedValue(ok(projection([proposal()], false)));
    show();
    expect(await screen.findByText('week36.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('Urenbriefje uploaden')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voorstel maken' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toepassen als dagversie' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Paginatoewijzing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bron bekijken/ })).toBeInTheDocument();
  });
});
