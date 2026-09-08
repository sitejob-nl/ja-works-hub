import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import PortalLogin from '@/pages/portal/PortalLogin';
import { PortalProvider, usePortal } from '@/contexts/PortalContext';
import { getPortalLoginPath } from '@/lib/portal-return-path';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  signOutAndRedirect: vi.fn(),
  forgotPassword: vi.fn(),
  profile: { role: 'medewerker', is_active: true },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signIn,
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mocks.profile }),
          maybeSingle: async () => ({
            data: table === 'profiles' ? mocks.profile : { id: 'candidate-1' },
          }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'nl' }) }));
vi.mock('@/hooks/useSessionIdleTimeout', () => ({ useSessionIdleTimeout: vi.fn() }));
vi.mock('@/lib/session-security', () => ({ signOutAndRedirect: mocks.signOutAndRedirect }));
vi.mock('@/components/translation/LanguageToggle', () => ({ LanguageToggle: () => null }));
vi.mock('@/components/auth/ForgotPasswordDialog', () => ({
  ForgotPasswordDialog: (props: unknown) => {
    mocks.forgotPassword(props);
    return <button>Wachtwoord vergeten</button>;
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function PortalActions() {
  const navigate = useNavigate();
  const { signOut } = usePortal();
  return (
    <>
      <button onClick={() => navigate('/portaal/uren/week/next-week?revision=2')}>Andere week</button>
      <button onClick={signOut}>Uitloggen</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = { role: 'medewerker', is_active: true };
  mocks.signIn.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
});

function renderLogin(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/portaal/login" element={<PortalLogin />} />
        <Route path="*" element={<div>Bestemming</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function submitLogin() {
  fireEvent.change(screen.getByLabelText('E-mailadres'), { target: { value: 'medewerker@example.test' } });
  fireEvent.change(screen.getByLabelText('Wachtwoord'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Inloggen' }));
  await screen.findByText('Bestemming');
}

describe('portal login return navigation', () => {
  it('returns an employee to the requested week and query after login', async () => {
    renderLogin(getPortalLoginPath('/portaal/uren/week/week-id', '?revision=3&week=2026-12-28'));
    await submitLogin();
    expect(screen.getByTestId('location')).toHaveTextContent('/portaal/uren/week/week-id?revision=3&week=2026-12-28');
  });

  it('falls back to the portal dashboard for an external return URL', async () => {
    renderLogin(`/portaal/login?${new URLSearchParams({ returnTo: '//example.com' })}`);
    await submitLogin();
    expect(screen.getByTestId('location').textContent).toBe('/portaal');
  });

  it('keeps the non-employee destination unchanged', async () => {
    mocks.profile.role = 'admin';
    renderLogin(getPortalLoginPath('/portaal/uren/weken'));
    await submitLogin();
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  it('keeps password recovery in the employee zone with the entered email', () => {
    renderLogin(getPortalLoginPath('/portaal/uren/weken'));
    fireEvent.change(screen.getByLabelText('E-mailadres'), { target: { value: 'medewerker@example.test' } });
    expect(mocks.forgotPassword).toHaveBeenLastCalledWith({
      zone: 'portaal', defaultEmail: 'medewerker@example.test', language: 'nl',
    });
  });

  it('preserves the unauthenticated deep link when the portal provider redirects', async () => {
    const path = '/portaal/uren/week/week-id?revision=2&week=2026-12-28';
    render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <PortalProvider><div>Portaal</div></PortalProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(
      getPortalLoginPath('/portaal/uren/week/week-id', '?revision=2&week=2026-12-28'),
    ));
  });

  it('uses the latest portal location without re-subscribing the session listener', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    render(
      <MemoryRouter initialEntries={['/portaal/uren/weken']}>
        <LocationProbe />
        <PortalProvider><PortalActions /></PortalProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Andere week' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/portaal/uren/week/next-week?revision=2'));
    expect(mocks.onAuthStateChange).toHaveBeenCalledTimes(1);
    const listener = mocks.onAuthStateChange.mock.calls[0][0];
    await act(async () => { await listener('TOKEN_REFRESHED', null); });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(
      getPortalLoginPath('/portaal/uren/week/next-week', '?revision=2'),
    ));
  });

  it('keeps explicit logout on the plain login page', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    render(
      <MemoryRouter initialEntries={['/portaal/uren/week/week-id?revision=2']}>
        <PortalProvider><PortalActions /></PortalProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Uitloggen' }));
    expect(mocks.signOutAndRedirect).toHaveBeenCalledWith('/portaal/login');
  });
});
