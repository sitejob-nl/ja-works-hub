import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiCreditsPanel from '@/components/settings/AiCreditsPanel';
import type { AiCreditSummary } from '@/hooks/useAiCredits';

const state = vi.hoisted(() => ({
  summary: null as AiCreditSummary | null,
  error: null as Error | null,
  topup: vi.fn(),
  allowance: vi.fn(),
}));
vi.mock('@/hooks/useAiCredits', () => ({
  useAiCreditSummary: () => ({ data: state.summary, error: state.error, isPending: false, isError: !!state.error, refetch: vi.fn() }),
  useAiCreditRequests: () => ({ data: { pages: [[]] }, refetch: vi.fn() }),
  useAiCreditLedger: () => ({ data: { pages: [[]] }, refetch: vi.fn() }),
  useLegacyAiUsage: () => ({ data: { pages: [[]] }, refetch: vi.fn() }),
  useManageAiCredits: () => ({
    topup: { mutateAsync: state.topup, reset: vi.fn(), isPending: false },
    setAllowance: { mutateAsync: state.allowance, isPending: false },
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
  state.error = null;
  state.summary = {
    balance_cents: 4999, reserved_cents: 1000, available_cents: 3999,
    monthly_allowance_cents: 5000, monthly_start_month: '2026-09-01', next_grant_at: '2026-09-30T22:00:00Z',
    budget_mode: 'monthly', budget_month: '2026-09-01', monthly_budget_cents: 5000,
    month_remaining_cents: 4999, previous_period_reserved_cents: 0, current_month_reserved_cents: 1000, month_reset_at: '2026-09-07T21:00:00Z',
    month_start: '2026-09-01', month_charged_cents: 1, month_provider_cost_usd: null,
    month_provider_cost_unknown_count: 1, unresolved_requests: 1, stale_requests: 0,
    ledger_difference_cents: 0, reservation_difference_cents: 0, historical_unexplained_cents: 22,
    unreviewed_overrun_cents: 0,
  };
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
});

describe('AI-credit settings', () => {
  it('separates spendable balance, reserves, euro credits and unknown provider cost', () => {
    render(<AiCreditsPanel orgId="org-one" />);
    expect(screen.getByText(/39,99/)).toBeInTheDocument();
    expect(screen.getByText('Maandbudget')).toBeInTheDocument();
    expect(screen.getByText(/10,00/)).toBeInTheDocument();
    expect(screen.getByText('Onbekend')).toBeInTheDocument();
    expect(screen.getByText(/bedrag is onvolledig/)).toBeInTheDocument();
    expect(screen.getByText(/Ongebruikt budget vervalt bij het begin van de volgende maand/)).toBeInTheDocument();
    expect(screen.queryByText(/Resterend tegoed blijft staan/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 okt 2026/)).toBeInTheDocument();
    expect(screen.getByText(/historisch verschil/)).toHaveTextContent('0,22');
    expect(screen.queryByRole('button', { name: 'Boeken' })).not.toBeInTheDocument();
  });

  it('shows a failed query instead of inventing a zero balance', () => {
    state.summary = null;
    state.error = new Error('Netwerk niet beschikbaar');
    render(<AiCreditsPanel orgId="org-one" />);
    expect(screen.getByText('AI-tegoed kon niet worden geladen')).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
  });

  it('does not post malformed top-up amounts', async () => {
    state.summary = { ...state.summary, budget_mode: 'prepaid', monthly_allowance_cents: 0, monthly_start_month: null };
    render(<AiCreditsPanel orgId="org-one" canManage />);
    fireEvent.change(screen.getByLabelText('Bedrag (€)'), { target: { value: '50abc' } });
    fireEvent.change(screen.getByLabelText('Omschrijving'), { target: { value: 'Correctie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Boeken' }));
    expect(state.topup).not.toHaveBeenCalled();
  });

  it('retries an uncertain top-up with the same identity, also after closing the panel', async () => {
    state.summary = { ...state.summary, budget_mode: 'prepaid', monthly_allowance_cents: 0, monthly_start_month: null };
    state.topup.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(11721);
    const view = render(<AiCreditsPanel orgId="org-one" canManage />);
    fireEvent.change(screen.getByLabelText('Bedrag (€)'), { target: { value: '50,00' } });
    fireEvent.change(screen.getByLabelText('Omschrijving'), { target: { value: 'Extra tegoed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Boeken' }));
    await waitFor(() => expect(state.topup).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Bedrag (€)')).toBeDisabled();
    view.unmount();
    render(<AiCreditsPanel orgId="org-one" canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Dezelfde boeking opnieuw proberen' }));
    await waitFor(() => expect(state.topup).toHaveBeenCalledTimes(2));
    expect(state.topup.mock.calls[1][0]).toEqual(state.topup.mock.calls[0][0]);
    expect(state.topup.mock.calls[0][0]).toMatchObject({ amountCents: 5000, note: 'Extra tegoed' });
    await waitFor(() => expect(sessionStorage.getItem('ai-credit-topup:org-one')).toBeNull());
  });

  it('saves a monthly spending limit through the budget RPC', async () => {
    state.allowance.mockResolvedValueOnce(null);
    render(<AiCreditsPanel orgId="org-one" canManage />);
    fireEvent.change(screen.getByLabelText('Maandbudget (€)'), { target: { value: '75,25' } });
    fireEvent.change(screen.getByLabelText('Vanaf maand'), { target: { value: '2026-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Maandbudget opslaan' }));
    await waitFor(() => expect(state.allowance).toHaveBeenCalledWith({ amountCents: 7525, startMonth: '2026-10-01' }));
    expect(state.topup).not.toHaveBeenCalled();
  });

  it('does not offer extra credit bookings to an organization with a monthly budget', () => {
    render(<AiCreditsPanel orgId="org-one" canManage />);
    expect(screen.getByText(/losse bijboekingen en saldocorrecties uitgeschakeld/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bedrag (€)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Boeken' })).not.toBeInTheDocument();
  });

  it('shows old holds separately and never presents a gross balance above the cap as this month’s budget', () => {
    state.summary = { ...state.summary, balance_cents: 7999, reserved_cents: 4000, previous_period_reserved_cents: 3000 };
    render(<AiCreditsPanel orgId="org-one" />);
    expect(screen.getByText(/39,99/)).toBeInTheDocument();
    expect(screen.getByText(/10,00/)).toBeInTheDocument();
    expect(screen.queryByText(/79,99/)).not.toBeInTheDocument();
    expect(screen.getByText(/Uit eerdere maanden staat nog/)).toHaveTextContent('30,00');
    expect(screen.getByText(/verlagen het huidige maandbudget niet/)).toBeInTheDocument();
  });

  it('shows the corrected September budget after one cent of usage', () => {
    state.summary = { ...state.summary, reserved_cents: 0, current_month_reserved_cents: 0, available_cents: 4999, unresolved_requests: 0 };
    render(<AiCreditsPanel orgId="org-one" />);
    expect(screen.getByText(/49,99/)).toBeInTheDocument();
    expect(screen.queryByText(/67,21/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nieuw maandbudget: 1 okt 2026/)).toBeInTheDocument();
  });

  it('keeps manual bookings disabled for a zero monthly budget in a fresh month', () => {
    state.summary = { ...state.summary, monthly_allowance_cents: 0, monthly_budget_cents: 0,
      balance_cents: 0, reserved_cents: 0, current_month_reserved_cents: 0,
      month_remaining_cents: 0, month_charged_cents: 0, available_cents: 0, unresolved_requests: 0 };
    render(<AiCreditsPanel orgId="org-one" canManage />);
    expect(screen.getByText(/losse bijboekingen en saldocorrecties uitgeschakeld/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bedrag (€)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Boeken' })).not.toBeInTheDocument();
    expect(screen.getByText(/Een lagere limiet mag lopende reserveringen van deze maand niet aantasten/)).toBeInTheDocument();
  });
});
