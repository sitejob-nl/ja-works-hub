import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';

const creditCents = z.number().int().safe();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aiCreditSummarySchema = z.object({
  balance_cents: creditCents,
  reserved_cents: creditCents,
  available_cents: creditCents,
  monthly_allowance_cents: creditCents,
  budget_mode: z.enum(['monthly', 'prepaid']),
  budget_month: calendarDate.nullable(),
  monthly_budget_cents: creditCents.nonnegative(),
  month_remaining_cents: creditCents,
  previous_period_reserved_cents: creditCents.nonnegative(),
  current_month_reserved_cents: creditCents.nonnegative(),
  month_reset_at: z.string().datetime({ offset: true }).nullable(),
  monthly_start_month: calendarDate.nullable(),
  next_grant_at: z.string().datetime({ offset: true }).nullable(),
  month_start: calendarDate,
  month_charged_cents: creditCents,
  month_provider_cost_usd: z.number().finite().nonnegative().nullable(),
  month_provider_cost_unknown_count: creditCents.nonnegative(),
  unresolved_requests: creditCents.nonnegative(),
  stale_requests: creditCents.nonnegative(),
  ledger_difference_cents: creditCents,
  reservation_difference_cents: creditCents,
  historical_unexplained_cents: creditCents,
  unreviewed_overrun_cents: creditCents.nonnegative(),
});

export type AiCreditSummary = z.infer<typeof aiCreditSummarySchema>;

/** JSON-returning RPCs need runtime validation; unknown amounts must never become zero. */
export function parseAiCreditSummary(value: unknown): AiCreditSummary {
  const result = aiCreditSummarySchema.safeParse(value);
  if (!result.success) throw new Error('Het AI-tegoed bevat ongeldige gegevens. Probeer opnieuw of neem contact op met SiteJob.');
  return result.data;
}

export type AiCreditRequest = Pick<Tables<'ai_requests'>,
  'id' | 'organization_id' | 'feature' | 'provider' | 'model' | 'status' |
  'reservation_cents' | 'charged_cents' | 'input_tokens' | 'output_tokens' |
  'thinking_tokens' | 'provider_cost_usd' | 'duration_ms' | 'error_code' |
  'reservation_overrun_cents' | 'created_at'>;

export type AiCreditLedgerEntry = Pick<Tables<'ai_credit_ledger'>,
  'id' | 'organization_id' | 'kind' | 'amount_cents' | 'balance_after_cents' |
  'request_id' | 'grant_month' | 'note' | 'created_at'>;

export type LegacyAiUsage = Pick<Tables<'ai_usage_log'>,
  'id' | 'organization_id' | 'request_id' | 'feature' | 'provider' | 'model' |
  'input_tokens' | 'output_tokens' | 'cost_cents' | 'duration_ms' | 'created_at'>;

const PAGE_SIZE = 30;
type HistoryCursor = { created_at: string; id: string } | null;
const nextHistoryCursor = (rows: Array<{ created_at: string; id: string }>) =>
  rows.length === PAGE_SIZE ? { created_at: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id } : undefined;
const beforeCursor = (cursor: HistoryCursor) =>
  `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;

export function useAiCreditSummary(orgId: string) {
  return useQuery({
    queryKey: qk.aiCredits.summary(orgId),
    queryFn: async () => parseAiCreditSummary(await unwrap(supabase.rpc('get_ai_credit_summary', { p_org_id: orgId }))),
    enabled: !!orgId,
    // Reservations and pending provider replies can change while settings are open.
    refetchInterval: 30_000,
  });
}

export function useAiCreditRequests(orgId: string) {
  return useInfiniteQuery({
    queryKey: qk.aiCredits.requests(orgId),
    initialPageParam: null as HistoryCursor,
    queryFn: ({ pageParam }) => {
      let query = supabase.from('ai_requests')
      .select('id, organization_id, feature, provider, model, status, reservation_cents, charged_cents, input_tokens, output_tokens, thinking_tokens, provider_cost_usd, duration_ms, error_code, reservation_overrun_cents, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(PAGE_SIZE);
      if (pageParam) query = query.or(beforeCursor(pageParam));
      return unwrapList(query);
    },
    getNextPageParam: (lastPage: AiCreditRequest[]) => nextHistoryCursor(lastPage),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
}

export function useAiCreditLedger(orgId: string) {
  return useInfiniteQuery({
    queryKey: qk.aiCredits.ledger(orgId),
    initialPageParam: null as HistoryCursor,
    queryFn: ({ pageParam }) => {
      let query = supabase.from('ai_credit_ledger')
      .select('id, organization_id, kind, amount_cents, balance_after_cents, request_id, grant_month, note, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(PAGE_SIZE);
      if (pageParam) query = query.or(beforeCursor(pageParam));
      return unwrapList(query);
    },
    getNextPageParam: (lastPage: AiCreditLedgerEntry[]) => nextHistoryCursor(lastPage),
    enabled: !!orgId,
  });
}

export function useLegacyAiUsage(orgId: string) {
  return useInfiniteQuery({
    queryKey: qk.aiCredits.legacyUsage(orgId),
    initialPageParam: null as HistoryCursor,
    queryFn: ({ pageParam }) => {
      let query = supabase.from('ai_usage_log')
      .select('id, organization_id, request_id, feature, provider, model, input_tokens, output_tokens, cost_cents, duration_ms, created_at')
      .eq('organization_id', orgId).is('request_id', null)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(PAGE_SIZE);
      if (pageParam) query = query.or(beforeCursor(pageParam));
      return unwrapList(query);
    },
    getNextPageParam: (lastPage: LegacyAiUsage[]) => nextHistoryCursor(lastPage),
    enabled: !!orgId,
  });
}

export function useAiCreditOrganizationBalances() {
  return useQuery({
    queryKey: qk.aiCredits.organizationBalances(),
    queryFn: () => unwrapList(supabase.from('organization_credits')
      .select('organization_id, balance_cents, reserved_cents')),
    refetchInterval: 30_000,
  });
}

export function useManageAiCredits(orgId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.aiCredits.all() });
  const topup = useMutation({
    mutationFn: (input: { amountCents: number; note: string; requestId: string }) =>
      unwrap(supabase.rpc('topup_ai_credits_once', {
        p_org_id: orgId, p_amount_cents: input.amountCents, p_note: input.note, p_request_id: input.requestId,
      })),
    onSuccess: invalidate,
    // An ambiguous response must retry the same request ID, never make a fresh booking.
    retry: false,
  });
  const setAllowance = useMutation({
    mutationFn: (input: { amountCents: number; startMonth: string }) =>
      unwrap(supabase.rpc('set_monthly_ai_allowance', {
        p_org_id: orgId, p_amount_cents: input.amountCents, p_start_month: input.startMonth,
      })),
    onSuccess: invalidate,
  });
  return { topup, setAllowance };
}
