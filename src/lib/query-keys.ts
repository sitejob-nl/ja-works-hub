/**
 * Centralized, tenant-safe TanStack Query keys — one source of truth for the cache.
 *
 * Two rules keep this safe to adopt incrementally without changing behavior:
 *  1. Tenant-scoped data embeds `orgId` so caches can't collide across organizations.
 *     (Keys that pre-date this rule are reproduced verbatim — see `candidates.activeForTimesheet`
 *     — so existing data is fetched/cached identically.)
 *  2. The FIRST array element is preserved from the original ad-hoc key, so existing prefix
 *     invalidations like `invalidateQueries({ queryKey: ['regulations'] })` keep matching a
 *     migrated key such as `['regulations', orgId]`.
 *
 * Migrating a call site = replace the inline `queryKey: [...]` with the matching `qk.*` call
 * (which returns the identical array today) and the inline fetch with `unwrap`/`unwrapList`.
 * New code should prefer the org-scoped shapes (see `candidates.list`).
 *
 * This is intentionally partial: extend per domain as call sites are migrated.
 */
export const qk = {
  candidates: {
    all: (orgId: string) => ['candidates', orgId] as const,
    list: (orgId: string, filters: Record<string, unknown> = {}) =>
      ['candidates', orgId, 'list', filters] as const,
    detail: (id: string) => ['candidate', id] as const,
    /** Active-employee picker — intentionally NOT org-keyed (RLS-scoped); preserves the original key. */
    activeForTimesheet: () => ['candidates-active-for-timesheet'] as const,
  },
  placements: {
    forEmployee: (employeeId: string) => ['placements-for-employee', employeeId] as const,
    hourTypes: (placementId: string) => ['placement-hour-types', placementId] as const,
    travelTypes: (placementId: string) => ['placement-travel-types', placementId] as const,
    allowances: (placementId: string) => ['placement-allowances', placementId] as const,
  },
  regulations: {
    list: (orgId: string) => ['regulations', orgId] as const,
  },
  talentpools: {
    forCandidateAdd: (orgId: string) => ['talentpools-for-candidate-add', orgId] as const,
  },
} as const;
