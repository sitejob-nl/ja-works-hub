import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursWeekSources } from '@/components/hours-workflow/HoursWeekSources';
import type { HoursWeekView } from '@/components/hours-workflow/types';
import { buildWorkbookFile, error, formatted, text } from './support/xlsx-workbook';

const { rpc, upload, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(), upload: vi.fn(), createSignedUrl: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc, storage: { from: () => ({ upload, createSignedUrl }) } },
}));

const orgId = '00000000-0000-4000-8000-000000000001';
const weekId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000004';
const jan = '00000000-0000-4000-8000-00000000000a';
const ewa = '00000000-0000-4000-8000-00000000000b';
const days = {
  janMonday: '00000000-0000-4000-8000-0000000000c1',
  janTuesday: '00000000-0000-4000-8000-0000000000c2',
  ewaMonday: '00000000-0000-4000-8000-0000000000c3',
  ewaTuesday: '00000000-0000-4000-8000-0000000000c4',
};
const storagePath = `${orgId}/${weekId}/${'c'.repeat(64)}.xlsx`;
const clients: QueryClient[] = [];
const ok = <T,>(data: T) => ({ data, error: null });

const week: HoursWeekView = {
  id: weekId, companyName: 'Voorbeeldopdrachtgever', weekStart: '2026-09-07', enabled: true,
  employees: [
    { id: jan, candidateId: 'candidate-a', name: 'Jan Kowalski', days: [
      { id: days.janMonday, workDate: '2026-09-07', revision: null, confirmation: null },
      { id: days.janTuesday, workDate: '2026-09-08', revision: null, confirmation: null },
    ] },
    { id: ewa, candidateId: 'candidate-b', name: 'Ewa Nowak', days: [
      { id: days.ewaMonday, workDate: '2026-09-07', revision: null, confirmation: null },
      { id: days.ewaTuesday, workDate: '2026-09-08', revision: null, confirmation: null },
    ] },
  ],
};

const projection = (proposals: unknown[] = []) => ({
  week_id: weekId, can_manage: true,
  open_proposals: proposals.length, undecided_assignments: 0,
  sources: [{
    id: sourceId, file_name: 'uren-week37.xlsx',
    content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byte_size: 4096, content_hash: 'c'.repeat(64), storage_path: storagePath,
    created_at: '2026-09-08T08:00:00Z', page_count: 1, pages: [], proposals,
  }],
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>
    <HoursWeekSources organizationId={orgId} week={week} />
  </QueryClientProvider>);
}

/** The stored original is fetched back over a short-lived signed link. */
function serveWorkbook(bytes: ArrayBuffer | null) {
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null });
  vi.stubGlobal('fetch', vi.fn(async () => bytes === null
    ? { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }
    : { ok: true, arrayBuffer: async () => bytes }));
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  rpc.mockReset(); upload.mockReset(); createSignedUrl.mockReset();
  rpc.mockImplementation(async () => ok(projection()));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.unstubAllGlobals();
});

