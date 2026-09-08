import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdminOrganizations from '@/pages/superadmin/SuperAdminOrganizations';
import { toast } from 'sonner';

const org = '00000000-0000-4000-8000-000000000001';
const label = 'Urenmodule — weekcontrole en matrices';
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  readModules: vi.fn(),
  upsert: vi.fn(),
  superAdmin: { user: { id: 'sa-user-1' }, isSuperAdmin: true, loading: false },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: state.rpc,
    from: (table: string) => {
      if (table === 'subscription_plans') return {
        // Including the new module in the plan must never activate it implicitly.
        select: () => Promise.resolve({ data: [{ id: 'plan-1', name: 'Alle modules', modules: ['uren', 'uren-workflow'] }], error: null }),
      };
      if (table === 'organization_modules') return {
        select: () => ({ eq: (_column: string, organizationId: string) => state.readModules(organizationId) }),
        upsert: state.upsert,
      };
      throw new Error(`Unexpected test query: ${table}`);
    },
  },
}));
vi.mock('@/contexts/SuperAdminContext', () => ({ useSuperAdmin: () => state.superAdmin }));
vi.mock('@/hooks/useAiCredits', () => ({ useAiCreditOrganizationBalances: () => ({ data: [], isError: false }) }));
vi.mock('@/components/settings/AiCreditsPanel', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const clients: QueryClient[] = [];
const organization = {
  id: org, name: 'Testorganisatie', slug: 'testorganisatie', is_active: true, plan_id: 'plan-1', logo_url: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderAdmin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  return { client, ...render(<QueryClientProvider client={client}><SuperAdminOrganizations /></QueryClientProvider>) };
}

async function openModules() {
  fireEvent.click(await screen.findByTitle('Modules beheren'));
  return screen.findByRole('dialog');
}

function hoursSwitch() {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error('Hours module configuration row is missing');
  return within(row).getByRole('switch');
}

beforeEach(() => {
  vi.clearAllMocks();
  state.superAdmin = { user: { id: 'sa-user-1' }, isSuperAdmin: true, loading: false };
  state.readModules.mockResolvedValue({ data: [], error: null });
  state.upsert.mockResolvedValue({ data: null, error: null });
  state.rpc.mockImplementation(async (name: string, args?: { p_organization_id: string; p_enabled: boolean }) => {
    if (name === 'sa_get_organizations') return { data: [organization], error: null };
    if (name === 'sa_set_hours_workflow_enabled' && args) {
      return { data: { organization_id: args.p_organization_id, enabled: args.p_enabled }, error: null };
    }
    throw new Error(`Unexpected test RPC: ${name}`);
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('SaaS administrator hours-module opt-in', () => {
  it('defaults off even when the subscription plan contains the new module', async () => {
    renderAdmin();
    const dialog = await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    const legacyRow = within(dialog).getByText('Uren').parentElement;
    expect(within(legacyRow!).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(state.readModules).toHaveBeenCalledWith(org);
  });

  it.each([true, false])('shows the explicitly stored organization override %s', async (enabled) => {
    state.readModules.mockResolvedValue({ data: [{ organization_id: org, module_name: 'uren-workflow', enabled }], error: null });
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    expect(hoursSwitch()).toHaveAttribute('aria-checked', String(enabled));
  });

  it('accepts a nullable legacy override while the new module still requires an explicit true', async () => {
    state.readModules.mockResolvedValue({
      data: [
        { organization_id: org, module_name: 'uren', enabled: null },
        { organization_id: org, module_name: 'uren-workflow', enabled: null },
      ], error: null,
    });
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Uren' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prevents changes while the current organization modules are still loading', async () => {
    const pending = deferred<{ data: never[]; error: null }>();
    state.readModules.mockImplementation(() => pending.promise);
    renderAdmin();
    await openModules();
    expect(hoursSwitch()).toBeDisabled();
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(hoursSwitch());
    expect(state.rpc).not.toHaveBeenCalledWith('sa_set_hours_workflow_enabled', expect.anything());
    await act(async () => { pending.resolve({ data: [], error: null }); });
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
  });

  it('keeps the switch unavailable if reading the current override fails', async () => {
    state.readModules.mockResolvedValue({ data: null, error: { message: 'Module configuration unavailable' } });
    renderAdmin();
    await openModules();
    await waitFor(() => expect(state.readModules).toHaveBeenCalled());
    await screen.findByRole('button', { name: /Opnieuw proberen/ });
    expect(hoursSwitch()).toBeDisabled();
    fireEvent.click(hoursSwitch());
    expect(state.rpc).not.toHaveBeenCalledWith('sa_set_hours_workflow_enabled', expect.anything());
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [{ organization_id: org, module_name: 'uren-workflow' }],
    [{ organization_id: org, module_name: 'uren-workflow', enabled: 'false' }],
    [{ organization_id: '00000000-0000-4000-8000-000000000002', module_name: 'uren-workflow', enabled: true }],
  ])('does not allow toggling after malformed or cross-organization module data: %j', async (data) => {
    state.readModules.mockResolvedValue({ data, error: null });
    renderAdmin();
    await openModules();
    await screen.findByRole('button', { name: /Opnieuw proberen/ });
    expect(hoursSwitch()).toBeDisabled();
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(hoursSwitch());
    expect(state.rpc).not.toHaveBeenCalledWith('sa_set_hours_workflow_enabled', expect.anything());
  });

  it('sends the dedicated setter and waits for persisted confirmation before showing enabled', async () => {
    const pending = deferred<{ data: { organization_id: string; enabled: boolean }; error: null }>();
    state.rpc.mockImplementation((name: string) => name === 'sa_get_organizations'
      ? Promise.resolve({ data: [organization], error: null }) : pending.promise);
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    fireEvent.click(hoursSwitch());
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('sa_set_hours_workflow_enabled', {
      p_organization_id: org, p_enabled: true,
    }));
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(hoursSwitch()).toBeDisabled();
    expect(state.upsert).not.toHaveBeenCalled();
    state.readModules.mockResolvedValue({ data: [{ organization_id: org, module_name: 'uren-workflow', enabled: true }], error: null });
    await act(async () => { pending.resolve({ data: { organization_id: org, enabled: true }, error: null }); });
    await waitFor(() => expect(hoursSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('preserves the stored off state and shows an error when the setter is refused', async () => {
    state.rpc.mockImplementation(async (name: string) => name === 'sa_get_organizations'
      ? { data: [organization], error: null }
      : { data: null, error: { message: 'Geen SaaS-beheerrechten', code: '42501' } });
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    fireEvent.click(hoursSwitch());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(toast.success).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it('can disable a previously enabled organization through the dedicated setter', async () => {
    state.readModules.mockResolvedValue({ data: [{ organization_id: org, module_name: 'uren-workflow', enabled: true }], error: null });
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toHaveAttribute('aria-checked', 'true'));
    state.readModules.mockResolvedValue({ data: [{ organization_id: org, module_name: 'uren-workflow', enabled: false }], error: null });
    fireEvent.click(hoursSwitch());
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('sa_set_hours_workflow_enabled', {
      p_organization_id: org, p_enabled: false,
    }));
    await waitFor(() => expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false'));
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it('keeps the legacy hours switch on its existing organization-module write path', async () => {
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    const legacySwitch = screen.getByRole('switch', { name: 'Uren' });
    fireEvent.click(legacySwitch);
    await waitFor(() => expect(state.upsert).toHaveBeenCalledWith({
      organization_id: org, module_name: 'uren', enabled: false,
    }, { onConflict: 'organization_id,module_name' }));
    expect(state.rpc).not.toHaveBeenCalledWith('sa_set_hours_workflow_enabled', expect.anything());
  });

  it.each([
    { organization_id: '00000000-0000-4000-8000-000000000002', enabled: true },
    { organization_id: org, enabled: false },
    { organization_id: org, enabled: 'true' },
  ])('rejects an inconsistent setter confirmation: %j', async (data) => {
    state.rpc.mockImplementation(async (name: string) => name === 'sa_get_organizations'
      ? { data: [organization], error: null } : { data, error: null });
    renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    fireEvent.click(hoursSwitch());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(hoursSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('disables changes immediately when SaaS authentication starts refreshing', async () => {
    const { rerender, client } = renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    state.superAdmin = { ...state.superAdmin, loading: true };
    rerender(<QueryClientProvider client={client}><SuperAdminOrganizations /></QueryClientProvider>);
    expect(hoursSwitch()).toBeDisabled();
    fireEvent.click(hoursSwitch());
    expect(state.rpc).not.toHaveBeenCalledWith('sa_set_hours_workflow_enabled', expect.anything());
  });

  it('withholds previous permissions after the SaaS administrator identity changes', async () => {
    const { rerender, client } = renderAdmin();
    await openModules();
    await waitFor(() => expect(hoursSwitch()).toBeEnabled());
    state.readModules.mockImplementation(() => new Promise(() => {}));
    state.superAdmin = { ...state.superAdmin, user: { id: 'sa-user-2' } };
    rerender(<QueryClientProvider client={client}><SuperAdminOrganizations /></QueryClientProvider>);
    expect(hoursSwitch()).toBeDisabled();
    fireEvent.click(hoursSwitch());
    expect(state.rpc).not.toHaveBeenCalledWith('sa_set_hours_workflow_enabled', expect.anything());
  });
});
