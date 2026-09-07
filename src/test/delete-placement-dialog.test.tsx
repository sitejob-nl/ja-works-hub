import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeletePlacementDialog, { type DeletePlacementTarget } from '@/components/placements/DeletePlacementDialog';
import { logAudit } from '@/lib/audit';
import { toast } from 'sonner';

/**
 * Onjuiste of testplaatsing verwijderen. De dialoog telt vooraf wat er aan de
 * plaatsing hangt; alleen een lege plaatsing mag weg. De database blijft de
 * laatste grendel, maar de gebruiker hoort hier al te lezen wát er in de weg
 * staat en dat beëindigen dan het pad is.
 */
const state = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  deleted: [] as string[],
  deleteResult: { data: [{ id: 'p1' }] as { id: string }[] | null, error: null as unknown },
  role: 'admin' as string,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => Promise.resolve({ count: state.counts[table] ?? 0, data: null, error: null }),
      }),
      delete: () => ({
        eq: (_column: string, id: string) => ({
          select: () => {
            state.deleted.push(id);
            return Promise.resolve(state.deleteResult);
          },
        }),
      }),
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ role: state.role }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const target: DeletePlacementTarget = {
  id: 'p1',
  function_name: 'Lasser',
  start_date: '2026-09-01',
  end_date: null,
  expected_end_date: '2026-09-30',
  candidateName: 'Jan Kowalski',
  companyName: 'Acme Metaal',
  row: {
    id: 'p1',
    function_name: 'Lasser',
    status: 'gepland',
    companies: { id: 'c1', name: 'Acme Metaal' },
    candidates: { id: 'k1', first_name: 'Jan' },
  },
};

function renderDialog(props: Partial<React.ComponentProps<typeof DeletePlacementDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <DeletePlacementDialog open placement={target} onOpenChange={onOpenChange} onDeleted={onDeleted} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onDeleted };
}

describe('DeletePlacementDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.counts = {};
    state.deleted = [];
    state.deleteResult = { data: [{ id: 'p1' }], error: null };
    state.role = 'admin';
  });

  it('noemt kandidaat, opdrachtgever en periode in de bevestiging', async () => {
    renderDialog();
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog).toHaveTextContent('Er hangen geen uren'));
    expect(dialog).toHaveTextContent('Jan Kowalski');
    expect(dialog).toHaveTextContent('Acme Metaal');
    expect(dialog).toHaveTextContent('01-09-2026 t/m 30-09-2026');
  });

  it('verwijdert een lege plaatsing en legt een auditregel vast met de oude waarden', async () => {
    const { onOpenChange, onDeleted } = renderDialog();
    const confirm = await screen.findByRole('button', { name: 'Verwijderen' });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    await waitFor(() => expect(state.deleted).toEqual(['p1']));
    await waitFor(() => expect(logAudit).toHaveBeenCalledTimes(1));
    const audit = vi.mocked(logAudit).mock.calls[0][0];
    expect(audit).toMatchObject({ action: 'delete', tableName: 'placements', recordId: 'p1' });
    expect(audit.oldValues).toMatchObject({ id: 'p1', function_name: 'Lasser', status: 'gepland' });
    // Gejoinde relaties horen niet in old_values.
    expect(audit.oldValues).not.toHaveProperty('companies');
    expect(audit.oldValues).not.toHaveProperty('candidates');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Plaatsing verwijderd');
  });

  it('blokkeert verwijderen en legt uit wat er in de weg staat en dat beëindigen het pad is', async () => {
    state.counts = { timesheets: 2, invoice_lines: 1 };
    renderDialog();

    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog).toHaveTextContent('2 urenregistraties'));
    expect(dialog).toHaveTextContent('1 factuurregel');
    // Alleen wat er écht hangt staat in de lijst; de generieke uitleg noemt alle vier de soorten.
    expect(dialog).not.toHaveTextContent(/\d+ urenbrie/);
    expect(dialog).not.toHaveTextContent(/\d+ ziekmelding/);
    expect(dialog).toHaveTextContent('Beëindigen');

    const confirm = screen.getByRole('button', { name: 'Verwijderen' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(state.deleted).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('houdt bevestigen geblokkeerd zolang de telling nog niet binnen is', () => {
    // Direct na openen, vóór de counts binnen zijn: nooit "veilig" aannemen.
    renderDialog();
    expect(screen.getByRole('button', { name: 'Verwijderen' })).toBeDisabled();
  });

  it('weigert zonder beheerdersrol en laat de dialoog open met een toast', async () => {
    state.role = 'intercedent';
    const { onOpenChange } = renderDialog();
    const confirm = await screen.findByRole('button', { name: 'Verwijderen' });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('beheerder');
    expect(state.deleted).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('meldt een stil geweigerde delete (0 rijen) in plaats van succes', async () => {
    state.deleteResult = { data: [], error: null };
    const { onDeleted } = renderDialog();
    const confirm = await screen.findByRole('button', { name: 'Verwijderen' });
    await waitFor(() => expect(confirm).toBeEnabled());

    fireEvent.click(confirm);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('beheerdersrechten');
    expect(logAudit).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
