export const DAMAGE_TYPES = [
  { value: 'lekke_band', label: 'Lekke band', urgent: true },
  { value: 'dashboardlampje', label: 'Dashboardlampje', urgent: false },
  { value: 'pech_stilstand', label: 'Pech / stilstand', urgent: true },
  { value: 'ongeval', label: 'Ongeval', urgent: true },
  { value: 'schade_exterieur', label: 'Schade exterieur', urgent: false },
  { value: 'schade_interieur', label: 'Schade interieur', urgent: false },
  { value: 'onderhoud', label: 'Onderhoud', urgent: false },
  { value: 'overig', label: 'Overig', urgent: false },
] as const;

export const DAMAGE_ROUTE_STATUS_LABELS: Record<string, string> = {
  pending_internal: 'Wacht op interne regie',
  internal_notified: 'Interne regie geïnformeerd',
  forwarded_external: 'Extern doorgestuurd',
  closed: 'Afgesloten',
};

export const damageTypeLabel = (value: string | null | undefined) =>
  DAMAGE_TYPES.find((type) => type.value === value)?.label ?? value ?? 'Onbekend';

export const damageTypeIsUrgent = (value: string | null | undefined) =>
  DAMAGE_TYPES.find((type) => type.value === value)?.urgent ?? false;
