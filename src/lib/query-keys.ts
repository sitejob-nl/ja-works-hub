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
  permissions: {
    roleMatrix: (orgId: string) => ['role-permissions', orgId] as const,
    userOverrides: (orgId: string, userId: string) => ['user-permission-overrides', orgId, userId] as const,
  },
  candidates: {
    all: (orgId: string) => ['candidates', orgId] as const,
    list: (orgId: string, filters: Record<string, unknown> = {}) =>
      ['candidates', orgId, 'list', filters] as const,
    detail: (id: string) => ['candidate', id] as const,
    /** Active-employee picker — intentionally NOT org-keyed (RLS-scoped); preserves the original key. */
    activeForTimesheet: () => ['candidates-active-for-timesheet'] as const,
  },
  communications: {
    forEntity: (orgId: string, entityType: string, entityId: string) =>
      ['entity-communications', orgId, entityType, entityId] as const,
    entityOutlookPage: (
      orgId: string,
      entityType: string,
      entityId: string,
      accountId: string,
      emailKey: string,
      page: number,
    ) => ['entity-outlook-history', orgId, entityType, entityId, accountId, emailKey, page] as const,
    entityOutlookDetail: (orgId: string, accountId: string, messageId: string) =>
      ['entity-outlook-message', orgId, accountId, messageId] as const,
    entityOutlookThread: (orgId: string, accountId: string, messageId: string) =>
      ['entity-outlook-thread', orgId, accountId, messageId] as const,
    forCandidate: (orgId: string, candidateId: string) =>
      ['candidate-communications', orgId, candidateId] as const,
    candidateOutlookPage: (
      orgId: string,
      candidateId: string,
      accountId: string,
      candidateEmail: string,
      page: number,
    ) => ['candidate-outlook-history', orgId, candidateId, accountId, candidateEmail, page] as const,
    candidateOutlookDetail: (orgId: string, accountId: string, messageId: string) =>
      ['candidate-outlook-message', orgId, accountId, messageId] as const,
  },
  placements: {
    forEmployee: (employeeId: string) => ['placements-for-employee', employeeId] as const,
    workOrderOps: (placementId: string) => ['placement-workorder-ops', placementId] as const,
    timesheets: (placementId: string) => ['placement-timesheets', placementId] as const,
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
  vehicles: {
    /** Vehicle entity — shared by VehicleDetail + the transport tabs' invalidations. */
    detail: (id: string) => ['vehicle', id] as const,
    deleteImpact: (id: string) => ['vehicle-delete-impact', id] as const,
  },
  fuel: {
    analysisSettings: (orgId: string) => ['organization-fuel-analysis-settings', orgId] as const,
    transactions: (orgId: string) => ['fuel-transactions', orgId] as const,
    dataQuality: (orgId: string) => ['fuel-analysis-data-quality', orgId] as const,
    imports: (orgId: string) => ['fuel-card-imports', orgId] as const,
  },
  housing: {
    property: (propertyId: string) => ['property', propertyId] as const,
    availableEmployees: (orgId: string, search: string) =>
      ['available-employees-housing', orgId, search] as const,
    moveTargets: (orgId: string) => ['move-targets', orgId] as const,
  },
  employees: {
    housingAssignments: (orgId: string, candidateId: string) =>
      ['housing-assignments', orgId, candidateId] as const,
    keyRegistrations: (orgId: string, candidateId: string) =>
      ['key-registrations', orgId, candidateId] as const,
    assignableUnits: (orgId: string) => ['assignable-units', orgId] as const,
    contracts: (candidateId: string) => ['contracts', candidateId] as const,
    contractTemplates: (orgId: string) => ['contract-templates', orgId] as const,
    organization: (orgId: string) => ['organization', orgId] as const,
    activePlacement: (candidateId: string) => ['active-placement', candidateId] as const,
    sickReports: (candidateId: string) => ['sick-reports', candidateId] as const,
  },
  transport: {
    damage: (vehicleId: string) => ['vehicle-damage', vehicleId] as const,
    damagePhotoUrls: (vehicleId: string, paths: readonly string[]) =>
      ['vehicle-damage-photo-urls', vehicleId, paths] as const,
    damageContactSettings: (orgId: string) => ['damage-contact-settings', orgId] as const,
    damageAssignableEmployees: (orgId: string, employeeId: string | null | undefined) =>
      ['damage-assignable-employees', orgId, employeeId] as const,
    fines: (vehicleId: string) => ['vehicle-fines', vehicleId] as const,
    finePhotoUrls: (vehicleId: string, paths: readonly string[]) =>
      ['vehicle-fine-photo-urls', vehicleId, paths] as const,
    fineAssignedEmployees: (vehicleId: string) => ['vehicle-assigned-employees-fines', vehicleId] as const,
    /** Global transport-fines list (invalidated alongside per-vehicle fines). */
    allFines: () => ['transport-fines'] as const,
  },
} as const;
