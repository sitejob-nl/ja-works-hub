import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VehicleAssignmentsTab from '@/components/transport/tabs/VehicleAssignmentsTab';
import EmployeeTransportTab from '@/components/employees/tabs/EmployeeTransportTab';

const db = vi.hoisted(() => ({
  assignments: [] as any[], inserted: vi.fn(), deleted: vi.fn(), sync: vi.fn(), dispatch: vi.fn(),
}));
vi.mock('@/hooks/useOrganizationId', () => ({ useOrganizationId: () => 'qa-org' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'qa-user' }, role: 'admin' }), useHasRole: () => true,
}));
vi.mock('@/lib/assignments', async (original) => ({
  ...await original<any>(), resolveEmployeeId: async () => 'qa-employee',
  syncVehicleStatus: (...args: unknown[]) => db.sync(...args),
  deleteVehicleAssignment: (...args: unknown[]) => db.deleted(...args),
}));
vi.mock('@/lib/regulation-dispatch', () => ({ sendRegulationsForAssignment: (...args: unknown[]) => db.dispatch(...args) }));
vi.mock('@/components/shared/RegulationStatus', () => ({ default: () => null }));
vi.mock('@/components/ui/entity-link', () => ({ EntityLink: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandInput: () => <input aria-label="Zoek medewerker" />,
  CommandItem: ({ children, onSelect }: any) => <button onClick={onSelect}>{children}</button>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => {
    let inserting = false;
    const query: any = {};
    for (const name of ['select', 'eq', 'order', 'is', 'limit', 'or', 'in', 'single']) query[name] = () => query;
    query.insert = (payload: unknown) => { inserting = true; db.inserted(payload); return query; };
    query.then = (resolve: any, reject: any) => Promise.resolve({ error: null, data: inserting ? { id: 'inserted' }
      : table === 'vehicle_assignments' ? db.assignments
      : table === 'candidates' ? [{ id: 'qa-candidate', first_name: 'Test', last_name: 'Bestuurder', has_drivers_license: true }]
      : [] }).then(resolve, reject);
    return query;
  } },
}));

const vehicle = { id: 'vehicle-a', license_plate: '2-TLH-29', current_mileage: 1000 };
const current = { id: 'current', vehicle_id: vehicle.id, assigned_date: '2020-06-01', returned_date: null, vehicles: vehicle };
const past = { id: 'past', vehicle_id: vehicle.id, assigned_date: '2020-01-01', returned_date: '2020-05-01', vehicles: vehicle };

const mount = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>,
);
beforeEach(() => { vi.clearAllMocks(); db.assignments = [current]; });

describe('historische autotoewijzing', () => {
  it('laat een oude afgesloten periode toe en weigert overlap met de huidige bestuurder', async () => {
    mount(<VehicleAssignmentsTab vehicle={vehicle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voertuig toewijzen' }));
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Test Bestuurder' }));
    const start = screen.getByLabelText('Startdatum *');
    const end = screen.getByLabelText('Inleverdatum (leeg = nog niet bekend)');
    fireEvent.change(start, { target: { value: '2020-01-01' } });
    expect(start).not.toHaveAttribute('min');
    expect(screen.getByRole('button', { name: 'Toewijzen' })).toBeDisabled();
    fireEvent.change(end, { target: { value: '2020-05-01' } });
    const save = screen.getByRole('button', { name: 'Toewijzen' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(db.inserted).toHaveBeenCalledWith(expect.objectContaining({
      assigned_date: '2020-01-01', returned_date: '2020-05-01', candidate_id: 'qa-candidate',
    })));
    await waitFor(() => expect(db.sync).toHaveBeenCalledWith('qa-org', vehicle.id));
    expect(db.dispatch).not.toHaveBeenCalled();
  });

  it('kan ook vanuit een medewerker met een huidige auto een eerdere periode toevoegen', async () => {
    mount(<EmployeeTransportTab candidateId="qa-candidate" />);
    await screen.findByText('2-TLH-29');
    fireEvent.click(screen.getByRole('button', { name: 'Voertuig toewijzen' }));
    const start = screen.getByLabelText('Toewijsdatum *');
    fireEvent.change(start, { target: { value: '2020-01-01' } });
    expect(start).toHaveValue('2020-01-01');
    expect(start).not.toHaveAttribute('min');
  });
});

describe('verwijderen vanuit medewerkersdossier', () => {
  it('vraagt bevestiging en verwijdert de geselecteerde historische toewijzing', async () => {
    db.assignments = [past];
    mount(<EmployeeTransportTab candidateId="qa-candidate" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Toewijzing verwijderen' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/permanent/)).toBeVisible();
    expect(db.deleted).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verwijderen' }));
    await waitFor(() => expect(db.deleted).toHaveBeenCalledWith({ organizationId: 'qa-org', assignment: past }));
  });
  it('behoudt de bestaande inlevervoorwaarde voor een lopende toewijzing', async () => {
    mount(<EmployeeTransportTab candidateId="qa-candidate" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Toewijzing verwijderen' }));
    expect(screen.getByText(/Eerst inleveren/)).toBeVisible();
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verwijderen' })).toBeDisabled();
    expect(db.deleted).not.toHaveBeenCalled();
  });
});
