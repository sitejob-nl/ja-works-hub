import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PersonalOutlook from '@/pages/PersonalOutlook';
import { invokeOutlookFunction, useOutlookAccounts } from '@/hooks/useOutlookAccounts';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user-1',
      email: 'backoffice@example.com',
      role: 'backoffice',
      organization_id: 'org-1',
    },
  }),
}));

vi.mock('@/hooks/usePublicUrl', () => ({
  usePublicUrl: () => ({ buildUrl: (path: string) => `https://hub.example.com${path}` }),
}));

vi.mock('@/hooks/useOutlookAccounts', () => ({
  invokeOutlookFunction: vi.fn(),
  useOutlookAccounts: vi.fn(),
}));

const accountsMock = vi.mocked(useOutlookAccounts);
const invokeMock = vi.mocked(invokeOutlookFunction);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/mijn-outlook']}>
        <PersonalOutlook />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonalOutlook', () => {
  beforeEach(() => {
    accountsMock.mockReturnValue({
      accounts: [],
      isLoading: false,
    } as any);
    invokeMock.mockReset();
  });

  it('laat een backofficegebruiker zonder instellingenrecht de eigen Outlook koppelen', async () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Persoonlijke Outlook koppelen' }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('outlook-start', {
      scope: 'personal',
      return_to: 'https://hub.example.com/mijn-outlook',
      force_consent: false,
      login_hint: 'backoffice@example.com',
    }));
  });

  it('toont een bestaande persoonlijke koppeling en biedt herkoppelen aan', () => {
    accountsMock.mockReturnValue({
      accounts: [{
        scope: 'personal',
        email: 'backoffice@example.com',
        microsoft_access_ok: true,
      }],
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('Gekoppeld')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Persoonlijke Outlook herkoppelen' })).toBeInTheDocument();
  });
});
