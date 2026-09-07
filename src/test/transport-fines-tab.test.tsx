import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import TransportFinesTab from '@/components/transport/TransportFinesTab';
import VehicleFinesTab from '@/components/transport/tabs/VehicleFinesTab';
import { logAudit } from '@/lib/audit';

/**
 * Boetes op het transportoverzicht en op het voertuig-tabblad. Pint de twee
 * acceptatiecriteria vast die eerder misgingen: de betaalstatus verspringt
 * niet meer bij de eerste klik, en verwijderen raakt eerst de rij en pas
 * daarna de foto's — bij een stil geweigerde delete blijven de foto's staan.
 */
const db = vi.hoisted(() => ({
  fines: [] as any[],
  deletedRows: [] as { id: string }[],
  /** Volgorde van de schrijfacties, om "eerst de rij, dan de foto's" te bewijzen. */
  calls: [] as string[],
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/hooks/useOrganizationId', () => ({ useOrganizationId: () => 'qa-org' }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => {
  // Ketenbare nep-builder: elke querymethode geeft zichzelf terug, `then` levert het resultaat.
  const chain = (result: () => unknown) => {
    const builder: any = {};
    for (const method of ['select', 'order', 'eq']) builder[method] = vi.fn(() => builder);
    builder.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return builder;
  };
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => chain(() => ({ data: db.fines, error: null }))),
        update: vi.fn((payload: unknown) => {
          db.calls.push('update');
          db.update(payload);
          return chain(() => ({ data: null, error: null }));
        }),
        delete: vi.fn(() => {
          db.calls.push('delete');
          return chain(() => ({ data: db.deletedRows, error: null }));
        }),
      })),
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })),
          remove: vi.fn(async (paths: string[]) => {
            db.calls.push('remove');
            db.remove(paths);
            return { data: null, error: null };
          }),
        })),
      },
    },
  };
});

const fine = {
  id: 'fine-1',
  vehicle_id: 'veh-1',
  employee_id: null,
  candidate_id: null,
  fine_date: '2026-05-12',
  due_date: null,
  amount: 95,
  reference_number: 'CJIB-123',
  description: 'Te hard gereden',
  notes: null,
  paid: false,
  paid_at: null,
  photos: ['qa-org/vehicle-fines/veh-1/foto.jpg'],
  vehicles: { id: 'veh-1', license_plate: 'AB-123-C', brand: 'Ford', model: 'Transit' },
  candidates: null,
  employees: null,
};

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  db.fines = [fine];
  db.deletedRows = [{ id: fine.id }];
  db.calls = [];
});

describe('TransportFinesTab: betaalstatus', () => {
  it('verspringt niet bij de eerste klik — eerst een bevestiging met kenteken, bedrag en datum', async () => {
    renderWithProviders(<TransportFinesTab />);

    fireEvent.click(await screen.findByText('Niet betaald'));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Markeren als betaald?')).toBeInTheDocument();
    expect(within(dialog).getByText(/12-05-2026/)).toBeInTheDocument();
    expect(within(dialog).getByText(/AB-123-C/)).toBeInTheDocument();
    expect(within(dialog).getByText(/95,00/)).toBeInTheDocument();
    expect(db.update).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Markeren als betaald' }));

    await waitFor(() => expect(db.update).toHaveBeenCalledWith({ paid: true, paid_at: expect.any(String) }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Betaalstatus bijgewerkt'));
  });

  it('laat de status staan bij annuleren', async () => {
    renderWithProviders(<TransportFinesTab />);

    fireEvent.click(await screen.findByText('Niet betaald'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuleren' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(db.update).not.toHaveBeenCalled();
  });

});

describe('TransportFinesTab: verwijderen', () => {
  it('vraagt bevestiging met kenteken, bedrag en datum, verwijdert eerst de rij en dan de foto, en logt de oude waarden', async () => {
    renderWithProviders(<TransportFinesTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verwijderen' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Boete verwijderen?')).toBeInTheDocument();
    const description = within(dialog).getByText(/Verwijdert de boete van/);
    expect(description).toHaveTextContent('12-05-2026');
    expect(description).toHaveTextContent('AB-123-C');
    expect(description).toHaveTextContent('95,00');
    expect(description).toHaveTextContent('inclusief 1 bijlage');
    expect(db.calls).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Verwijderen' }));

    await waitFor(() => expect(db.calls).toEqual(['delete', 'remove']));
    expect(db.remove).toHaveBeenCalledWith(['qa-org/vehicle-fines/veh-1/foto.jpg']);
    await waitFor(() =>
      expect(logAudit).toHaveBeenCalledWith({
        action: 'delete',
        tableName: 'vehicle_fines',
        recordId: 'fine-1',
        oldValues: expect.objectContaining({
          license_plate: 'AB-123-C',
          amount: 95,
          fine_date: '2026-05-12',
          reference_number: 'CJIB-123',
          photos: ['qa-org/vehicle-fines/veh-1/foto.jpg'],
        }),
      }),
    );
    expect(vi.mocked(logAudit).mock.calls[0][0].oldValues).not.toHaveProperty('vehicles');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Boete verwijderd'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('laat de foto staan en meldt een fout wanneer de delete stil 0 rijen raakt (RLS)', async () => {
    db.deletedRows = [];
    renderWithProviders(<TransportFinesTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verwijderen' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verwijderen' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(db.calls).toEqual(['delete']);
    expect(db.remove).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('doet niets bij annuleren', async () => {
    renderWithProviders(<TransportFinesTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verwijderen' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuleren' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(db.calls).toEqual([]);
  });
});

describe('VehicleFinesTab: betaalstatus gedraagt zich hetzelfde als het overzicht', () => {
  it('vraagt eerst bevestiging, met het kenteken van het voertuig', async () => {
    db.fines = [{ ...fine, vehicles: undefined }];
    renderWithProviders(<VehicleFinesTab vehicle={{ id: 'veh-1', license_plate: 'AB-123-C' }} />);

    fireEvent.click(await screen.findByText('Niet betaald'));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Markeren als betaald?')).toBeInTheDocument();
    expect(within(dialog).getByText(/AB-123-C/)).toBeInTheDocument();
    expect(db.update).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Markeren als betaald' }));

    await waitFor(() => expect(db.update).toHaveBeenCalledWith({ paid: true, paid_at: expect.any(String) }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('wist de betaaldatum wanneer een betaalde boete terug naar niet betaald gaat', async () => {
    db.fines = [{ ...fine, vehicles: undefined, paid: true, paid_at: '2026-06-02T10:00:00Z' }];
    renderWithProviders(<VehicleFinesTab vehicle={{ id: 'veh-1', license_plate: 'AB-123-C' }} />);

    // 'Betaald' staat ook als kolomkop; de klikbare badge is de enige met cursor-pointer.
    fireEvent.click(await screen.findByText('Betaald', { selector: '.cursor-pointer' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Markeren als niet betaald?')).toBeInTheDocument();
    expect(within(dialog).getByText(/de betaaldatum wordt gewist/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Markeren als niet betaald' }));

    await waitFor(() => expect(db.update).toHaveBeenCalledWith({ paid: false, paid_at: null }));
  });
});
