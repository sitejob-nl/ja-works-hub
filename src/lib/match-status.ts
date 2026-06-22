export const MATCH_STATUS_STEPS = [
  { key: 'nieuwe_match', label: 'Nieuwe match', color: 'bg-amber-500', badgeClass: 'bg-amber-100 text-amber-800 border-0' },
  { key: 'gescreend', label: 'Gescreend', color: 'bg-cyan-500', badgeClass: 'bg-cyan-100 text-cyan-800 border-0' },
  { key: 'voorgesteld', label: 'Voorgesteld', color: 'bg-slate-400', badgeClass: 'bg-slate-100 text-slate-700 border-0' },
  { key: 'voorgesteld_bij_klant', label: 'Bij klant', color: 'bg-indigo-500', badgeClass: 'bg-indigo-100 text-indigo-700 border-0' },
  { key: 'afspraak_op_kantoor', label: 'Afspraak op kantoor', color: 'bg-blue-500', badgeClass: 'bg-blue-100 text-blue-700 border-0' },
  { key: 'geaccepteerd', label: 'Geaccepteerd', color: 'bg-emerald-500', badgeClass: 'bg-emerald-100 text-emerald-700 border-0' },
  { key: 'afgewezen', label: 'Afgewezen', color: 'bg-red-500', badgeClass: 'bg-red-100 text-red-700 border-0' },
] as const;

export const PLACED_MATCH_STATUS = {
  key: 'geplaatst',
  label: 'Geplaatst',
  color: 'bg-emerald-700',
  badgeClass: 'bg-emerald-100 text-emerald-800 border-0',
} as const;

export type MatchStatus = typeof MATCH_STATUS_STEPS[number]['key'] | typeof PLACED_MATCH_STATUS.key | string;

export const MATCH_STATUS_OPTIONS = [...MATCH_STATUS_STEPS, PLACED_MATCH_STATUS] as const;
export const MATCH_STATUS_FLOW_OPTIONS = MATCH_STATUS_STEPS;
export const TERMINAL_MATCH_STATUSES = ['afgewezen', 'geaccepteerd', 'geplaatst'];
export const FEEDBACK_REQUIRED_STATUSES = ['afgewezen'];

export const NEXT_MATCH_STATUS: Record<string, string> = {
  nieuwe_match: 'gescreend',
  gescreend: 'voorgesteld',
  voorgesteld: 'voorgesteld_bij_klant',
  voorgesteld_bij_klant: 'afspraak_op_kantoor',
  afspraak_op_kantoor: 'geaccepteerd',
  // dormant: bestaande 'in_gesprek'-rijen kunnen nog doorschuiven (verdwenen uit de flow).
  in_gesprek: 'geaccepteerd',
};
const byKey = new Map<string, (typeof MATCH_STATUS_OPTIONS)[number]>(
  MATCH_STATUS_OPTIONS.map((status) => [status.key, status]),
);

export const getMatchStatusMeta = (status: string | null | undefined) =>
  byKey.get(status ?? '') ?? {
    key: status ?? 'onbekend',
    label: status ? status.replaceAll('_', ' ') : 'Onbekend',
    color: 'bg-slate-400',
    badgeClass: 'bg-muted text-muted-foreground border-0',
  };

export const isTerminalMatchStatus = (status: string | null | undefined) =>
  TERMINAL_MATCH_STATUSES.includes(status ?? '');

export const requiresMatchFeedbackReason = (status: string | null | undefined) =>
  FEEDBACK_REQUIRED_STATUSES.includes(status ?? '');

export const shouldUsePlacementFlow = (status: string | null | undefined) =>
  status === PLACED_MATCH_STATUS.key;

export const getNextMatchStatus = (status: string | null | undefined) =>
  NEXT_MATCH_STATUS[status ?? ''] ?? null;

export const matchStatusNeedsFeedbackDialog = (status: string | null | undefined) =>
  isTerminalMatchStatus(status) && !shouldUsePlacementFlow(status);

export const getStatusAgeLabel = (statusChangedAt?: string | null, createdAt?: string | null) => {
  const source = statusChangedAt ?? createdAt;
  if (!source) return null;
  const since = new Date(source).getTime();
  if (!Number.isFinite(since)) return null;
  const days = Math.max(0, Math.floor((Date.now() - since) / 86_400_000));
  if (days === 0) return 'vandaag gewijzigd';
  if (days === 1) return '1 dag in status';
  return `${days} dagen in status`;
};
