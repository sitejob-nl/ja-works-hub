import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HoursOutboxPanel } from '@/components/hours-workflow/HoursOutboxPanel';
import {
  HoursMailProfilePanel, EVERY_MEMBER, type HoursMailProfilePanelProps,
} from '@/components/hours-workflow/HoursMailProfilePanel';
import { HoursMailTemplatePanel } from '@/components/hours-workflow/HoursMailTemplatePanel';
import type { HoursMailProfile, HoursOutboxMessage } from '@/lib/hours-outbox';

/**
 * What the office sees and may do. The screen never sends: it approves exactly
 * the words and the hours in front of the reader, and it refuses to pretend a
 * blocked or incomplete message is ready.
 */

const message = (overrides: Partial<HoursOutboxMessage> = {}): HoursOutboxMessage => ({
  id: '11111111-1111-4111-8111-111111111111',
  week_id: '22222222-2222-4222-8222-222222222222',
  company_id: '33333333-3333-4333-8333-333333333333',
  company_name: 'Klant A', week_start: '2026-09-07',
  rule_id: 'klant-uitvraag', mail_type: 'hours_request', party: 'customer',
  scheduled_at: '2026-09-14T07:00:00Z', effective_at: '2026-09-14T07:00:00Z',
  status: 'concept', block_reason: 'goedkeuring_vereist', approval_required: true,
  subject: 'Uren week 37 [UR-7K3M-2XQ9]', body_html: '<p>Beste Planner</p>',
  recipients: ['planner@klant-a.invalid'],
  content_hash: 'hash-1', source_revision: 'rev-1',
  approved_at: null, approved_by: null,
  attempt_count: 0, next_attempt_at: null, last_error: null,
  sent_at: null, outbound_message_id: null,
  ...overrides,
});

const profile = (overrides: Partial<HoursMailProfile> = {}): HoursMailProfile => ({
  company_id: '33333333-3333-4333-8333-333333333333',
  version: 1, late_approval_mode: 'require_review', late_approval_window_minutes: 60,
  rules: [], templates: [{ template_id: 'uitvraag', language: 'nl', subject: 'Uren', body: 'Hoi' }],
  last_issues: [], last_planned_at: null,
  can_manage: true, ...overrides,
});

const noop = async () => {};
const noopWithdraw = async (_input: { id: string; note: string | null; allowReplan: boolean }) => {};

afterEach(cleanup);

