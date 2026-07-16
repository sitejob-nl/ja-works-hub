import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MatchProposalEmailDialog from '@/components/matches/MatchProposalEmailDialog';
import { DEFAULT_PROPOSAL_PAGE_CONFIG } from '@/lib/proposal-page';

const outlookState = vi.hoisted(() => ({ defaultAccountId: undefined as string | undefined }));

vi.mock('@/hooks/useOrganizationId', () => ({ useOrganizationId: () => 'qa-org' }));
vi.mock('@/hooks/useOutboundPause', () => ({
  useOutboundPause: () => ({ data: { email: true, whatsapp: true } }),
}));
vi.mock('@/hooks/useOutlookAccounts', () => ({
  useOutlookAccounts: () => ({ usableAccounts: [], defaultAccountId: outlookState.defaultAccountId }),
}));
vi.mock('@/hooks/usePermissions', () => ({ useRolePermission: () => true }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'qa-token' } } }) } },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('MatchProposalEmailDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    outlookState.defaultAccountId = undefined;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        to: 'qa@example.com',
        subject: 'QA voorstel',
        intro_text: 'Korte introductie',
        closing_text: 'Bekijk het voorstel.',
        html: '<p>QA preview</p>',
        response_url: '',
        proposal_token_id: 'qa-token-id',
        proposal_page: DEFAULT_PROPOSAL_PAGE_CONFIG,
        recipients: [],
      }),
    }));
  });

  it('bewaart editorwijzigingen als de parent een nieuwe onOpenChange callback doorgeeft', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (onOpenChange: (open: boolean) => void) => (
      <QueryClientProvider client={queryClient}>
        <MatchProposalEmailDialog open matchId="qa-match" onOpenChange={onOpenChange} />
      </QueryClientProvider>
    );

    const { rerender } = render(view(vi.fn()));
    const title = await screen.findByLabelText('Paginatitel');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(title, { target: { value: 'QA voorstel op maat' } });
    expect(title).toHaveValue('QA voorstel op maat');

    rerender(view(vi.fn()));

    await waitFor(() => expect(screen.getByLabelText('Paginatitel')).toHaveValue('QA voorstel op maat'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('bewaart editorwijzigingen wanneer het standaard mailaccount later beschikbaar komt', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = () => (
      <QueryClientProvider client={queryClient}>
        <MatchProposalEmailDialog open matchId="qa-match" onOpenChange={vi.fn()} />
      </QueryClientProvider>
    );

    const { rerender } = render(view());
    const title = await screen.findByLabelText('Paginatitel');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(title, { target: { value: 'QA voorstel blijft behouden' } });
    outlookState.defaultAccountId = 'mail-account-1';
    rerender(view());

    await waitFor(() => expect(screen.getByLabelText('Paginatitel')).toHaveValue('QA voorstel blijft behouden'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('laat een late initiële preview-response geen reeds getypte editorinhoud overschrijven', async () => {
    let resolveJson: (value: Record<string, unknown>) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { resolveJson = resolve; })),
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MatchProposalEmailDialog open matchId="qa-match" onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );

    const title = await screen.findByLabelText('Paginatitel');
    fireEvent.change(title, { target: { value: 'Getypte QA inhoud' } });
    resolveJson({
      to: 'qa@example.com',
      subject: 'QA voorstel',
      intro_text: 'Korte introductie',
      closing_text: 'Bekijk het voorstel.',
      html: '<p>QA preview</p>',
      response_url: '',
      proposal_token_id: 'qa-token-id',
      proposal_page: DEFAULT_PROPOSAL_PAGE_CONFIG,
      recipients: [],
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Paginatitel')).toHaveValue('Getypte QA inhoud'));
    expect(screen.getByRole('button', { name: 'Voorbeeld bijwerken' })).toBeInTheDocument();
  });
});
