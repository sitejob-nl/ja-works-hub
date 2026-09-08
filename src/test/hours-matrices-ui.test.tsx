import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixVersionEditor, type MatrixVersionEditorProps } from '@/components/hours-matrices/MatrixVersionEditor';
import type { MatrixDetail, MatrixVersion } from '@/lib/hours-matrices';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(() => { throw new Error('Editor tests must never contact Supabase.'); }) },
}));

afterEach(cleanup);

const version = (overrides: Partial<MatrixVersion> = {}): MatrixVersion => ({
  id: '00000000-0000-4000-8000-000000000001', matrix_id: '00000000-0000-4000-8000-000000000002',
  version_number: 1, revision: 2, status: 'draft', valid_from: '2026-09-01', valid_until: null,
  effective_valid_until: null, published_definition: null,
  definition: {
    schemaVersion: 1, timeBasis: 'wall_clock', id: '00000000-0000-4000-8000-000000000001', scope: 'client',
    validFrom: '2026-09-01', validUntil: null, confirmed: false,
    categories: [{ code: 'NOR', factor: '1.00' }, { code: 'OV', factor: '1.250' }],
    categoryMappings: [{ id: 'map-ov1', sourceCode: 'OV1', categoryCode: 'OV' }],
    automaticRules: { kind: 'flat', rule: { id: 'all-hours', categoryCode: 'NOR' } },
  },
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z', published_at: null, published_by: null,
  ...overrides,
});

const matrix = (): MatrixDetail => ({
  id: '00000000-0000-4000-8000-000000000002', name: 'Bevestigde klantafspraken', scope: 'client',
  company_id: '00000000-0000-4000-8000-000000000003', company_name: 'Testopdrachtgever',
  version_count: 1, published_version_count: 0, versions: [version()], can_manage: true,
});

function mount(overrides: Partial<MatrixVersionEditorProps> = {}) {
  const props: MatrixVersionEditorProps = {
    matrix: matrix(), version: version(), canManage: true,
    onSave: vi.fn().mockResolvedValue(undefined), onPublish: vi.fn().mockResolvedValue(undefined), onReload: vi.fn(),
    ...overrides,
  };
  return { ...render(<MatrixVersionEditor {...props} />), props };
}

const publish = () => screen.getByRole('button', { name: 'Bevestigen en publiceren' });
const confirmation = () => screen.getByRole('checkbox', { name: /Ik heb de afspraken, geldigheid en het actuele rekenvoorbeeld gecontroleerd/ });
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function successfulPreview() {
  fill('Netto-uren voorbeeld', '8:30');
  fireEvent.click(screen.getByRole('button', { name: 'Voorbeeld berekenen' }));
  expect(screen.getByRole('status')).toHaveTextContent('Voorbeeld sluit aan: 8:30 uur.');
}