describe('the outbox on screen', () => {
  it('says nothing goes out while no profile has been set', () => {
    render(<HoursOutboxPanel messages={[]} canManage onApprove={noop} onWithdraw={noopWithdraw} />);
    expect(screen.getByText(/Zonder ingesteld mailprofiel gaat er niets uit/)).toBeInTheDocument();
  });

  it('names how many messages are waiting for a person', () => {
    render(<HoursOutboxPanel messages={[message(), message({ id: 'b' })]} canManage
      onApprove={noop} onWithdraw={noopWithdraw} />);
    expect(screen.getByText(/2 berichten wachten op goedkeuring/)).toBeInTheDocument();
  });

  it('approves exactly the words and the hours that are on screen', async () => {
    const onApprove = vi.fn(async () => {});
    render(<HoursOutboxPanel messages={[message()]} canManage onApprove={onApprove} onWithdraw={noopWithdraw} />);
    fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren en versturen' }));
    expect(onApprove).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      contentHash: 'hash-1', sourceRevision: 'rev-1',
    });
  });

  it('offers no approval on a message that has no addressee yet', () => {
    render(<HoursOutboxPanel messages={[message({ recipients: [], block_reason: 'onbekende_ontvanger' })]}
      canManage onApprove={noop} onWithdraw={noopWithdraw} />);
    expect(screen.queryByRole('button', { name: 'Goedkeuren en versturen' })).toBeNull();
    expect(screen.getByText('De ingestelde ontvanger heeft geen adres')).toBeInTheDocument();
  });

  it('offers nothing at all to someone who may not manage', () => {
    render(<HoursOutboxPanel messages={[message()]} canManage={false} onApprove={noop} onWithdraw={noopWithdraw} />);
    expect(screen.queryByRole('button', { name: 'Goedkeuren en versturen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
  });

  it('never offers to change a message that has already been sent', () => {
    render(<HoursOutboxPanel canManage onApprove={noop} onWithdraw={noopWithdraw}
      messages={[message({
        status: 'verzonden', block_reason: null, approval_required: false,
        sent_at: '2026-09-14T07:01:00Z', outbound_message_id: '<sent@ja.invalid>',
      })]} />);
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Goedkeuren en versturen' })).toBeNull();
  });

  it('says a paused send was kept as a concept instead of thrown away', () => {
    render(<HoursOutboxPanel canManage onApprove={noop} onWithdraw={noopWithdraw}
      messages={[message({ status: 'goedgekeurd', approval_required: true,
        approved_at: '2026-09-14T06:00:00Z', approved_by: 'someone',
        block_reason: 'uitgaande_pauze' })]} />);
    expect(screen.getByText(/Uitgaande e-mail staat op pauze; opgeslagen als concept/)).toBeInTheDocument();
  });

  it('reports a conflict instead of retrying, and offers the current state', async () => {
    const onApprove = vi.fn(async () => { throw Object.assign(new Error('Gewijzigd'), { code: 'PT409' }); });
    const onReload = vi.fn();
    render(<HoursOutboxPanel messages={[message()]} canManage onApprove={onApprove}
      onWithdraw={noopWithdraw} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren en versturen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actuele stand laden' })).toBeInTheDocument());
    expect(onApprove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Actuele stand laden' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('lets a failed message be planned again, and says so truthfully', async () => {
    const seen: { id: string; note: string | null; allowReplan: boolean }[] = [];
    render(<HoursOutboxPanel canManage onApprove={noop}
      onWithdraw={async input => { seen.push(input); }}
      messages={[message({ status: 'mislukt', block_reason: 'definitief_geweigerd',
        last_error: 'invalid recipient', approval_required: false })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw laten plannen' }));
    await waitFor(() => expect(seen).toHaveLength(1));
    // Without this flag the message is withdrawn for good, and the promise the
    // screen makes right next to the button would be a lie.
    expect(seen[0].allowReplan).toBe(true);
  });

  it('never offers to withdraw a concept that is simply not due yet', () => {
    render(<HoursOutboxPanel canManage onApprove={noop} onWithdraw={noopWithdraw}
      messages={[message({ status: 'concept', block_reason: 'planned',
        approval_required: false })]} />);
    // One click would otherwise kill that week's hours request for good.
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Opnieuw laten plannen' })).toBeNull();
  });

  it('warns that withdrawing is final', () => {
    render(<HoursOutboxPanel canManage onApprove={noop} onWithdraw={noopWithdraw}
      messages={[message({ status: 'gereed', block_reason: null, approval_required: false })]} />);
    expect(screen.getByText(/ook niet bij een volgende planning/)).toBeInTheDocument();
  });

  it('shows why a failed message stopped rather than hiding it', () => {
    render(<HoursOutboxPanel canManage onApprove={noop} onWithdraw={noopWithdraw}
      messages={[message({ status: 'mislukt', block_reason: 'te_vaak_geprobeerd',
        last_error: 'graph_503', attempt_count: 5 })]} />);
    expect(screen.getByText('Te vaak geprobeerd; een mens moet hiernaar kijken')).toBeInTheDocument();
    expect(screen.getByText('graph_503')).toBeInTheDocument();
  });
});

describe('a message that needs a person always offers a way out', () => {
  it('does not say the same thing twice about an uncertain send', () => {
    // De reden en de foutmelding staan onder elkaar. Zeggen ze allebei
    // hetzelfde, dan leest dat als een stotter en voegt de tweede niets toe.
    render(<HoursOutboxPanel canManage messages={[message({
      status: 'mislukt', block_reason: 'verzending_onzeker', approval_required: false,
      last_error: 'De verzendpoging is nooit afgerond. Controleer de postbus.',
    })]} onApprove={vi.fn()} onWithdraw={vi.fn()} />);
    const kaart = screen.getByRole('listitem').textContent ?? '';
    const keer = kaart.split('nooit afgerond').length - 1;
    expect(keer).toBe(1);
  });


  it('lets a withdrawn message be put back on the list', async () => {
    const onWithdraw = vi.fn().mockResolvedValue(undefined);
    render(<HoursOutboxPanel canManage messages={[message({
      status: 'vervallen', block_reason: 'ingetrokken', approval_required: false,
    })]} onApprove={vi.fn()} onWithdraw={onWithdraw} />);
    fireEvent.click(screen.getByRole('button', { name: /opnieuw laten plannen/i }));
    await waitFor(() => expect(onWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({ allowReplan: true })));
  });

  it('does not offer that for a message the planner dropped by itself', () => {
    render(<HoursOutboxPanel canManage messages={[message({
      status: 'vervallen', block_reason: 'niet_meer_gepland', approval_required: false,
    })]} onApprove={vi.fn()} onWithdraw={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /opnieuw laten plannen/i })).toBeNull();
  });

  it('lets a blocked concept be stopped instead of showing nothing at all', async () => {
    const onWithdraw = vi.fn().mockResolvedValue(undefined);
    render(<HoursOutboxPanel canManage messages={[message({
      status: 'concept', block_reason: 'deadline_passed', approval_required: false, subject: '',
    })]} onApprove={vi.fn()} onWithdraw={onWithdraw} />);
    fireEvent.click(screen.getByRole('button', { name: /intrekken/i }));
    await waitFor(() => expect(onWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({ allowReplan: false })));
  });

  it('still offers nothing for a concept that is simply not due yet', () => {
    render(<HoursOutboxPanel canManage messages={[message({
      status: 'concept', block_reason: 'planned', approval_required: false,
    })]} onApprove={vi.fn()} onWithdraw={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /intrekken/i })).toBeNull();
  });
});

describe('the mail profile on screen', () => {
  it('says plainly that an empty profile sends nothing', () => {
    render(<HoursMailProfilePanel profile={profile()} recipients={[]} onSave={noop} />);
    expect(screen.getByText(/Er gaat nog niets uit voor deze opdrachtgever/)).toBeInTheDocument();
  });

  it('adds a message type that starts switched off', async () => {
    render(<HoursMailProfilePanel profile={profile()} recipients={[]} onSave={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Berichtsoort toevoegen' }));
    expect(screen.getByText('Staat uit — verstuurt niets')).toBeInTheDocument();
  });

  it('sends the rules it shows, with the recipient a person ticked', async () => {
    const saved: Parameters<HoursMailProfilePanelProps['onSave']>[0][] = [];
    const onSave = vi.fn(async (input: Parameters<HoursMailProfilePanelProps['onSave']>[0]) => { saved.push(input); });
    render(<HoursMailProfilePanel onSave={onSave} recipients={[
      { id: 'contact-a', party: 'customer', label: 'Planner A' },
      { id: 'contact-b', party: 'customer', label: 'Backoffice B' },
    ]} profile={profile({ rules: [{
      id: 'klant-uitvraag', enabled: true, mailType: 'hours_request', party: 'customer',
      recipientIds: ['contact-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
      templateId: 'uitvraag', language: 'nl',
    }] })} />);
    fireEvent.click(screen.getByLabelText('Backoffice B'));
    fireEvent.click(screen.getByRole('button', { name: 'Mailprofiel opslaan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(saved[0].rules[0].recipientIds).toEqual(['contact-a', 'contact-b']);
  });

  it('does not offer a language the planner will refuse for that party', () => {
    // Polish is refused for a client mail, so offering it here would let
    // somebody save a rule that reports success and then never sends anything.
    render(<HoursMailProfilePanel recipients={[{ id: 'contact-a', party: 'customer', label: 'Planner A' }]}
      onSave={noop} profile={profile({ rules: [{
        id: 'klant-uitvraag', enabled: true, mailType: 'hours_request', party: 'customer',
        recipientIds: ['contact-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
        templateId: 'uitvraag', language: 'nl',
      }] })} />);
    const language = screen.getByLabelText('Taal') as HTMLSelectElement;
    expect([...language.options].map(option => option.value)).toEqual(['nl', 'en']);
  });

  it('does offer it for a message to employees, which is what it is for', () => {
    render(<HoursMailProfilePanel recipients={[{ id: 'candidate-a', party: 'employee', label: 'Jan Kowalski' }]}
      onSave={noop} profile={profile({ rules: [{
        id: 'akkoord', enabled: true, mailType: 'approval_request', party: 'employee',
        recipientIds: ['candidate-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 2, time: '09:00' },
        templateId: 'uitvraag', language: 'pl',
      }] })} />);
    const language = screen.getByLabelText('Taal') as HTMLSelectElement;
    expect([...language.options].map(option => option.value)).toEqual(['nl', 'en', 'pl']);
  });

  it('says which week a report is about, so two weeks do not read as one', () => {
    render(<HoursMailProfilePanel recipients={[]} onSave={noop} profile={profile({ last_issues: [
      { scope: 'klant-uitvraag', code: 'invalid_language', message: 'Klantmails ondersteunen Nederlands en Engels.', weekStart: '2026-09-07' },
      { scope: 'week', code: 'invalid_deadline_order', message: 'De akkoorddeadline ligt voor de aanleverdeadline.', weekStart: '2026-09-14' },
    ] })} />);
    // Niet op een samengeplakte tekstknoop pinnen: de UI-vertaling zoekt exacte
    // tekstknopen op, dus vaste tekst en een datum horen los te staan.
    const shown = screen.getByRole('alert').textContent ?? '';
    expect(shown).toContain('week van 2026-09-07');
    expect(shown).toContain('week van 2026-09-14');
  });

  const polishToEmployee = () => <HoursMailProfilePanel onSave={noop} recipients={[
    { id: 'candidate-a', party: 'employee', label: 'Jan Kowalski' },
    { id: 'contact-a', party: 'customer', label: 'Planner A' },
  ]} profile={profile({ rules: [{
    id: 'navraag', enabled: true, mailType: 'correction_query', party: 'employee',
    recipientIds: ['candidate-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 2, time: '09:00' },
    templateId: 'uitvraag', language: 'pl',
  }] })} />;

  it('drops a language the new party cannot use instead of leaving it dangling', () => {
    render(polishToEmployee());
    fireEvent.change(screen.getByLabelText('Partij'), { target: { value: 'customer' } });
    expect((screen.getByLabelText('Taal') as HTMLSelectElement).value).toBe('nl');
  });

  it('does that too when the message type is what moves the party', () => {
    // Een berichtsoort die alleen naar de opdrachtgever kan, verzet de partij
    // zelf. Dezelfde regel hoort dan te gelden, anders hangt de taal alsnog.
    render(polishToEmployee());
    fireEvent.change(screen.getByLabelText('Berichtsoort'), { target: { value: 'hours_request' } });
    expect((screen.getByLabelText('Taal') as HTMLSelectElement).value).toBe('nl');
  });

  it('shows a stored language the party cannot use, rather than a blank box', () => {
    // Zo'n regel kan alleen van voor deze grens komen. Verbergen zou een leeg
    // keuzevak opleveren en de lezer geen idee geven wat hij moet herstellen.
    render(<HoursMailProfilePanel recipients={[{ id: 'contact-a', party: 'customer', label: 'Planner A' }]}
      onSave={noop} profile={profile({ rules: [{
        id: 'klant-uitvraag', enabled: true, mailType: 'hours_request', party: 'customer',
        recipientIds: ['contact-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
        templateId: 'uitvraag', language: 'pl',
      }] })} />);
    const language = screen.getByLabelText('Taal') as HTMLSelectElement;
    expect(language.value).toBe('pl');
    expect([...language.options].map(option => option.value)).toContain('pl');
  });

  it('refuses to read a stored rule without a single recipient', () => {
    // Neither the schema nor the database can hold one, so showing it as
    // editable would only offer a save the server is bound to refuse.
    render(<HoursMailProfilePanel recipients={[]} onSave={noop} profile={profile({ rules: [{
      id: 'leeg', enabled: true, mailType: 'hours_request', party: 'customer',
      recipientIds: [], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
      templateId: 'uitvraag', language: 'nl',
    }] })} />);
    expect(screen.getByText(/niet leesbaar door dit scherm/)).toBeInTheDocument();
  });

  it('offers every employee of the week only for an employee message', async () => {
    const saved: Parameters<HoursMailProfilePanelProps['onSave']>[0][] = [];
    const onSave = vi.fn(async (input: Parameters<HoursMailProfilePanelProps['onSave']>[0]) => { saved.push(input); });
    render(<HoursMailProfilePanel onSave={onSave}
      recipients={[{ id: 'candidate-a', party: 'employee', label: 'Jan Kowalski' }]}
      profile={profile({ rules: [{
        id: 'akkoord', enabled: true, mailType: 'approval_request', party: 'employee',
        recipientIds: ['candidate-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 2, time: '09:00' },
        templateId: 'uitvraag', language: 'nl',
      }] })} />);
    const everyone = screen.getByLabelText('Alle medewerkers van de week') as HTMLInputElement;
    expect(everyone.checked).toBe(false);
    fireEvent.click(everyone);
    fireEvent.click(screen.getByRole('button', { name: 'Mailprofiel opslaan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // The wildcard replaces the fixed list rather than sitting next to it; the
    // server refuses any mix, so the screen may not offer one.
    expect(saved[0].rules[0].recipientIds).toEqual([EVERY_MEMBER]);
  });

  it('does not offer that wildcard on a client message', () => {
    render(<HoursMailProfilePanel onSave={noop}
      recipients={[{ id: 'contact-a', party: 'customer', label: 'Planner A' }]}
      profile={profile({ rules: [{
        id: 'klant-uitvraag', enabled: true, mailType: 'hours_request', party: 'customer',
        recipientIds: ['contact-a'], at: { kind: 'week_time', weekOffset: 1, weekday: 1, time: '09:00' },
        templateId: 'uitvraag', language: 'nl',
      }] })} />);
    expect(screen.queryByLabelText('Alle medewerkers van de week')).toBeNull();
  });

  it('keeps an unreadable stored rule visible instead of dropping it silently', () => {
    render(<HoursMailProfilePanel recipients={[]} onSave={noop}
      profile={profile({ rules: [{ id: 'kapot' }] })} />);
    expect(screen.getByText(/niet leesbaar door dit scherm/)).toBeInTheDocument();
  });

  it('reports a save refusal in the words the server chose', async () => {
    const onSave = vi.fn(async () => { throw new Error('Kies een taal'); });
    render(<HoursMailProfilePanel profile={profile()} recipients={[]} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mailprofiel opslaan' }));
    await waitFor(() => expect(screen.getByText('Kies een taal')).toBeInTheDocument());
  });

  it('shows what the last planning could not read instead of failing silently', () => {
    render(<HoursMailProfilePanel recipients={[]} onSave={noop} profile={profile({
      last_issues: [{ scope: 'klant-uitvraag', code: 'missing_template', message: 'Kies een template en taal voor deze mail.' }],
      last_planned_at: '2026-09-18T07:00:00Z',
    })} />);
    expect(screen.getByText(/verstuurt die regel niets/)).toBeInTheDocument();
    expect(screen.getByText(/Kies een template en taal/)).toBeInTheDocument();
  });

  it('exports the wildcard the server expands per week', () => {
    expect(EVERY_MEMBER).toBe('*');
  });
});

describe('the words of a message', () => {
  const template = { template_id: 'uitvraag', language: 'nl' as const, subject: 'Uren {{week}}', body: 'Hoi' };

  it('says plainly that without a text nothing goes out', () => {
    render(<HoursMailTemplatePanel templates={[]} canManage onSave={noop} />);
    expect(screen.getByText(/Zonder tekst blijft elk bericht een concept/)).toBeInTheDocument();
  });

  it('refuses to save a text without a subject or a body', async () => {
    const onSave = vi.fn(async () => {});
    render(<HoursMailTemplatePanel templates={[]} canManage onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'uitvraag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tekst opslaan' }));
    await waitFor(() => expect(screen.getByText(/zonder onderwerp wordt niet verstuurd/)).toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('loads an existing text and keeps its name and language fixed', () => {
    render(<HoursMailTemplatePanel templates={[template]} canManage onSave={noop} />);
    fireEvent.change(screen.getByLabelText('Bestaande tekst'), { target: { value: 'uitvraag:nl' } });
    expect((screen.getByLabelText('Naam') as HTMLInputElement).value).toBe('uitvraag');
    expect((screen.getByLabelText('Naam') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Onderwerp') as HTMLInputElement).value).toBe('Uren {{week}}');
  });

  it('shows no editor at all to someone who may not manage', () => {
    render(<HoursMailTemplatePanel templates={[template]} canManage={false} onSave={noop} />);
    expect(screen.queryByRole('button', { name: 'Tekst opslaan' })).toBeNull();
  });
});
