import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursWeekWorkspace, type HoursWeekWorkspaceProps } from '@/components/hours-workflow/HoursWeekWorkspace';
import type {
  HoursClassificationView, HoursDayBasisView, HoursMatrixOptionsView, HoursWeekView,
} from '@/components/hours-workflow/types';

beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const classification = (overrides: Partial<HoursClassificationView> = {}): HoursClassificationView => ({
  id: 'classification-b', revisionId: 'revision-a', status: 'classified', matrixVersionId: 'version-cao',
  matrixName: 'CAO-matrix', matrixScope: 'cao', engineVersion: 'hours-calculation-v1',
  createdAt: '2026-09-17T09:00:00Z', basisPinned: true, basisVersion: 1,
  allocations: [{ categoryCode: 'NORMAAL', factor: '2', minutes: 480, ruleId: 'default' }],
  issues: [], ...overrides,
});

const previous = classification({
  id: 'classification-a', matrixVersionId: 'version-client', matrixName: 'Klantmatrix', matrixScope: 'client',
  basisVersion: 0, createdAt: '2026-09-17T08:00:00Z',
  allocations: [{ categoryCode: 'NORMAAL', factor: '1.250', minutes: 480, ruleId: 'default' }],
});

const basis = (overrides: Partial<HoursDayBasisView> = {}): HoursDayBasisView => ({
  basisVersion: 1, matrixId: 'matrix-cao', matrixVersionId: 'version-cao', matrixName: 'CAO-matrix', scope: 'cao',
  entries: [
    { basisVersion: 0, matrixId: 'matrix-client', matrixVersionId: 'version-client', matrixName: 'Klantmatrix',
      scope: 'client', reason: null, revisionId: 'revision-a', createdBy: 'actor-a', createdAt: '2026-09-17T08:00:00Z' },
    { basisVersion: 1, matrixId: 'matrix-cao', matrixVersionId: 'version-cao', matrixName: 'CAO-matrix',
      scope: 'cao', reason: 'Klantmatrix hoorde bij een andere vestiging', revisionId: 'revision-a',
      createdBy: 'actor-a', createdAt: '2026-09-17T09:00:00Z' },
  ], ...overrides,
});

const options = (overrides: Partial<HoursMatrixOptionsView> = {}): HoursMatrixOptionsView => ({
  dayId: 'day-a', workDate: '2026-09-14', released: false, canManage: true, basis: basis(),
  options: [
    { matrixId: 'matrix-cao', matrixVersionId: 'version-cao', matrixName: 'CAO-matrix', scope: 'cao', validFrom: '2026-01-01', validUntil: null, isCurrent: true },
    { matrixId: 'matrix-client', matrixVersionId: 'version-client', matrixName: 'Klantmatrix', scope: 'client', validFrom: '2026-01-01', validUntil: null, isCurrent: false },
  ], ...overrides,
});

function weekFixture(): HoursWeekView {
  return {
    id: 'week-a', companyName: 'Testopdrachtgever', weekStart: '2026-09-14', enabled: true,
    employees: [{ id: 'member-a', candidateId: 'candidate-a', name: 'Testmedewerker', days: [{
      id: 'day-a', workDate: '2026-09-14', confirmation: null,
      revision: { id: 'revision-a', version: 2, minutes: 480, noHoursReason: null, notes: null, sourceInput: null },
      classification: classification(), previousClassifications: [previous], matrixBasis: basis(),
    }] }],
  };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

function mount(overrides: Partial<HoursWeekWorkspaceProps> = {}) {
  const props: HoursWeekWorkspaceProps = {
    week: weekFixture(), onSaveDay: vi.fn().mockResolvedValue(undefined),
    onLoadMatrixOptions: vi.fn().mockResolvedValue(options()),
    onReplaceBasis: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<HoursWeekWorkspace {...props} />), props };
}

async function openForm() {
  click('Andere matrixbasis vastleggen');
  await screen.findByLabelText('Nieuwe matrixbasis');
}

