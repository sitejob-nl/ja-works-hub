import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoursMailIntakePanel } from '@/components/hours-workflow/HoursMailIntakePanel';
import type { HoursMailAttention, HoursMailFollowed } from '@/lib/hours-mail';

const folder = (overrides: Partial<HoursMailFollowed> = {}): HoursMailFollowed => ({
  id: 'f1', mail_account_id: 'acc-1', folder_id: 'AAMk', folder_label: 'Uren',
  enabled: true, mailbox_email: 'uren@jawerkt.invalid', mailbox_name: 'Algemeen',
  has_cursor: true, cursor_updated_at: '2026-09-16T06:00:00Z', resync_count: 0,
  last_run_at: '2026-09-16T06:00:00Z', last_error: null, pending: 0, filed: 3, ...overrides,
});

const attention = (overrides: Partial<HoursMailAttention> = {}): HoursMailAttention => ({
  id: 'm1', subject: 'RE: uren week 37', from_address: 'vreemde@elders.invalid',
  from_name: 'Onbekend', received_at: '2026-09-15T09:00:00Z', first_seen_at: '2026-09-15T09:05:00Z',
  reason_code: 'onbekende_afzender', reason_note: null, attempt_count: 1,
  folder_label: 'Uren', has_attachments: false, ...overrides,
});

const noop = { onDismiss: vi.fn(), onRun: vi.fn(), running: false };

afterEach(cleanup);

describe('de controlebak van de mailinname', () => {
  it('zegt in gewone woorden waarom een bericht is blijven liggen', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[attention()]} {...noop} />);
    expect(screen.getByText(/De afzender hoort bij geen enkele contactpersoon/)).toBeInTheDocument();
    expect(screen.getByText(/vreemde@elders.invalid/)).toBeInTheDocument();
  });

  it('zegt dat er niets is verwerkt, niet dat er iets is misgegaan', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[attention()]} {...noop} />);
    expect(screen.getByText(/Er staat hier geen bron en geen voorstel tegenover/i)).toBeInTheDocument();
  });

  it('meldt een lege bak als goed nieuws, niet als leegte', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[]} {...noop} />);
    expect(screen.getByText(/Alles wat binnenkwam is geplaatst/i)).toBeInTheDocument();
  });

  it('toont per map hoe ver de inname staat', () => {
    render(<HoursMailIntakePanel canManage
      folders={[folder({ pending: 2, filed: 11 })]} attention={[]} {...noop} />);
    expect(screen.getByText(/11 verwerkt/)).toBeInTheDocument();
    expect(screen.getByText(/2 in de wachtrij/)).toBeInTheDocument();
  });

  it('noemt de mailbox erbij, want die is van een mens', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[]} {...noop} />);
    expect(screen.getByText(/uren@jawerkt.invalid/)).toBeInTheDocument();
  });

  it('zegt dat de postbus alleen wordt gelezen', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[]} {...noop} />);
    expect(screen.getByText(/alleen gelezen/i)).toBeInTheDocument();
  });

  it('meldt een storing van de laatste doorloop bij naam', () => {
    render(<HoursMailIntakePanel canManage
      folders={[folder({ last_error: 'graph_503' })]} attention={[]} {...noop} />);
    expect(screen.getByText(/graph_503/)).toBeInTheDocument();
  });

  it('zegt wanneer een map nog nooit is opgehaald', () => {
    render(<HoursMailIntakePanel canManage
      folders={[folder({ has_cursor: false, last_run_at: null })]} attention={[]} {...noop} />);
    expect(screen.getByText(/nog niet opgehaald/i)).toBeInTheDocument();
  });

  it('biedt zonder beheerrecht geen enkele handeling aan', () => {
    render(<HoursMailIntakePanel canManage={false} folders={[folder()]} attention={[attention()]} {...noop} />);
    expect(screen.queryByRole('button', { name: /afhandelen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nu ophalen/i })).not.toBeInTheDocument();
  });

  it('meldt wanneer er nog geen map wordt gevolgd', () => {
    render(<HoursMailIntakePanel canManage folders={[]} attention={[]} {...noop} />);
    expect(screen.getByText(/Er wordt nog geen map gevolgd/i)).toBeInTheDocument();
  });
});


