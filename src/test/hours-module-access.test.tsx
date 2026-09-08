import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoursModuleGate, InternalHoursModuleRoute, PortalHoursModuleRoute } from '@/components/hours-workflow/HoursModuleRoute';
import { useHoursModuleAccess, type HoursModuleActor } from '@/hooks/useHoursModuleAccess';

const { rpc, nestedQuery, useAuth, usePortal } = vi.hoisted(() => ({
  rpc: vi.fn(), nestedQuery: vi.fn(), useAuth: vi.fn(), usePortal: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth }));
vi.mock('@/contexts/PortalContext', () => ({ usePortal }));

const org = '00000000-0000-4000-8000-000000000001';
const otherOrg = '00000000-0000-4000-8000-000000000002';
const actor: HoursModuleActor = { organizationId: org, userId: 'actor-1', zone: 'internal' };
const access = (enabled: boolean, organizationId: string | null = org) => ({
  data: { organization_id: organizationId, enabled }, error: null,
});
const clients: QueryClient[] = [];

function queryContext() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function ProtectedChild() {
  useQuery({ queryKey: ['protected-hours-data'], queryFn: nestedQuery });
  return <p>Beschermde weekgegevens</p>;
}

function renderGate(value: HoursModuleActor = actor) {
  const { wrapper } = queryContext();
  return render(
    <MemoryRouter initialEntries={[value.zone === 'portal' ? '/portaal/uren/week/week-1' : '/uren/weken/week-1']}>
      <Routes>
        <Route path="/uren" element={<p>Bestaande urenpagina</p>} />
        <Route path="/portaal/uren" element={<p>Bestaande portaaluren</p>} />
        <Route path="*" element={<HoursModuleGate actor={value}><ProtectedChild /></HoursModuleGate>} />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue(access(false));
  nestedQuery.mockResolvedValue([]);
  useAuth.mockReturnValue({ profile: { id: actor.userId, organization_id: org }, user: { id: actor.userId }, loading: false });
  usePortal.mockReturnValue({ profile: { id: actor.userId, organization_id: org }, session: { user: { id: actor.userId } }, loading: false });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('urenmodule access with authenticated organization scope', () => {
  it('enables only after a successful server response for the current organization', async () => {
    rpc.mockResolvedValue(access(true));
    const { result } = renderHook(() => useHoursModuleAccess(actor), { wrapper: queryContext().wrapper });
    expect(result.current.enabled).toBe(false);
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(rpc).toHaveBeenCalledWith('hours_get_module_access');
  });

  it.each([false, true])('does not open while authentication is loading, even when server would allow %s', async (enabled) => {
    rpc.mockResolvedValue(access(enabled));
    const { result } = renderHook(() => useHoursModuleAccess({ ...actor, loading: true }), { wrapper: queryContext().wrapper });
    expect(result.current.enabled).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { organizationId: null },
    { organizationId: undefined },
    { userId: null },
    { userId: undefined },
  ])('does not request access with an incomplete actor: %j', (missing) => {
    const { result } = renderHook(() => useHoursModuleAccess({ ...actor, ...missing }), { wrapper: queryContext().wrapper });
    expect(result.current.enabled).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { organization_id: org, enabled: false },
    { organization_id: null, enabled: false },
  ])('keeps a server-denied or absent organization disabled: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const { result } = renderHook(() => useHoursModuleAccess(actor), { wrapper: queryContext().wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it.each([
    null,
    {},
    { organization_id: org },
    { organization_id: org, enabled: 'true' },
    { organization_id: org, enabled: 1 },
    { organization_id: org, enabled: true, unexpected: 'value' },
  ])('fails closed for malformed server data: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const { result } = renderHook(() => useHoursModuleAccess(actor), { wrapper: queryContext().wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.enabled).toBe(false);
  });

  it('rejects an enabled response belonging to another organization', async () => {
    rpc.mockResolvedValue(access(true, otherOrg));
    const { result } = renderHook(() => useHoursModuleAccess(actor), { wrapper: queryContext().wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.enabled).toBe(false);
  });

  it('does not keep previously granted access after a failed refresh', async () => {
    rpc.mockResolvedValueOnce(access(true));
    const { result } = renderHook(() => useHoursModuleAccess(actor), { wrapper: queryContext().wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    rpc.mockResolvedValue({ data: null, error: { message: 'Access could not be checked', code: '42501' } });
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.enabled).toBe(false);
  });

  it('immediately withholds cached access when authentication starts changing', async () => {
    rpc.mockResolvedValue(access(true));
    const { result, rerender } = renderHook((value: HoursModuleActor) => useHoursModuleAccess(value), {
      wrapper: queryContext().wrapper, initialProps: actor,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    rerender({ ...actor, loading: true });
    expect(result.current.enabled).toBe(false);
  });

  it('rechecks a previous grant after authentication finishes refreshing for the same user', async () => {
    rpc.mockResolvedValueOnce(access(true));
    const { result, rerender } = renderHook((value: HoursModuleActor) => useHoursModuleAccess(value), {
      wrapper: queryContext().wrapper, initialProps: actor,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    rerender({ ...actor, loading: true });
    const pending = deferred<ReturnType<typeof access>>();
    rpc.mockImplementation(() => pending.promise);
    rerender({ ...actor, loading: false });
    expect(result.current.enabled).toBe(false);
    await act(async () => { pending.resolve(access(false)); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it.each([
    { ...actor, organizationId: otherOrg },
    { ...actor, userId: 'actor-2' },
    { ...actor, zone: 'portal' as const },
  ])('does not reuse granted access for a changed actor or auth zone: %j', async (nextActor) => {
    rpc.mockResolvedValueOnce(access(true));
    const pending = deferred<ReturnType<typeof access>>();
    rpc.mockImplementationOnce(() => pending.promise);
    const { result, rerender } = renderHook((value: HoursModuleActor) => useHoursModuleAccess(value), {
      wrapper: queryContext().wrapper, initialProps: actor,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    rerender(nextActor);
    expect(result.current.enabled).toBe(false);
    expect(result.current.isLoading).toBe(true);
    await act(async () => { pending.resolve(access(false, nextActor.organizationId)); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it('checks current server access again before reopening a previously cached route', async () => {
    const { client, wrapper } = queryContext();
    client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    rpc.mockResolvedValueOnce(access(true));
    const first = renderHook(() => useHoursModuleAccess(actor), { wrapper });
    await waitFor(() => expect(first.result.current.enabled).toBe(true));
    first.unmount();
    const pending = deferred<ReturnType<typeof access>>();
    rpc.mockImplementation(() => pending.promise);
    const next = renderHook(() => useHoursModuleAccess(actor), { wrapper });
    expect(next.result.current.enabled).toBe(false);
    await act(async () => { pending.resolve(access(false)); });
    await waitFor(() => expect(next.result.current.isLoading).toBe(false));
    expect(next.result.current.enabled).toBe(false);
  });

  it('revalidates a cached organization when switching away and returning', async () => {
    const { client, wrapper } = queryContext();
    client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    rpc.mockResolvedValueOnce(access(true)).mockResolvedValueOnce(access(false, otherOrg));
    const { result, rerender } = renderHook((value: HoursModuleActor) => useHoursModuleAccess(value), {
      wrapper, initialProps: actor,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    rerender({ ...actor, organizationId: otherOrg });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
    const pending = deferred<ReturnType<typeof access>>();
    rpc.mockImplementation(() => pending.promise);
    rerender(actor);
    expect(result.current.enabled).toBe(false);
    await act(async () => { pending.resolve(access(false)); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });
});

describe('urenmodule route gate', () => {
  it('does not mount child queries before access is known', () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    renderGate();
    expect(screen.queryByText('Beschermde weekgegevens')).not.toBeInTheDocument();
    expect(nestedQuery).not.toHaveBeenCalled();
    expect(screen.queryByText('Bestaande urenpagina')).not.toBeInTheDocument();
  });

  it.each([
    ['internal', 'Bestaande urenpagina'],
    ['portal', 'Bestaande portaaluren'],
  ] as const)('redirects a disabled %s deep link to legacy hours without mounting child queries', async (zone, legacyPage) => {
    renderGate({ ...actor, zone });
    expect(await screen.findByText(legacyPage)).toBeInTheDocument();
    expect(screen.queryByText('Beschermde weekgegevens')).not.toBeInTheDocument();
    expect(nestedQuery).not.toHaveBeenCalled();
  });

  it('opens the child only after confirmed access', async () => {
    rpc.mockResolvedValue(access(true));
    renderGate();
    expect(await screen.findByText('Beschermde weekgegevens')).toBeInTheDocument();
    await waitFor(() => expect(nestedQuery).toHaveBeenCalledTimes(1));
  });

  it('keeps nested queries unmounted when reopening a route with an old cached grant', async () => {
    const { wrapper, client } = queryContext();
    client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    rpc.mockResolvedValueOnce(access(true));
    const previous = renderHook(() => useHoursModuleAccess(actor), { wrapper });
    await waitFor(() => expect(previous.result.current.enabled).toBe(true));
    previous.unmount();
    rpc.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><HoursModuleGate actor={actor}><ProtectedChild /></HoursModuleGate></MemoryRouter>, { wrapper });
    expect(screen.queryByText('Beschermde weekgegevens')).not.toBeInTheDocument();
    expect(nestedQuery).not.toHaveBeenCalled();
  });

  it('shows a retry on a read error while protecting nested queries', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'Network unavailable' } });
    renderGate();
    const retry = await screen.findByRole('button', { name: /Opnieuw proberen/ });
    expect(nestedQuery).not.toHaveBeenCalled();
    rpc.mockResolvedValue(access(true));
    fireEvent.click(retry);
    expect(await screen.findByText('Beschermde weekgegevens')).toBeInTheDocument();
    await waitFor(() => expect(nestedQuery).toHaveBeenCalledTimes(1));
  });
});

describe('urenmodule authentication-zone adapters', () => {
  function renderAdapter(zone: 'internal' | 'portal') {
    const Adapter = zone === 'internal' ? InternalHoursModuleRoute : PortalHoursModuleRoute;
    return render(
      <MemoryRouter initialEntries={[zone === 'internal' ? '/uren/weken/week-1' : '/portaal/uren/week/week-1']}>
        <Routes>
          <Route path="/uren" element={<p>Bestaande urenpagina</p>} />
          <Route path="/portaal/uren" element={<p>Bestaande portaaluren</p>} />
          <Route path="*" element={<Adapter><ProtectedChild /></Adapter>} />
        </Routes>
      </MemoryRouter>,
      { wrapper: queryContext().wrapper },
    );
  }

  it('rejects a stale internal profile that does not belong to the active user', async () => {
    useAuth.mockReturnValue({ profile: { id: 'old-user', organization_id: org }, user: { id: actor.userId }, loading: false });
    renderAdapter('internal');
    expect(await screen.findByText('Bestaande urenpagina')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(nestedQuery).not.toHaveBeenCalled();
  });

  it('rejects a stale portal profile that does not belong to the current session', async () => {
    usePortal.mockReturnValue({ profile: { id: 'old-user', organization_id: org }, session: { user: { id: actor.userId } }, loading: false });
    renderAdapter('portal');
    expect(await screen.findByText('Bestaande portaaluren')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(nestedQuery).not.toHaveBeenCalled();
    expect(useAuth).not.toHaveBeenCalled();
  });

  it('uses the matched internal identity before mounting the protected screen', async () => {
    rpc.mockResolvedValue(access(true));
    renderAdapter('internal');
    expect(await screen.findByText('Beschermde weekgegevens')).toBeInTheDocument();
    expect(usePortal).not.toHaveBeenCalled();
  });

  it('uses portal identity without depending on the main-app authentication context', async () => {
    rpc.mockResolvedValue(access(true));
    useAuth.mockImplementation(() => { throw new Error('Portal must not use the main-app auth provider'); });
    renderAdapter('portal');
    expect(await screen.findByText('Beschermde weekgegevens')).toBeInTheDocument();
    expect(useAuth).not.toHaveBeenCalled();
  });
});
