// Contactgegevens die de PUBLIEKE voorstelpagina ("vraag stellen") mag tonen.
//
// Beperking die de code zelf niet laat zien: de opdrachtgever krijgt hier alleen
// INTERNE contactgegevens te zien. Een kandidaat-telefoonnummer of -e-mailadres
// mag hier nooit belanden. Daarom accepteert deze helper uitsluitend twee bronnen
// — de accountmanager (een `profiles`-rij) en de organisatie — en resolvet de
// aanroeper nooit zelf een los telefoonveld. Wie hier iets aan wil toevoegen,
// moet dat bewust in dit bestand doen.
//
// Geen Deno/esm.sh-imports: deze module wordt vanuit Vitest getest.

export type MatchContactProfile = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
} | null | undefined;

export type MatchContactOrganization = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
} | null | undefined;

export type MatchContact = {
  /** Naam van de accountmanager; alleen gevuld als er ook een persoonlijk kanaal bij hoort. */
  manager_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  /** Of het getoonde adres/nummer van de accountmanager zelf is (anders: de algemene org-lijn). */
  email_is_personal: boolean;
  phone_is_personal: boolean;
};

export const EMPTY_MATCH_CONTACT: MatchContact = {
  manager_name: null,
  manager_email: null,
  manager_phone: null,
  email_is_personal: false,
  phone_is_personal: false,
};

const clean = (value?: string | null): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Bepaalt welk contact de klant ziet: de aan de match gekoppelde accountmanager,
 * met de algemene organisatiegegevens als vangnet. Per kanaal wordt bijgehouden of
 * het persoonlijk is, zodat de pagina geen algemeen nummer aan een naam plakt.
 */
export function resolveMatchContact(input: {
  enabled?: boolean;
  manager?: MatchContactProfile;
  organization?: MatchContactOrganization;
}): MatchContact {
  if (input.enabled === false) return { ...EMPTY_MATCH_CONTACT };

  const managerEmail = clean(input.manager?.email);
  const managerPhone = clean(input.manager?.phone);
  const email = managerEmail ?? clean(input.organization?.email);
  const phone = managerPhone ?? clean(input.organization?.phone);

  return {
    manager_name: managerEmail || managerPhone ? clean(input.manager?.full_name) : null,
    manager_email: email,
    manager_phone: phone,
    email_is_personal: Boolean(managerEmail),
    phone_is_personal: Boolean(managerPhone),
  };
}
