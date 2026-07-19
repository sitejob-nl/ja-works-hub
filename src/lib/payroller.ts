export const payrollerLabel: Record<string, string> = {
  flexpedia: 'Flexpedia',
  brioworks: 'BrioWorks',
  bromida: 'Bromida',
  retiva: 'Retiva/A1',
};

export const payrollerBadgeClass: Record<string, string> = {
  flexpedia: 'bg-blue-100 text-blue-800',
  brioworks: 'bg-emerald-100 text-emerald-800',
  bromida: 'bg-amber-100 text-amber-800',
  retiva: 'bg-purple-100 text-purple-800',
};

/** Payrollers that ja werkt invoices for (excludes Flexpedia) */
export const JA_WERKT_PAYROLLERS = ['brioworks', 'bromida', 'retiva'];

export const ALL_PAYROLLERS = ['flexpedia', 'brioworks', 'bromida', 'retiva'] as const;

export interface PayrollerSettings {
  /** Payrollers die de org actief gebruikt (kiesbaar in de plaatsingswizard). */
  enabled: string[];
  /** Vooringevulde payroller bij een nieuwe plaatsing (moet in `enabled` zitten). */
  default: string | null;
}

/** Leest `organizations.settings.payrollers`; zonder instelling zijn alle payrollers actief. */
export function getPayrollerSettings(settings: unknown): PayrollerSettings {
  const raw = (settings as any)?.payrollers;
  const enabled = Array.isArray(raw?.enabled)
    ? raw.enabled.filter((p: unknown): p is string => typeof p === 'string' && p in payrollerLabel)
    : [...ALL_PAYROLLERS];
  const def = typeof raw?.default === 'string' && enabled.includes(raw.default) ? raw.default : null;
  return { enabled, default: def };
}
