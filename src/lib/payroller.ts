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
