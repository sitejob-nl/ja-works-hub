/**
 * Canonieke entiteit → route mapping. Single source of truth voor alle deep-links.
 *
 * Gebruik via <EntityLink type="candidate" id={...} /> (zie components/ui/entity-link.tsx)
 * of rechtstreeks via entityPath() wanneer je alleen een href nodig hebt (bv. notificaties).
 *
 * Kandidaten en medewerkers delen dezelfde `candidates`-tabel maar hebben twee
 * weergaven: gebruik 'candidate' voor de kandidaat-zone (/kandidaten) en 'employee'
 * voor de medewerker-zone (/medewerkers).
 */
export type EntityType =
  | 'candidate'
  | 'employee'
  | 'company'
  | 'contact'
  | 'vacancy'
  | 'placement'
  | 'property'
  | 'vehicle'
  | 'talentpool';

export const ENTITY_ROUTES: Record<EntityType, { base: string; label: string }> = {
  candidate: { base: '/kandidaten', label: 'Kandidaat' },
  employee: { base: '/medewerkers', label: 'Medewerker' },
  company: { base: '/opdrachtgevers', label: 'Opdrachtgever' },
  contact: { base: '/contacten', label: 'Contactpersoon' },
  vacancy: { base: '/vacatures', label: 'Vacature' },
  placement: { base: '/plaatsingen', label: 'Plaatsing' },
  property: { base: '/huisvesting', label: 'Pand' },
  vehicle: { base: '/transport', label: 'Voertuig' },
  talentpool: { base: '/talentpools', label: 'Talentpool' },
};

export interface EntityPathOptions {
  /** voegt ?tab=... toe zodat de detailpagina direct op de juiste tab opent */
  tab?: string;
  /** extra query-params (leeg/undefined wordt overgeslagen) */
  params?: Record<string, string | number | undefined | null>;
}

/**
 * Bouwt een detail-pad voor een entiteit. Geeft een lege string terug bij een
 * onbekend type of ontbrekend id, zodat callers veilig kunnen terugvallen op platte tekst.
 */
export function entityPath(type: EntityType, id: string | null | undefined, opts: EntityPathOptions = {}): string {
  const base = ENTITY_ROUTES[type]?.base;
  if (!base || !id) return '';

  const search = new URLSearchParams();
  if (opts.tab) search.set('tab', opts.tab);
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }

  const qs = search.toString();
  return qs ? `${base}/${id}?${qs}` : `${base}/${id}`;
}
