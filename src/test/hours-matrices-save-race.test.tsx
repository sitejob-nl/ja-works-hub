import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HoursMatrices from '@/pages/HoursMatrices';
import type { MatrixConfig, MatrixDetail, MatrixVersion } from '@/lib/hours-matrices';
import { qk } from '@/lib/query-keys';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/hooks/useOrganizationId', () => ({ useOrganizationId: () => '00000000-0000-4000-8000-000000000001' }));
vi.mock('@/hooks/usePermissions', () => ({ useRolePermission: () => true }));

const orgId = '00000000-0000-4000-8000-000000000001';
const matrixId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const companyId = '00000000-0000-4000-8000-000000000004';
const clients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const response = <T,>(data: T) => ({ data, error: null });
const list = (matrix: MatrixDetail) => ({ matrices: [{
  id: matrix.id, name: matrix.name, scope: matrix.scope, company_id: matrix.company_id,
  company_name: matrix.company_name, version_count: matrix.version_count, published_version_count: matrix.published_version_count,
}], can_manage: true });

const emptyMatrix = (): MatrixDetail => ({
  id: matrixId, name: 'QA matrix met vertraagde opslag', scope: 'client', company_id: companyId,
  company_name: 'Voorbeeldopdrachtgever', version_count: 0, published_version_count: 0, versions: [], can_manage: true,
});

function storedDraft(input: { p_config: MatrixConfig; p_valid_from: string; p_valid_until: string | null }): MatrixDetail {
  const version: MatrixVersion = {
    id: versionId, matrix_id: matrixId, version_number: 1, status: 'draft', revision: 1,
    valid_from: input.p_valid_from, valid_until: input.p_valid_until, effective_valid_until: input.p_valid_until,
    definition: { ...input.p_config, id: versionId, scope: 'client', validFrom: input.p_valid_from, validUntil: input.p_valid_until, confirmed: false },
    published_definition: null, created_at: '2026-09-08T08:00:00Z', updated_at: '2026-09-08T08:00:00Z',
    published_at: null, published_by: null,
  };
  return { ...emptyMatrix(), versions: [version], version_count: 1 };
}

const confirmation = () => screen.getByRole('checkbox', { name: /Ik heb de afspraken, geldigheid en het actuele rekenvoorbeeld gecontroleerd/ });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const callsTo = (name: string) => rpc.mock.calls.filter(call => call[0] === name).length;

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  rpc.mockReset();
});

describe('matrix draft saving with delayed server revalidation', () => {
  it('settles a newly created draft before allowing preview and preserves later preview approval across a background refetch', async () => {
    const detailRefresh = deferred<ReturnType<typeof response<MatrixDetail>>>();
    const listRefresh = deferred<ReturnType<typeof response<ReturnType<typeof list>>>>();
    let stored = emptyMatrix();
    let waitingForSaveRefresh = true;
    rpc.mockImplementation(async (name: string, input: { p_config: MatrixConfig; p_valid_from: string; p_valid_until: string | null }) => {
      if (name === 'hours_get_matrix') {
        if (callsTo(name) === 1) return response(emptyMatrix());
        return waitingForSaveRefresh ? detailRefresh.promise : response(stored);
      }
      if (name === 'hours_list_matrices') {
        if (callsTo(name) === 1) return response(list(emptyMatrix()));
        return waitingForSaveRefresh ? listRefresh.promise : response(list(stored));
      }
      if (name === 'hours_create_matrix_draft') {
        stored = storedDraft(input);
        return response(stored);
      }
      throw new Error(`Unexpected RPC in matrix save race test: ${name}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
    clients.push(queryClient);
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/uren/matrices/${matrixId}`]}>
      <Routes><Route path="/uren/matrices/:matrixId" element={<HoursMatrices />} /></Routes>
    </MemoryRouter></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Nieuwe conceptversie · concept' });
    change('Geldig vanaf', '2026-09-08');
    fireEvent.click(screen.getByRole('button', { name: 'Uurcode toevoegen' }));
    change('Uurcode 1', 'NOR');
    change('Factor 1', '1.00');
    change('Indeling zonder broncategorieën', 'flat');
    change('Vaste uurcode', 'NOR');
    const originalPreview = screen.getByLabelText('Netto-uren voorbeeld');
    const save = screen.getByRole('button', { name: 'Concept opslaan' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    // The mutation response has already put version 1 in the real query cache,
    // but its invalidation is deliberately still waiting on the server.
    await waitFor(() => {
      expect(callsTo('hours_create_matrix_draft')).toBe(1);
      expect(callsTo('hours_get_matrix')).toBe(2);
      expect(callsTo('hours_list_matrices')).toBe(2);
    });
    expect(queryClient.getQueryData<MatrixDetail>(qk.hoursMatrices.detail(orgId, matrixId))?.versions[0]?.id).toBe(versionId);
    expect(screen.getByLabelText('Versie bekijken')).toHaveValue('new');
    expect(screen.getByLabelText('Netto-uren voorbeeld')).toBe(originalPreview);
    expect(screen.getByLabelText('Netto-uren voorbeeld')).toBeDisabled();
    expect(screen.getByLabelText('Geldig vanaf')).toBeDisabled();
    expect(screen.getByLabelText('Versie bekijken')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nieuwe versie' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voorbeeld berekenen' })).toBeDisabled();

    await act(async () => {
      waitingForSaveRefresh = false;
      detailRefresh.resolve(response(stored));
      listRefresh.resolve(response(list(stored)));
    });
    await screen.findByRole('heading', { name: 'Versie 1 · concept' });
    await waitFor(() => expect(screen.getByLabelText('Netto-uren voorbeeld')).toBeEnabled());
    expect(screen.getByLabelText('Netto-uren voorbeeld')).not.toBe(originalPreview);
    const savedPreview = screen.getByLabelText('Netto-uren voorbeeld');
    change('Netto-uren voorbeeld', '8:30');
    fireEvent.click(screen.getByRole('button', { name: 'Voorbeeld berekenen' }));
    expect(await screen.findByText('Voorbeeld sluit aan: 8:30 uur.')).toBeInTheDocument();
    fireEvent.click(confirmation());
    expect(confirmation()).toBeChecked();
    expect(screen.getByRole('button', { name: 'Bevestigen en publiceren' })).toBeEnabled();

    await act(async () => { await queryClient.invalidateQueries({ queryKey: qk.hoursMatrices.all(orgId) }); });
    expect(callsTo('hours_get_matrix')).toBe(3);
    expect(screen.getByLabelText('Netto-uren voorbeeld')).toBe(savedPreview);
    expect(savedPreview).toHaveValue('8:30');
    expect(screen.getByText('Voorbeeld sluit aan: 8:30 uur.')).toBeInTheDocument();
    expect(confirmation()).toBeChecked();
    expect(screen.getByRole('button', { name: 'Bevestigen en publiceren' })).toBeEnabled();
    expect(callsTo('hours_create_matrix_draft')).toBe(1);
    expect(callsTo('hours_publish_matrix_version')).toBe(0);
  });
});
