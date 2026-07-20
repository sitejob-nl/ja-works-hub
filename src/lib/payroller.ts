/**
 * Payrollers (loonmotoren) komen sinds migratie 20260720120000 uit de tabel
 * `payrollers` per organisatie — niet meer uit een vaste enum met vier waarden.
 * Of ja werkt factureert is nu een eigenschap van de rij (`invoiced_by_us`)
 * in plaats van een hardcoded lijst in deze file.
 */
export interface Payroller {
  id: string;
  name: string;
  invoiced_by_us: boolean;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  /** Enum-waarde waar deze rij uit gemigreerd is; zelf toegevoegd = null. */
  legacy_key: string | null;
}

/** De vier oorspronkelijke payrollers houden hun vertrouwde badge-kleur. */
const LEGACY_BADGE_CLASS: Record<string, string> = {
  flexpedia: 'bg-blue-100 text-blue-800',
  brioworks: 'bg-emerald-100 text-emerald-800',
  bromida: 'bg-amber-100 text-amber-800',
  retiva: 'bg-purple-100 text-purple-800',
};

/** Kleuren voor zelf toegevoegde payrollers — stabiel per naam, niet willekeurig. */
const BADGE_PALETTE = [
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-lime-100 text-lime-800',
  'bg-fuchsia-100 text-fuchsia-800',
];

export function payrollerBadgeClass(
  payroller: Pick<Payroller, 'name' | 'legacy_key'> | null | undefined,
): string {
  if (!payroller) return '';
  if (payroller.legacy_key && LEGACY_BADGE_CLASS[payroller.legacy_key]) {
    return LEGACY_BADGE_CLASS[payroller.legacy_key];
  }
  let hash = 0;
  for (let i = 0; i < payroller.name.length; i++) {
    hash = (hash * 31 + payroller.name.charCodeAt(i)) >>> 0;
  }
  return BADGE_PALETTE[hash % BADGE_PALETTE.length];
}