describe('the basis a day stands on', () => {
  it('names the basis in force and keeps every earlier basis with its reason', () => {
    mount();
    expect(screen.getByText(/Huidige matrixbasis/)).toHaveTextContent('CAO-matrix');
    expect(screen.getByText(/Huidige matrixbasis/)).toHaveTextContent('basisversie 1');
    expect(screen.getByText(/Vervangen omdat/)).toHaveTextContent('Klantmatrix hoorde bij een andere vestiging');
    fireEvent.click(screen.getByText(/Eerdere matrixbasis \(1\)/));
    expect(screen.getByText(/Basisversie 0/)).toHaveTextContent('Klantmatrix');
  });

  it('does not call an outcome without a matrix basis version zero', () => {
    const week = weekFixture();
    week.employees[0].days[0].previousClassifications = [classification({
      id: 'classification-legacy', basisVersion: null, matrixVersionId: null, matrixName: null,
      matrixScope: null, status: 'no_hours', allocations: [],
    })];
    mount({ week });
    fireEvent.click(screen.getByText(/Eerdere uitkomst/));
    expect(screen.getByText(/Uitkomst zonder vastgelegde matrixbasis/)).toBeInTheDocument();
    expect(screen.queryByText(/Uitkomst op basisversie 0/)).not.toBeInTheDocument();
  });

  it('shows the superseded outcome next to the current one', () => {
    mount();
    fireEvent.click(screen.getByText(/Eerdere uitkomst/));
    expect(screen.getByRole('cell', { name: '1.250' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  it('warns that a shown outcome still belongs to the previous basis', () => {
    const week = weekFixture();
    week.employees[0].days[0].classification = previous;
    week.employees[0].days[0].previousClassifications = [];
    mount({ week });
    expect(screen.getByText(/hoort nog bij een eerdere matrixbasis/)).toBeInTheDocument();
  });

  it('says nothing about a basis on a day that has never been classified', () => {
    const week = weekFixture();
    const day = week.employees[0].days[0];
    day.classification = null;
    day.previousClassifications = [];
    day.matrixBasis = null;
    mount({ week });
    expect(screen.queryByRole('region', { name: 'Matrixbasis' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Huidige matrixbasis/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Andere matrixbasis vastleggen' })).not.toBeInTheDocument();
  });
});

describe('replacing the basis', () => {
  it('asks the server which matrices this day may use and never offers the current one', async () => {
    const { props } = mount();
    await openForm();
    expect(props.onLoadMatrixOptions).toHaveBeenCalledExactlyOnceWith('day-a');
    const select = screen.getByLabelText('Nieuwe matrixbasis') as HTMLSelectElement;
    const values = Array.from(select.options).map(option => option.value).filter(Boolean);
    expect(values).toEqual(['version-client']);
  });

  it('refuses to submit without a reason and without a chosen matrix', async () => {
    const { props } = mount();
    await openForm();
    click('Matrixbasis vervangen');
    expect(props.onReplaceBasis).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Kies de matrixversie');
    fireEvent.change(screen.getByLabelText('Nieuwe matrixbasis'), { target: { value: 'version-client' } });
    click('Matrixbasis vervangen');
    expect(props.onReplaceBasis).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Leg vast waarom');
    fireEvent.change(screen.getByLabelText('Reden van de vervanging'), { target: { value: '   ' } });
    click('Matrixbasis vervangen');
    expect(props.onReplaceBasis).not.toHaveBeenCalled();
  });

  it('sends the day, the exact day version, the basis version it saw, the matrix and the reason', async () => {
    const { props } = mount();
    await openForm();
    fireEvent.change(screen.getByLabelText('Nieuwe matrixbasis'), { target: { value: 'version-client' } });
    fireEvent.change(screen.getByLabelText('Reden van de vervanging'), { target: { value: '  Verkeerde matrix gekozen  ' } });
    click('Matrixbasis vervangen');
    await waitFor(() => expect(props.onReplaceBasis).toHaveBeenCalledExactlyOnceWith({
      dayId: 'day-a', expectedRevisionId: 'revision-a', expectedBasisVersion: 1,
      matrixVersionId: 'version-client', reason: 'Verkeerde matrix gekozen',
    }));
  });

  it('says the recalculation still has to happen and does not claim a new outcome', async () => {
    const { props } = mount();
    await openForm();
    fireEvent.change(screen.getByLabelText('Nieuwe matrixbasis'), { target: { value: 'version-client' } });
    fireEvent.change(screen.getByLabelText('Reden van de vervanging'), { target: { value: 'Verkeerde matrix' } });
    click('Matrixbasis vervangen');
    await waitFor(() => expect(props.onReplaceBasis).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Voer de uursoortencontrole opnieuw uit/)).toBeInTheDocument();
  });

  it('lets the confirmation be closed again instead of blocking the panel', async () => {
    mount();
    await openForm();
    fireEvent.change(screen.getByLabelText('Nieuwe matrixbasis'), { target: { value: 'version-client' } });
    fireEvent.change(screen.getByLabelText('Reden van de vervanging'), { target: { value: 'Verkeerde matrix' } });
    click('Matrixbasis vervangen');
    await screen.findByText(/Voer de uursoortencontrole opnieuw uit/);
    click('Sluiten');
    expect(screen.queryByText(/Voer de uursoortencontrole opnieuw uit/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Andere matrixbasis vastleggen' })).toBeEnabled();
  });

  it('reports a conflict without retrying and offers the current hours instead', async () => {
    const onReplaceBasis = vi.fn().mockRejectedValue({ code: 'PT409' });
    const onReload = vi.fn();
    const { props } = mount({ onReplaceBasis, onReload });
    await openForm();
    fireEvent.change(screen.getByLabelText('Nieuwe matrixbasis'), { target: { value: 'version-client' } });
    fireEvent.change(screen.getByLabelText('Reden van de vervanging'), { target: { value: 'Verkeerde matrix' } });
    click('Matrixbasis vervangen');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ondertussen gewijzigd'));
    expect(props.onReplaceBasis).toHaveBeenCalledOnce();
    expect(onReload).not.toHaveBeenCalled();
    click('Actuele uren laden');
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('offers no replacement on a day that has already been released', async () => {
    const onLoadMatrixOptions = vi.fn().mockResolvedValue(options({ released: true, options: [] }));
    const { props } = mount({ onLoadMatrixOptions });
    click('Andere matrixbasis vastleggen');
    expect(await screen.findByText(/al vrijgegeven/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nieuwe matrixbasis')).not.toBeInTheDocument();
    expect(props.onReplaceBasis).not.toHaveBeenCalled();
  });

  it('explains an empty list instead of offering an empty choice', async () => {
    const onLoadMatrixOptions = vi.fn().mockResolvedValue(options({ options: [options().options[0]] }));
    mount({ onLoadMatrixOptions });
    click('Andere matrixbasis vastleggen');
    expect(await screen.findByText(/geen andere gepubliceerde matrixversie/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Matrixbasis vervangen' })).not.toBeInTheDocument();
  });

  it.each(['paused', 'read-only'])('keeps the basis history readable but offers no replacement when %s', condition => {
    const week = weekFixture();
    if (condition === 'paused') week.enabled = false;
    const onReplaceBasis = vi.fn();
    mount({ week, readOnly: condition === 'read-only', onReplaceBasis });
    expect(screen.getByText(/Huidige matrixbasis/)).toHaveTextContent('CAO-matrix');
    expect(screen.queryByRole('button', { name: 'Andere matrixbasis vastleggen' })).not.toBeInTheDocument();
    expect(onReplaceBasis).not.toHaveBeenCalled();
  });

  it('blocks a replacement while the day version on screen is being edited', () => {
    mount();
    click('Wijzigen');
    expect(screen.getByRole('button', { name: 'Andere matrixbasis vastleggen' })).toBeDisabled();
  });
});