describe('bevindingen uit de derde codereviewronde', () => {
  const mailbox = { id: 'acc-1', label: 'Algemeen', email: 'uren@jawerkt.invalid' };
  const mailFolder = { id: 'AAMkFolder', display_name: 'Uren' };
  const picker = {
    mailboxes: [mailbox], mailboxFolders: [mailFolder],
    selectedMailbox: 'acc-1', onSelectMailbox: vi.fn(),
    onFollow: vi.fn(), folderBusy: false,
    weeks: [{ id: 'week-1', label: 'Acme — week 37' }], onAssign: vi.fn(),
  };

  it('biedt een manier om een map te gaan volgen, anders is de inname onbereikbaar', () => {
    render(<HoursMailIntakePanel canManage folders={[]} attention={[]} {...noop} {...picker} />);
    expect(screen.getByRole('combobox', { name: /postbus/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /map/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /map volgen/i })).toBeInTheDocument();
  });

  it('volgt de gekozen map met het label dat de postbus zelf gebruikt', () => {
    const onFollow = vi.fn();
    render(<HoursMailIntakePanel canManage folders={[]} attention={[]} {...noop}
      {...picker} onFollow={onFollow} />);
    fireEvent.change(screen.getByRole('combobox', { name: /map/i }), { target: { value: 'AAMkFolder' } });
    fireEvent.click(screen.getByRole('button', { name: /map volgen/i }));
    expect(onFollow).toHaveBeenCalledWith('acc-1', 'AAMkFolder', 'Uren');
  });

  it('laat een bericht uit de controlebak alsnog aan een week hangen', () => {
    const onAssign = vi.fn();
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[attention()]}
      {...noop} {...picker} onAssign={onAssign} />);
    fireEvent.click(screen.getByRole('button', { name: /aan een week hangen/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /klantweek/i }), { target: { value: 'week-1' } });
    fireEvent.click(screen.getByRole('button', { name: /toewijzen/i }));
    expect(onAssign).toHaveBeenCalledWith('m1', 'week-1', null);
  });

  it('zegt bij het toewijzen dat een mens dan de koppeling is', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[attention()]}
      {...noop} {...picker} />);
    fireEvent.click(screen.getByRole('button', { name: /aan een week hangen/i }));
    expect(screen.getByText(/u bent dan zelf de koppeling/i)).toBeInTheDocument();
  });

  it('biedt zonder beheerrecht geen map-keuze aan', () => {
    render(<HoursMailIntakePanel canManage={false} folders={[]} attention={[]} {...noop} {...picker} />);
    expect(screen.queryByRole('button', { name: /map volgen/i })).not.toBeInTheDocument();
  });
});


describe('wat een gevolgde map van de mailbox vastlegt', () => {
  const picker = {
    mailboxes: [{ id: 'acc-1', label: 'Algemeen', email: 'uren@jawerkt.invalid' }],
    mailboxFolders: [{ id: 'AAMkFolder', display_name: 'Uren' }],
    selectedMailbox: 'acc-1', onSelectMailbox: vi.fn(),
    onFollow: vi.fn(), folderBusy: false, weeks: [], onAssign: vi.fn(),
  };

  it('waarschuwt dat elk bericht in die map wordt vastgelegd, niet alleen urenmail', () => {
    render(<HoursMailIntakePanel canManage folders={[]} attention={[]} {...noop} {...picker} />);
    expect(screen.getByText(/elk bericht in die map/i)).toBeInTheDocument();
    expect(screen.getByText(/aparte map/i)).toBeInTheDocument();
  });
});


describe('bevindingen uit de vijfde codereviewronde', () => {
  const picker = {
    mailboxes: [{ id: 'acc-1', label: 'Algemeen', email: 'uren@jawerkt.invalid' }],
    mailboxFolders: [{ id: 'AAMkFolder', display_name: 'Uren' }],
    selectedMailbox: 'acc-1', onSelectMailbox: vi.fn(),
    onFollow: vi.fn(), folderBusy: false,
    weeks: [{ id: 'week-1', label: 'Acme — week 37' }], onAssign: vi.fn(),
  };

  it('zegt dat een uitgezette map zijn wachtrij niet verwerkt', () => {
    render(<HoursMailIntakePanel canManage
      folders={[folder({ enabled: false, pending: 3 })]} attention={[]} {...noop} {...picker} />);
    expect(screen.getByText(/staat uit, dus deze wachtrij wordt niet verwerkt/i)).toBeInTheDocument();
  });

  it('zwijgt daarover als een uitgezette map niets meer te doen heeft', () => {
    render(<HoursMailIntakePanel canManage
      folders={[folder({ enabled: false, pending: 0 })]} attention={[]} {...noop} {...picker} />);
    expect(screen.queryByText(/wachtrij wordt niet verwerkt/i)).not.toBeInTheDocument();
  });

  it('draagt een getypte toelichting niet over van afhandelen naar toewijzen', () => {
    render(<HoursMailIntakePanel canManage folders={[folder()]} attention={[attention()]}
      {...noop} {...picker} />);
    fireEvent.click(screen.getByRole('button', { name: /afhandelen/i }));
    fireEvent.change(screen.getByLabelText(/toelichting/i), { target: { value: 'nieuwsbrief' } });
    fireEvent.click(screen.getByRole('button', { name: /annuleren/i }));
    fireEvent.click(screen.getByRole('button', { name: /aan een week hangen/i }));
    expect((screen.getByLabelText(/toelichting/i) as HTMLInputElement).value).toBe('');
  });
});