describe('matrix version publication', () => {
  it('makes published configuration read-only while allowing an unsaved calculation example', () => {
    const published = version({ status: 'published', definition: { ...version().definition, confirmed: true } });
    const { props } = mount({ version: published });
    expect(screen.getByText(/Deze gepubliceerde versie is onveranderlijk/)).toBeInTheDocument();
    expect(screen.getByLabelText('Geldig vanaf')).toBeDisabled();
    expect(screen.getByLabelText('Factor 1')).toBeDisabled();
    expect(screen.getByLabelText('Indeling zonder broncategorieën')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Concept opslaan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bevestigen en publiceren' })).not.toBeInTheDocument();
    successfulPreview();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onPublish).not.toHaveBeenCalled();
  });

  it('withholds editing and publication from readers', () => {
    mount({ canManage: false });
    expect(screen.getByLabelText('Factor 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Concept opslaan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bevestigen en publiceren' })).not.toBeInTheDocument();
  });

  it('blocks an incomplete new matrix without creating inferred hour codes', () => {
    const { props } = mount({ version: undefined });
    expect(screen.queryByLabelText('Uurcode 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concept opslaan' })).toBeDisabled();
    expect(confirmation()).toBeDisabled();
    expect(publish()).toBeDisabled();
    fireEvent.click(publish());
    expect(props.onPublish).not.toHaveBeenCalled();
  });

  it('does not allow confirmation or publication after a failed preview', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Voorbeeld berekenen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Het aantal uren ontbreekt.');
    expect(confirmation()).toBeDisabled();
    expect(publish()).toBeDisabled();
    fireEvent.click(publish());
    expect(props.onPublish).not.toHaveBeenCalled();
  });

  it('blocks a backdated successor even after a successful preview, using the Dutch calendar date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-07T22:30:00Z'));
    try {
      const previous = version({ id: '00000000-0000-4000-8000-000000000004', status: 'published', valid_from: '2026-08-01' });
      const successor = version({ valid_from: '2026-09-07' });
      const { props } = mount({ version: successor, matrix: { ...matrix(), versions: [previous, successor] } });
      successfulPreview();
      expect(screen.getByRole('alert')).toHaveTextContent('Een opvolgende versie mag niet vóór vandaag (2026-09-08, Nederlandse tijd) beginnen.');
      expect(confirmation()).toBeDisabled();
      expect(publish()).toBeDisabled();
      fireEvent.click(publish());
      expect(props.onPublish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires both a successful current preview and explicit confirmation before publishing the saved revision', async () => {
    const { props } = mount();
    expect(confirmation()).toBeDisabled();
    expect(publish()).toBeDisabled();
    successfulPreview();
    expect(confirmation()).toBeEnabled();
    expect(confirmation()).not.toBeChecked();
    expect(publish()).toBeDisabled();
    fireEvent.click(confirmation());
    expect(publish()).toBeEnabled();
    fireEvent.click(publish());
    await waitFor(() => expect(props.onPublish).toHaveBeenCalledExactlyOnceWith(props.version));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('invalidates the preview and confirmation when matrix configuration changes', () => {
    const { props } = mount();
    successfulPreview();
    fireEvent.click(confirmation());
    fill('Factor 1', '1.50');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(confirmation()).not.toBeChecked();
    expect(confirmation()).toBeDisabled();
    expect(publish()).toBeDisabled();
    expect(screen.getByText('Sla je wijzigingen op voordat je deze versie publiceert.')).toBeInTheDocument();
    fireEvent.click(publish());
    expect(props.onPublish).not.toHaveBeenCalled();
  });

  it('requires renewed confirmation after changing and recalculating the example workday', () => {
    mount();
    successfulPreview();
    fireEvent.click(confirmation());
    fill('Netto-uren voorbeeld', '9');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(confirmation()).not.toBeChecked();
    expect(confirmation()).toBeDisabled();
    expect(publish()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Voorbeeld berekenen' }));
    expect(screen.getByRole('status')).toHaveTextContent('Voorbeeld sluit aan: 9:00 uur.');
    expect(confirmation()).toBeEnabled();
    expect(confirmation()).not.toBeChecked();
    expect(publish()).toBeDisabled();
    fireEvent.click(confirmation());
    expect(publish()).toBeEnabled();
  });

  it('shows mapped OV values and exact factors in the calculation result', () => {
    mount();
    fill('Netto-uren voorbeeld', '8:30');
    fill('Gegevens van de werkdag', 'categories');
    fill('Voorbeeld broncode 1', 'OV1');
    fill('Voorbeeld uren broncode 1', '8,5');
    fireEvent.click(screen.getByRole('button', { name: 'Voorbeeld berekenen' }));
    const result = within(screen.getByRole('status'));
    expect(result.getByRole('cell', { name: /^OV$/ })).toBeInTheDocument();
    expect(result.getByRole('cell', { name: '1.250' })).toBeInTheDocument();
    expect(result.getByRole('cell', { name: '8:30' })).toBeInTheDocument();
    expect(result.getByRole('cell', { name: /^OV1$/ })).toBeInTheDocument();
  });
});

describe('matrix editor concurrent changes', () => {
  it.each(['40001', 'PT409'])('preserves typed changes after CAS rejection %s and only reloads after an explicit action', async code => {
    const { props } = mount({ onSave: vi.fn().mockRejectedValue({ code, message: 'Private SQL detail' }) });
    fill('Factor 1', '1.3750');
    fireEvent.click(screen.getByRole('button', { name: 'Concept opslaan' }));
    await screen.findByText(/Je invoer blijft zichtbaar/);
    expect(screen.getByLabelText('Factor 1')).toHaveValue('1.3750');
    expect(screen.getByRole('button', { name: 'Concept opslaan' })).toBeDisabled();
    expect(publish()).toBeDisabled();
    expect(screen.queryByText(/Private SQL detail/)).not.toBeInTheDocument();
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ categories: [{ code: 'NOR', factor: '1.3750' }, { code: 'OV', factor: '1.250' }] }),
    }));
    expect(props.onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Actuele matrix laden' }));
    expect(props.onReload).toHaveBeenCalledOnce();
  });

  it('preserves local edits when a newer server revision arrives while editing', () => {
    const { props, rerender } = mount();
    fill('Factor 1', '1.50');
    rerender(<MatrixVersionEditor {...props} version={version({ revision: 3 })} />);
    expect(screen.getByText(/Je invoer blijft zichtbaar/)).toBeInTheDocument();
    expect(screen.getByLabelText('Factor 1')).toHaveValue('1.50');
    expect(screen.getByRole('button', { name: 'Concept opslaan' })).toBeDisabled();
    expect(publish()).toBeDisabled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onReload).not.toHaveBeenCalled();
  });
});
