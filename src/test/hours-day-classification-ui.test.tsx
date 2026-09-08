import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursSourceEditor } from '@/components/hours-workflow/HoursSourceEditor';
import { HoursWeekWorkspace, type HoursWeekWorkspaceProps } from '@/components/hours-workflow/HoursWeekWorkspace';
import { sourceDraftFromInput, type HoursSourceInput } from '@/components/hours-workflow/hours-day-source';
import type { HoursClassificationView, HoursWeekView } from '@/components/hours-workflow/types';

beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const source = (): HoursSourceInput => ({
  schemaVersion: 1,
  shifts: [{ start: '22:00', end: '06:00', endDayOffset: 1,
    breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1, endDayOffset: 1 }],
  }],
  categories: [{ sourceCode: 'OV1', minutes: 450 }],
});

const classification = (overrides: Partial<HoursClassificationView> = {}): HoursClassificationView => ({
  id: 'classification-a', revisionId: 'revision-a', status: 'classified', matrixVersionId: 'matrix-version-a',
  matrixName: 'Bevestigde nachturen', matrixScope: 'client', engineVersion: 'hours-v1',
  createdAt: '2026-09-08T08:00:00Z', basisPinned: true,
  allocations: [{ categoryCode: 'NACHT', factor: '1.250', minutes: 450, ruleId: 'map-ov1', sourceCategory: 'OV1' }],
  issues: [], ...overrides,
});

