export const DEFAULT_MATCH_PIPELINE_FOLLOWUP_DAYS = 3;

export type MatchFollowupState =
  | { level: 'none'; label: null }
  | { level: 'warning'; label: string };

export function normalizeMatchPipelineFollowupDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MATCH_PIPELINE_FOLLOWUP_DAYS;
  return Math.min(30, Math.floor(n));
}

const ageInDays = (source: string | null | undefined, now = new Date()) => {
  if (!source) return null;
  const time = new Date(source).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / 86_400_000);
};

export function getMatchFollowupState(input: {
  status?: string | null;
  statusChangedAt?: string | null;
  createdAt?: string | null;
  interviewProposedAt?: string | null;
  interviewConfirmedAt?: string | null;
  followupDays?: number | null;
  now?: Date;
}): MatchFollowupState {
  const now = input.now ?? new Date();
  const followupDays = normalizeMatchPipelineFollowupDays(input.followupDays);
  const status = input.status ?? '';

  if (status === 'voorgesteld_bij_klant') {
    const days = ageInDays(input.statusChangedAt ?? input.createdAt, now);
    if (days != null && days >= followupDays) {
      return { level: 'warning', label: `${days} dagen voorgesteld` };
    }
  }

  if (status === 'afspraak_voorgesteld') {
    const proposedDays = ageInDays(input.interviewProposedAt ?? input.statusChangedAt, now);
    if (proposedDays != null && proposedDays >= 1) {
      return { level: 'warning', label: 'Afspraakvoorstel opvolgen' };
    }
    return { level: 'warning', label: 'Afspraakvoorstel doorzetten' };
  }

  if (status === 'afspraak_op_kantoor' && input.interviewConfirmedAt) {
    const confirmed = new Date(input.interviewConfirmedAt).getTime();
    if (Number.isFinite(confirmed) && confirmed < now.getTime()) {
      return { level: 'warning', label: 'Afspraak verlopen' };
    }
  }

  return { level: 'none', label: null };
}
