import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursWeekWorkspace } from '@/components/hours-workflow/HoursWeekWorkspace';
import { HoursPortalWeek } from '@/components/hours-workflow/HoursPortalWeek';
import type { HoursWeekView } from '@/components/hours-workflow/types';

beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function weekFixture(): HoursWeekView {
  return {
    id: 'week-a', companyName: 'Voorbeeldbedrijf', weekStart: '2026-09-07', enabled: true,
    submissionDeadline: '2026-09-14T10:00:00Z', confirmationDeadline: '2026-09-15T10:00:00Z',
    employees: [{ id: 'member-a', candidateId: 'candidate-a', name: 'Testmedewerker', placementLabel: 'Productie', days: [
      { id: 'day-a', workDate: '2026-09-07', revision: { id: 'revision-a', version: 1, minutes: 480, noHoursReason: null, notes: 'Bronnotitie', sourceLabel: 'Handmatige invoer' }, confirmation: null },
      { id: 'day-b', workDate: '2026-09-08', revision: null, confirmation: null },
    ] }],
  };
}

function internalDay(date: '7' | '8') {
  return screen.getByRole('group', { name: new RegExp(`Testmedewerker, .*${date} sep`) });
}

describe('HoursWeekWorkspace', () => {
  it('keeps missing days distinct from explicit zero and requires a no-hours reason', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HoursWeekWorkspace week={weekFixture()} onSaveDay={onSave} />);
    const missing = internalDay('8');
    expect(within(missing).getByText('Nog niet ontvangen')).toBeInTheDocument();
    fireEvent.click(within(missing).getByRole('button', { name: 'Invoeren' }));
    expect(screen.getByLabelText('Gewerkte uren')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Gewerkte uren'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Kies “Geen uren”');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Geen uren' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Geef een reden');
    fireEvent.change(screen.getByLabelText('Reden geen uren'), { target: { value: ' Vrij ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ dayId: 'day-b', expectedRevisionId: null, minutes: 0, noHoursReason: 'Vrij', notes: null }));
  });

  it.each(['8,5', '8:30'])('saves %s as 510 minutes on the exact visible revision', async (input) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HoursWeekWorkspace week={weekFixture()} onSaveDay={onSave} />);
    fireEvent.click(within(internalDay('7')).getByRole('button', { name: 'Wijzigen' }));
    fireEvent.change(screen.getByLabelText('Gewerkte uren'), { target: { value: input } });
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ dayId: 'day-a', expectedRevisionId: 'revision-a', minutes: 510, noHoursReason: null, notes: 'Bronnotitie' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('does not round sub-minute decimal hours into a payable value', () => {
    const onSave = vi.fn();
    render(<HoursWeekWorkspace week={weekFixture()} onSaveDay={onSave} />);
    fireEvent.click(within(internalDay('8')).getByRole('button', { name: 'Invoeren' }));
    fireEvent.change(screen.getByLabelText('Gewerkte uren'), { target: { value: '8.89' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('preserves a draft and blocks saving when another user updates that day', () => {
    const onSave = vi.fn();
    const week = weekFixture();
    const view = render(<HoursWeekWorkspace week={week} onSaveDay={onSave} />);
    fireEvent.click(within(internalDay('7')).getByRole('button', { name: 'Wijzigen' }));
    fireEvent.change(screen.getByLabelText('Gewerkte uren'), { target: { value: '9' } });
    const updated = weekFixture();
    updated.employees[0].days[0].revision = { ...updated.employees[0].days[0].revision, id: 'revision-new', version: 2, minutes: 420 };
    view.rerender(<HoursWeekWorkspace week={updated} onSaveDay={onSave} />);
    expect(screen.getByLabelText('Gewerkte uren')).toHaveValue('9');
    expect(screen.getByRole('button', { name: 'Dag opslaan' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('ondertussen gewijzigd');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps entered hours after a server version conflict and exposes reload', async () => {
    const onSave = vi.fn().mockRejectedValue({ code: '40001', message: 'hours_revision_conflict' });
    const onReload = vi.fn();
    render(<HoursWeekWorkspace week={weekFixture()} onSaveDay={onSave} onReload={onReload} />);
    fireEvent.click(within(internalDay('7')).getByRole('button', { name: 'Wijzigen' }));
    fireEvent.change(screen.getByLabelText('Gewerkte uren'), { target: { value: '9:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dag opslaan' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ondertussen gewijzigd'));
    expect(screen.getByLabelText('Gewerkte uren')).toHaveValue('9:30');
    expect(screen.getByRole('button', { name: 'Dag opslaan' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Actuele uren laden' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('does not count approval on a previous revision and keeps the source history visible', () => {
    const week = weekFixture();
    week.employees[0].days[0].confirmation = { revisionId: 'old-revision', status: 'confirmed' };
    week.employees[0].days[0].history = [{ id: 'old-revision', version: 0, minutes: 570, noHoursReason: null, notes: 'Eerdere bron', sourceLabel: 'Handmatige invoer' }];
    render(<HoursWeekWorkspace week={week} onSaveDay={vi.fn()} />);
    expect(within(internalDay('7')).getByText('Wacht op medewerker')).toBeInTheDocument();
    expect(screen.getByText('Eerdere versies (1)')).toBeInTheDocument();
    expect(screen.getByText('Eerdere bron')).toBeInTheDocument();
    expect(screen.getByText('0 / 1')).toBeInTheDocument();
  });

  it('shows no intake controls while this company is disabled or user is read-only', () => {
    const view = render(<HoursWeekWorkspace week={{ ...weekFixture(), enabled: false }} onSaveDay={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deze urenstroom staat uit');
    expect(screen.getByRole('heading', { name: 'Voorbeeldbedrijf' })).toBeInTheDocument();
    expect(screen.getByText('Bronnotitie')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.rerender(<HoursWeekWorkspace week={weekFixture()} onSaveDay={vi.fn()} readOnly />);
    expect(screen.queryByRole('button', { name: 'Invoeren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wijzigen' })).not.toBeInTheDocument();
  });

  it('requires a reason for a blocked internal review and binds it to the current revision', async () => {
    const onReview = vi.fn().mockResolvedValue(undefined);
    render(<HoursWeekWorkspace week={weekFixture()} onSaveDay={vi.fn()} onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Afwijking vastleggen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Controle opslaan' }));
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Beschrijf welke afwijking');
    fireEvent.change(screen.getByLabelText('Toelichting controle'), { target: { value: ' Pauze ontbreekt ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Controle opslaan' }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({ dayId: 'day-a', expectedRevisionId: 'revision-a', status: 'blocked', comment: 'Pauze ontbreekt' }));
  });

  it('counts each employee once when they have multiple placements', () => {
    const week = weekFixture();
    week.employees.push({ ...week.employees[0], id: 'member-b', placementLabel: 'Tweede plaatsing', days: [] });
    render(<HoursWeekWorkspace week={week} onSaveDay={vi.fn()} />);
    const metric = screen.getByText('Verwachte medewerkers').parentElement;
    expect(within(metric).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Tweede plaatsing')).toBeInTheDocument();
  });

  it.each(['invoer', 'controle'])('closes an active %s form when the workflow is disabled and keeps history readable', (form) => {
    const onSaveDay = vi.fn();
    const onReview = vi.fn();
    const week = weekFixture();
    week.employees[0].days[0].history = [{ id: 'old-revision', version: 0, minutes: 570, noHoursReason: null, notes: 'Eerdere bron' }];
    const view = render(<HoursWeekWorkspace week={week} onSaveDay={onSaveDay} onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: form === 'invoer' ? 'Wijzigen' : 'Afwijking vastleggen' }));
    expect(screen.getByRole('form')).toBeInTheDocument();
    view.rerender(<HoursWeekWorkspace week={{ ...week, enabled: false }} onSaveDay={onSaveDay} onReview={onReview} />);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Eerdere bron')).toBeInTheDocument();
    expect(onSaveDay).not.toHaveBeenCalled();
    expect(onReview).not.toHaveBeenCalled();
  });

  it('does not mark an internal review complete after a version conflict', async () => {
    const onReview = vi.fn().mockRejectedValue({ code: '40001' });
    render(<HoursWeekWorkspace week={weekFixture()} onSaveDay={vi.fn()} onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Handmatig gecontroleerd' }));
    fireEvent.click(screen.getByRole('button', { name: 'Controle opslaan' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ondertussen gewijzigd'));
    expect(screen.getByRole('button', { name: 'Controle opslaan' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('HoursPortalWeek', () => {
  it('requires a dispute comment and submits the exact revision without changing hours', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    render(<HoursPortalWeek week={weekFixture()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: 'Klopt niet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reactie opslaan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Beschrijf wat er niet klopt');
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Opmerking bij je reactie'), { target: { value: ' Pauze ontbreekt ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reactie opslaan' }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith({ dayId: 'day-a', expectedRevisionId: 'revision-a', response: 'disputed', comment: 'Pauze ontbreekt' }));
  });

  it('confirms only received unconfirmed revisions in a single atomic callback', async () => {
    const onConfirmAll = vi.fn().mockResolvedValue(undefined);
    const week = weekFixture();
    week.employees[0].days.push({ id: 'day-c', workDate: '2026-09-09', revision: { id: 'revision-c', version: 1, minutes: 0, noHoursReason: 'Vrij', notes: null }, confirmation: { revisionId: 'revision-c', status: 'confirmed' } });
    render(<HoursPortalWeek week={week} onRespond={vi.fn()} onConfirmAll={onConfirmAll} />);
    fireEvent.change(screen.getByLabelText('Opmerking bij je reactie (Optioneel)'), { target: { value: ' Gecontroleerd ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Alle ontvangen dagen akkoord' }));
    await waitFor(() => expect(onConfirmAll).toHaveBeenCalledWith({ revisions: [{ dayId: 'day-a', expectedRevisionId: 'revision-a' }], comment: 'Gecontroleerd' }));
    expect(screen.getByText('Nog niet ontvangen')).toBeInTheDocument();
    expect(screen.queryByText('Alle ontvangen dagen zijn bevestigd.')).not.toBeInTheDocument();
  });

  it('blocks stale employee responses when the displayed revision changes', () => {
    const onRespond = vi.fn();
    const view = render(<HoursPortalWeek week={weekFixture()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: 'Akkoord' }));
    const week = weekFixture();
    week.employees[0].days[0].revision.id = 'new-revision';
    week.employees[0].days[0].revision.version = 2;
    view.rerender(<HoursPortalWeek week={week} onRespond={onRespond} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ondertussen gewijzigd');
    expect(screen.getByRole('button', { name: 'Reactie opslaan' })).toBeDisabled();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('reports a bulk conflict without claiming success or retrying automatically', async () => {
    const onConfirmAll = vi.fn().mockRejectedValue({ code: '40001' });
    render(<HoursPortalWeek week={weekFixture()} onRespond={vi.fn()} onConfirmAll={onConfirmAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alle ontvangen dagen akkoord' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ondertussen gewijzigd'));
    expect(screen.getByRole('button', { name: 'Alle ontvangen dagen akkoord' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onConfirmAll).toHaveBeenCalledOnce();
  });

  it.each([['en', 'My hours', 'Not correct'], ['pl', 'Moje godziny', 'Nie zgadza się']] as const)('renders %s UI without translating personal notes', (language, title, dispute) => {
    render(<HoursPortalWeek week={weekFixture()} language={language} onRespond={vi.fn()} />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: dispute })).toBeInTheDocument();
    expect(screen.getByText(/Bronnotitie/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: title })).toHaveAttribute('data-no-translate', 'true');
  });

  it('keeps missing dates non-actionable and hides actions without portal permission', () => {
    const view = render(<HoursPortalWeek week={weekFixture()} onRespond={vi.fn()} />);
    const missing = screen.getByRole('group', { name: /8 sep/ });
    expect(within(missing).getByText('—')).toBeInTheDocument();
    expect(within(missing).queryByRole('button')).not.toBeInTheDocument();
    view.rerender(<HoursPortalWeek week={weekFixture()} onRespond={vi.fn()} onConfirmAll={vi.fn()} readOnly />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('closes an active response form when permission becomes read-only', () => {
    const onRespond = vi.fn();
    const view = render(<HoursPortalWeek week={weekFixture()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: 'Akkoord' }));
    expect(screen.getByRole('button', { name: 'Reactie opslaan' })).toBeInTheDocument();
    view.rerender(<HoursPortalWeek week={weekFixture()} onRespond={onRespond} readOnly />);
    expect(screen.queryByRole('button', { name: 'Reactie opslaan' })).not.toBeInTheDocument();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('keeps existing hours and responses visible when the workflow is disabled and closes response controls', () => {
    const onRespond = vi.fn();
    const onConfirmAll = vi.fn();
    const week = weekFixture();
    week.employees[0].days[0].confirmation = { revisionId: 'revision-a', status: 'confirmed', comment: 'Eerdere reactie' };
    const view = render(<HoursPortalWeek week={week} onRespond={onRespond} onConfirmAll={onConfirmAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Klopt niet' }));
    expect(screen.getByRole('button', { name: 'Reactie opslaan' })).toBeInTheDocument();
    view.rerender(<HoursPortalWeek week={{ ...week, enabled: false }} onRespond={onRespond} onConfirmAll={onConfirmAll} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deze urenstroom staat uit');
    expect(screen.getByRole('heading', { name: 'Mijn uren' })).toBeInTheDocument();
    expect(screen.getByText(/Bronnotitie/)).toBeInTheDocument();
    expect(screen.getByText(/Eerdere reactie/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onRespond).not.toHaveBeenCalled();
    expect(onConfirmAll).not.toHaveBeenCalled();
  });
});