describe('reading a delivered spreadsheet from the week screen', () => {
  it('shows what the file says and records the chosen rows as proposals in one handling', async () => {
    serveWorkbook(buildWorkbookFile([{ name: 'Week 37', rows: [
      [text('Medewerker'), text('07-09-2026'), text('08-09-2026'), text('Totaal')],
      [text('Jan Kowalski'), text('8,5'), text('7:30'), text('16:00')],
      [text('Ewa Nowak'), text(''), text('6,25'), text('6:15')],
    ] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    const panel = await screen.findByRole('group', { name: 'Uitlezing van deze bron' }, { timeout: 5000 });
    expect(within(panel).getByText('8:30 uur')).toBeInTheDocument();
    expect(within(panel).getByText('7:30 uur')).toBeInTheDocument();
    expect(within(panel).getByText('6:15 uur')).toBeInTheDocument();
    expect(within(panel).getAllByText(/blad Week 37 · rij 2/)).toHaveLength(2);
    expect(within(panel).getByText(/blad Week 37 · rij 3/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '3 voorstellen bewaren' }));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('hours_create_source_proposals', {
      p_source_id: sourceId,
      p_entries: [
        expect.objectContaining({ day_id: days.janMonday, minutes: 510, page_number: 1 }),
        expect.objectContaining({ day_id: days.janTuesday, minutes: 450 }),
        expect.objectContaining({ day_id: days.ewaTuesday, minutes: 375 }),
      ],
    }));
  });

  it('names the rows it deliberately left alone instead of dropping them', async () => {
    serveWorkbook(buildWorkbookFile([{ name: 'Week 37', rows: [
      [text('Naam'), text('Datum'), text('Uren')],
      [text('Jan Kowalski'), text('07-09-2026'), text('8:00')],
      [text('Piet de Vries'), text('07-09-2026'), text('8:00')],
    ] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    const panel = await screen.findByRole('group', { name: 'Uitlezing van deze bron' }, { timeout: 5000 });
    expect(within(panel).getByText(/Hier is met opzet niets van gemaakt \(1\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/Piet de Vries/)).toBeInTheDocument();
  });

  it('shows the difference when a delivered total does not match the days beneath it', async () => {
    serveWorkbook(buildWorkbookFile([{ name: 'Week 37', rows: [
      [text('Medewerker'), text('07-09-2026'), text('08-09-2026'), text('Totaal')],
      [text('Jan Kowalski'), text('4:00'), text('5:00'), text('8:00')],
    ] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    const panel = await screen.findByRole('group', { name: 'Uitlezing van deze bron' }, { timeout: 5000 });
    expect(within(panel).getByText(/aangeleverd 8:00 uur/)).toBeInTheDocument();
    expect(within(panel).getByText(/gelezen 9:00 uur/)).toBeInTheDocument();
    // The days keep what the file said; nothing is corrected away.
    expect(within(panel).getByText('4:00 uur')).toBeInTheDocument();
    expect(within(panel).getByText('5:00 uur')).toBeInTheDocument();
  });

  it('reads a clock-formatted duration but refuses an ambiguous elapsed-time cell', async () => {
    // Both cells hold half a day. The clock format arrives as a time and is read
    // as 12:00; the elapsed format arrives as a bare 0,5 that could equally be
    // half an hour, so the reader says so instead of choosing.
    serveWorkbook(buildWorkbookFile([{ name: 'Week 37', rows: [
      [text('Naam'), text('Datum'), text('Uren')],
      [text('Jan Kowalski'), text('07-09-2026'), formatted('0.5', 'h:mm')],
      [text('Ewa Nowak'), text('08-09-2026'), formatted('0.5', '[h]:mm')],
    ] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    const panel = await screen.findByRole('group', { name: 'Uitlezing van deze bron' }, { timeout: 5000 });
    expect(within(panel).getByText('12:00 uur')).toBeInTheDocument();
    expect(within(panel).getByText(/kan zowel 0:30 als 12:00 betekenen/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '1 voorstel bewaren' })).toBeInTheDocument();
  });

  it('blocks an unreadable file with an explanation and records nothing', async () => {
    serveWorkbook(new TextEncoder().encode('geen werkmap').buffer as ArrayBuffer);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    expect(await screen.findByText('Deze bron is niet uitgelezen.', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Uitlezing van deze bron' })).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith('hours_create_source_proposals', expect.anything());
  });

  it('blocks a workbook whose layout it does not recognise', async () => {
    serveWorkbook(buildWorkbookFile([{ name: 'Blad1', rows: [
      [text('Overzicht')], [text('Jan Kowalski'), text('maandag'), text('lang gewerkt')],
    ] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    expect(await screen.findByText(/Geen enkel werkblad heeft een herkenbare indeling/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith('hours_create_source_proposals', expect.anything());
  });
});

describe('a worksheet the reader could not lay out', () => {
  it('names it in the panel instead of leaving it out without a word', async () => {
    serveWorkbook(buildWorkbookFile([
      { name: 'Week 37', rows: [
        [text('Naam'), text('Datum'), text('Uren')],
        [text('Jan Kowalski'), text('07-09-2026'), text('8:00')],
      ] },
      { name: 'Losse aantekeningen', rows: [[text('Bellen met kantoor over maandag')]] },
    ]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    const panel = await screen.findByRole('group', { name: 'Uitlezing van deze bron' }, { timeout: 5000 });
    expect(within(panel).getByText(/Dit werkblad is niet gelezen/)).toBeInTheDocument();
    expect(within(panel).getByText('Losse aantekeningen')).toBeInTheDocument();
  });
});

describe('a file that only claims to be a workbook', () => {
  it('refuses a spreadsheet media type whose bytes are not a workbook', async () => {
    const csv = new TextEncoder().encode('naam;datum;uren\nJan;07-09-2026;8\n');
    const file = new File([csv], 'uren.xls', { type: 'application/vnd.ms-excel' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength),
    });
    show();
    await screen.findByRole('button', { name: 'Uitlezen' });
    fireEvent.change(screen.getByLabelText('Urenbriefje uploaden'), { target: { files: [file] } });

    expect(await screen.findByText(/geen Excel-werkmap/i, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('a spreadsheet that failed its own sum', () => {
  it('never reads an error cell as a claim that someone did not work', async () => {
    serveWorkbook(buildWorkbookFile([{ name: 'Week 37', rows: [
      [text('Naam'), text('Datum'), text('Uren')],
      [text('Jan Kowalski'), text('07-09-2026'), error('#DIV/0!')],
      [text('Ewa Nowak'), text('08-09-2026'), text('8:00')],
    ] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Uitlezen' }));

    const panel = await screen.findByRole('group', { name: 'Uitlezing van deze bron' }, { timeout: 5000 });
    expect(within(panel).getByRole('button', { name: '1 voorstel bewaren' })).toBeInTheDocument();
    expect(within(panel).getByText(/foutwaarde van het rekenblad/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Geen uren/)).not.toBeInTheDocument();
  });
});

describe('a legacy binary workbook', () => {
  it('is kept as a source but never offered for reading', async () => {
    rpc.mockImplementation(async () => ok({
      ...projection(),
      sources: [{ ...projection().sources[0], file_name: 'uren.xls', content_type: 'application/vnd.ms-excel' }],
    }));
    show();

    expect(await screen.findByText('uren.xls')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uitlezen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bron bekijken/ })).toBeInTheDocument();
  });
});

describe('a workbook the browser mislabelled', () => {
  it('stores an .xlsx as what it really is, so it stays readable', async () => {
    const bytes = buildWorkbookFile([{ name: 'Week 37', rows: [[text('Naam')]] }]);
    const file = new File([new Uint8Array(bytes)], 'uren.xlsx', { type: 'application/vnd.ms-excel' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes });
    upload.mockResolvedValue({ data: { path: 'stored' }, error: null });
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).fill(12).buffer } });
    show();
    await screen.findByRole('button', { name: 'Uitlezen' });
    fireEvent.change(screen.getByLabelText('Urenbriefje uploaden'), { target: { files: [file] } });

    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.xlsx$/), expect.anything(), { contentType: xlsx, upsert: false }));
    expect(rpc).toHaveBeenCalledWith('hours_add_week_source',
      expect.objectContaining({ p_content_type: xlsx, p_page_count: 1 }));
  });
});
