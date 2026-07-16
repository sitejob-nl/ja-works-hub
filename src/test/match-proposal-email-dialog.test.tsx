import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MatchProposalEmailDialog from '@/components/matches/MatchProposalEmailDialog';
import { DEFAULT_PROPOSAL_PAGE_CONFIG } from '@/lib/proposal-page';

vi.mock('@/hooks/useOrganizationId', () => ({ useOrganizationId: () => 'qa-org' }));
vi.mock('@/hooks/useOutboundPause', () => ({
  useOutboundPause: () => ({ data: { email: true, whatsapp: true } }),
}));
vi.mock('@/hooks/useOutlookAccounts', () => ({
  useOutlookAccounts: () => ({ usableAccounts: [], defaultAccountId: undefined }),
}));
vi.mock('@/hooks/usePermissions', () => ({ useRolePermission: () => true }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'qa-token' } } }) } },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('MatchProposalEmailDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
