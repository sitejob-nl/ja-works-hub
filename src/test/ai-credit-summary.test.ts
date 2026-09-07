import { describe, expect, it, vi } from 'vitest';
import { parseAiCreditSummary } from '@/hooks/useAiCredits';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const summary = {
  balance_cents: 4999, reserved_cents: 0, available_cents: 4999,
  monthly_allowance_cents: 5000, monthly_start_month: '2026-09-01',
  budget_mode: 'monthly', budget_month: '2026-09-01', monthly_budget_cents: 5000,
  month_remaining_cents: 4999, previous_period_reserved_cents: 0, current_month_reserved_cents: 0,
  month_reset_at: '2026-09-07T21:00:00+00:00',
  next_grant_at: '2026-09-30T22:00:00+00:00', month_start: '2026-09-01',
  month_charged_cents: 1, month_provider_cost_usd: null,
  month_provider_cost_unknown_count: 1, unresolved_requests: 0, stale_requests: 0,
  ledger_difference_cents: 0, reservation_difference_cents: 0,
  historical_unexplained_cents: 22, unreviewed_overrun_cents: 0,
};

describe('AI-credit summary RPC validation', () => {
  it('preserves exact cents, unknown provider costs and the historical gap', () => {
    expect(parseAiCreditSummary(summary)).toEqual(summary);
  });

  it.each([undefined, null, '6721', 6721.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid or missing balances: %s', (balance_cents) => {
    expect(() => parseAiCreditSummary({ ...summary, balance_cents })).toThrow('Het AI-tegoed bevat ongeldige gegevens');
  });

  it('does not coerce unknown or invalid provider costs into zero', () => {
    expect(() => parseAiCreditSummary({ ...summary, month_provider_cost_usd: '0.02' })).toThrow();
    expect(() => parseAiCreditSummary({ ...summary, month_provider_cost_usd: Infinity })).toThrow();
    expect(parseAiCreditSummary({ ...summary, month_provider_cost_usd: 0.02 }).month_provider_cost_usd).toBe(0.02);
  });

  it('accepts signed reconciliation differences and an absent monthly schedule', () => {
    expect(parseAiCreditSummary({ ...summary, budget_mode: 'prepaid', budget_month: null, ledger_difference_cents: -22, monthly_start_month: null, next_grant_at: null, month_reset_at: null }))
      .toMatchObject({ budget_mode: 'prepaid', ledger_difference_cents: -22, monthly_start_month: null, next_grant_at: null });
  });
});