function weekFixture(): HoursWeekView {
  return {
    id: 'week-a', companyName: 'Testopdrachtgever', weekStart: '2026-09-07', enabled: true,
    employees: [{ id: 'member-a', candidateId: 'candidate-a', name: 'Testmedewerker', days: [
      { id: 'day-a', workDate: '2026-09-07', revision: {
        id: 'revision-a', version: 2, minutes: 450, noHoursReason: null, notes: 'Aangeleverde nachtdienst', sourceInput: source(),
      }, confirmation: null },
    ] }],
  };
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

function SourceHarness({ input = null }: { input?: HoursSourceInput | null }) {
  const [draft, setDraft] = useState(() => sourceDraftFromInput(input));
  return <HoursSourceEditor value={draft} onChange={setDraft} idPrefix="test-source" />;
}

function mount(overrides: Partial<HoursWeekWorkspaceProps> = {}) {
  const props: HoursWeekWorkspaceProps = {
    week: weekFixture(), onSaveDay: vi.fn().mockResolvedValue(undefined), ...overrides,
  };
  return { ...render(<HoursWeekWorkspace {...props} />), props };
}

describe('source facts editing', () => {
  it('never selects a next-day interpretation or confirms no breaks for a newly entered shift', () => {
    render(<SourceHarness />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Diensttijden vastleggen' }));
    expect(screen.getByLabelText('Einddag dienst 1')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Ik bevestig dat dienst 1 geen pauzes heeft.' })).not.toBeChecked();
    click('Pauze toevoegen aan dienst 1');
    expect(screen.getByLabelText('Begindag pauze 1 dienst 1')).toHaveValue('');
    expect(screen.getByLabelText('Einddag pauze 1 dienst 1')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Alle pauzes van dienst 1 zijn gecontroleerd.' })).not.toBeChecked();
  });

  it('requires renewed break confirmation after editing a saved shift or its pause', () => {
    render(<SourceHarness input={source()} />);
    const confirmation = () => screen.getByRole('checkbox', { name: 'Alle pauzes van dienst 1 zijn gecontroleerd.' });
    expect(confirmation()).toBeChecked();
    fill('Eindtijd dienst 1', '07:00');
    expect(confirmation()).not.toBeChecked();
    fireEvent.click(confirmation());
    fill('Pauze eindigt', '02:45');
    expect(confirmation()).not.toBeChecked();
    expect(screen.getByLabelText('Broncode 1')).toHaveValue('OV1');
    expect(screen.getByLabelText('Uren broncode 1')).toHaveValue('7:30');
  });
});

describe('saving source facts with an exact day revision', () => {
  it('preserves the original source object when only a note changes', async () => {
    const { props } = mount();
    click('Wijzigen');
    fill('Opmerking bij de invoer', ' Nagekeken bronbestand ');
    click('Dag opslaan');
    await waitFor(() => expect(props.onSaveDay).toHaveBeenCalledExactlyOnceWith({
      dayId: 'day-a', expectedRevisionId: 'revision-a', minutes: 450, noHoursReason: null,
      notes: 'Nagekeken bronbestand', sourceInput: source(),
    }));
  });

  it('requires explicit confirmation before removing existing source sections', async () => {
    const { props } = mount();
    click('Wijzigen');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Diensttijden vastleggen' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Broncategorieën vastleggen' }));
    click('Dag opslaan');
    expect(props.onSaveDay).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Bevestig expliciet');
    fireEvent.click(screen.getByRole('checkbox', { name: /Ik bevestig dat ik de uitgeschakelde brongegevens/ }));
    click('Dag opslaan');
    await waitFor(() => expect(props.onSaveDay).toHaveBeenCalledWith(expect.objectContaining({ sourceInput: null })));
  });

  it('requires confirmation for partial removal and preserves the remaining categories', async () => {
    const { props } = mount();
    click('Wijzigen');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Diensttijden vastleggen' }));
    click('Dag opslaan');
    expect(props.onSaveDay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Ik bevestig dat ik de uitgeschakelde brongegevens/ }));
    click('Dag opslaan');
    await waitFor(() => expect(props.onSaveDay).toHaveBeenCalledWith(expect.objectContaining({
      sourceInput: { schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 450 }] },
    })));
  });

  it('saves a reported total that contradicts source details while showing the required review', async () => {
    const { props } = mount();
    click('Wijzigen');
    fill('Gewerkte uren', '8');
    expect(screen.getByRole('alert')).toHaveTextContent('De brongegevens vragen om controle.');
    expect(screen.getByRole('alert')).toHaveTextContent('Berekend: 7,5 uur; aangeleverd: 8 uur.');
    click('Dag opslaan');
    await waitFor(() => expect(props.onSaveDay).toHaveBeenCalledWith(expect.objectContaining({ minutes: 480, sourceInput: source() })));
  });

  it('does not erase contradictory shift evidence when the day is changed to no hours', async () => {
    const { props } = mount();
    click('Wijzigen');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Geen uren' }));
    fill('Reden geen uren', 'Afwezig volgens opdrachtgever');
    click('Dag opslaan');
    await waitFor(() => expect(props.onSaveDay).toHaveBeenCalledWith(expect.objectContaining({
      minutes: 0, noHoursReason: 'Afwezig volgens opdrachtgever', sourceInput: source(),
    })));
  });

  it('requires day selection and confirmation of no breaks before saving a new shift', async () => {
    const week = weekFixture();
    week.employees[0].days[0].revision.sourceInput = null;
    const { props } = mount({ week });
    click('Wijzigen');
    fill('Gewerkte uren', '8');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Diensttijden vastleggen' }));
    fill('Begintijd dienst 1', '08:00');
    fill('Eindtijd dienst 1', '16:00');
    click('Dag opslaan');
    expect(props.onSaveDay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ik bevestig dat dienst 1 geen pauzes heeft.' }));
    click('Dag opslaan');
    expect(screen.getByRole('alert')).toHaveTextContent('expliciet aan op welke dag');
    expect(props.onSaveDay).not.toHaveBeenCalled();
    fill('Einddag dienst 1', '0');
    expect(screen.getByRole('checkbox', { name: 'Ik bevestig dat dienst 1 geen pauzes heeft.' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ik bevestig dat dienst 1 geen pauzes heeft.' }));
    click('Dag opslaan');
    await waitFor(() => expect(props.onSaveDay).toHaveBeenCalledWith(expect.objectContaining({
      minutes: 480, sourceInput: { schemaVersion: 1, shifts: [{ start: '08:00', end: '16:00', endDayOffset: 0, breaks: [] }] },
    })));
  });

  it('retains edited source facts and blocks overwriting after a revision conflict', async () => {
    const onSaveDay = vi.fn().mockRejectedValue({ code: '40001' });
    const onReload = vi.fn();
    mount({ onSaveDay, onReload });
    click('Wijzigen');
    fill('Broncode 1', 'OV2');
    click('Dag opslaan');
    await screen.findByText(/Deze dag is ondertussen gewijzigd/);
    expect(screen.getByLabelText('Broncode 1')).toHaveValue('OV2');
    expect(screen.getByLabelText('Begintijd dienst 1')).toHaveValue('22:00');
    expect(screen.getByRole('button', { name: 'Dag opslaan' })).toBeDisabled();
    expect(onReload).not.toHaveBeenCalled();
    click('Actuele uren laden');
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('server classification of the displayed day revision', () => {
  it('submits only the day and exact revision, without claiming a result before the server view arrives', async () => {
    const onClassify = vi.fn().mockResolvedValue(undefined);
    mount({ onClassify });
    click('Uursoorten controleren');
    await waitFor(() => expect(onClassify).toHaveBeenCalledExactlyOnceWith({ dayId: 'day-a', expectedRevisionId: 'revision-a' }));
    expect(screen.getByText('Uursoorten nog niet gecontroleerd voor deze versie.')).toBeInTheDocument();
    expect(screen.queryByText('Uursoorten ingedeeld')).not.toBeInTheDocument();
  });

  it('shows exact category minutes, configured factors and the pinned matrix without claiming payroll release', () => {
    const week = weekFixture();
    week.employees[0].days[0].classification = classification();
    mount({ week });
    expect(screen.getByText('Uursoorten ingedeeld')).toBeInTheDocument();
    expect(screen.getByText('Bevestigde nachturen')).toBeInTheDocument();
    expect(screen.getByText(/vastgelegde basis/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1.250' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '7,5' })).toBeInTheDocument();
    expect(screen.getByText(/Deze uitkomst is geen payrollvrijgave/)).toBeInTheDocument();
    expect(screen.getByText('Wacht op medewerker')).toBeInTheDocument();
    expect(screen.getByText('Intern te controleren')).toBeInTheDocument();
  });

  it('does not show stale allocations or blocked counts as the result of a newer day revision', () => {
    const week = weekFixture();
    week.employees[0].days[0].classification = classification({ revisionId: 'previous-revision', status: 'blocked',
      issues: [{ code: 'TOTAL_MISMATCH', message: 'Deze oude afwijking hoort niet bij de nieuwe versie.' }],
    });
    mount({ week });
    expect(screen.getByText('Uursoorten nog niet gecontroleerd voor deze versie.')).toBeInTheDocument();
    expect(screen.queryByText('Uurindeling geblokkeerd')).not.toBeInTheDocument();
    expect(screen.queryByText(/Deze oude afwijking/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dag vraagt aandacht/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows blocked issues and original totals, hides allocations and counts the day once', () => {
    const week = weekFixture();
    const day = week.employees[0].days[0];
    day.classification = classification({ status: 'blocked', issues: [{ code: 'TOTAL_MISMATCH',
      message: 'Diensttotaal wijkt af.', expectedMinutes: 420, actualMinutes: 450,
    }] });
    day.confirmation = { revisionId: 'revision-a', status: 'disputed' };
    day.review = { revisionId: 'revision-a', status: 'blocked' };
    mount({ week });
    expect(screen.getByText('Uurindeling geblokkeerd')).toBeInTheDocument();
    expect(screen.getByText(/Diensttotaal wijkt af. Berekend: 7 uur; aangeleverd: 7,5 uur./)).toBeInTheDocument();
    expect(screen.getByText(/1 dag vraagt aandacht/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each(['paused', 'read-only'])('keeps classification history visible but hides write actions when %s', condition => {
    const week = weekFixture();
    week.employees[0].days[0].classification = classification();
    if (condition === 'paused') week.enabled = false;
    const onClassify = vi.fn();
    mount({ week, readOnly: condition === 'read-only', onClassify });
    expect(screen.getByRole('cell', { name: '1.250' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uursoorten controleren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wijzigen' })).not.toBeInTheDocument();
    expect(onClassify).not.toHaveBeenCalled();
  });

  it('does not classify an unsaved local edit', () => {
    const onClassify = vi.fn();
    mount({ onClassify });
    click('Wijzigen');
    fill('Broncode 1', 'OV2');
    expect(screen.getByRole('button', { name: 'Uursoorten controleren' })).toBeDisabled();
    click('Uursoorten controleren');
    expect(onClassify).not.toHaveBeenCalled();
  });

  it('reports a classification CAS conflict without automatic retries or a success claim', async () => {
    const onClassify = vi.fn().mockRejectedValue({ code: '40001' });
    const onReload = vi.fn();
    mount({ onClassify, onReload });
    click('Uursoorten controleren');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('dagversie of matrixbasis is ondertussen gewijzigd'));
    expect(onClassify).toHaveBeenCalledOnce();
    expect(screen.queryByText('Uursoorten ingedeeld')).not.toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();
    click('Actuele uren laden');
    expect(onReload).toHaveBeenCalledOnce();
  });
});
