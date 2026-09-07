import { isValid, parseISO } from 'date-fns';
import { formatDate, formatDateTime } from '@/lib/format';

/**
 * Laatste bekende locatie van een voertuig — waar staat de auto, sinds wanneer weten we
 * dat, en wie legde het vast.
 *
 * Bewust handmatige invoer (de klant denkt nog na over een GPS-koppeling), maar de
 * kolommen zijn zo gemodelleerd dat een latere automatische bron dezelfde velden kan
 * vullen: het tijdstip staat los van `updated_at` en `last_known_location_by` is nullable.
 *
 * Alle weergave loopt via deze helpers, omdat **leeg een geldige staat is**: een voertuig
 * zonder locatie moet een streepje geven en nooit een lege badge, een "Invalid Date" of
 * een datum die suggereert dat hij vandaag nog gezien is.
 */

/** Wat de UI van een voertuigrij nodig heeft. Alles optioneel: oude rijen hebben niets. */
export type VehicleLocationRow = {
  last_known_location?: string | null;
  last_known_location_at?: string | null;
  /** Embed: `location_profile:profiles!vehicles_last_known_location_by_fkey(full_name)`. */
  location_profile?: { full_name?: string | null } | null;
} | null | undefined;

/** Invoerlimiet in de dialoog — een locatie is een aanduiding, geen notitieveld. */
export const VEHICLE_LOCATION_MAX_LENGTH = 120;

/** De ingevulde locatie, of null. Alleen spaties telt als leeg. */
export function vehicleLocationText(row: VehicleLocationRow): string | null {
  const value = row?.last_known_location;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Het tijdstip, geformatteerd, of null. Drie keer null in plaats van iets tonen:
 * zonder locatie (een los tijdstip zegt niets), zonder tijdstip, en bij een waarde die
 * geen geldige datum is — anders staat er "Invalid Date" in de kolom.
 */
function formatLocationMoment(
  row: VehicleLocationRow,
  formatter: (value: string) => string,
): string | null {
  if (!vehicleLocationText(row)) return null;
  const raw = row?.last_known_location_at;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  if (!isValid(parseISO(raw))) return null;
  return formatter(raw);
}

/** `07-09-2026` voor in een lijstkolom, of null. */
export function vehicleLocationDate(row: VehicleLocationRow): string | null {
  return formatLocationMoment(row, formatDate);
}

/** `07-09-2026 14:05` voor op het dossier, of null. */
export function vehicleLocationDateTime(row: VehicleLocationRow): string | null {
  return formatLocationMoment(row, formatDateTime);
}

/**
 * "Kas Meulengraaf · 07-09-2026 14:05" — wie de locatie bijwerkte, met het tijdstip erbij.
 * Zelfde vorm als `formatAssignedBy` in `@/lib/assignments`: de naam alleen laat open
 * wánneer het is vastgelegd, en juist dat bepaalt hoeveel de melding nog waard is.
 *
 * Ontbreekt de naam (een latere automatische bron heeft geen profiel), dan blijft het
 * tijdstip staan; ontbreekt het tijdstip, dan blijft de naam staan. Is er niets — of geen
 * locatie — dan null, zodat de aanroeper de regel helemaal weglaat.
 */
export function formatVehicleLocationUpdate(row: VehicleLocationRow): string | null {
  if (!vehicleLocationText(row)) return null;
  const name = row?.location_profile?.full_name?.trim() || null;
  const moment = vehicleLocationDateTime(row);
  if (name && moment) return `${name} · ${moment}`;
  return name ?? moment;
}

/**
 * De velden voor een update. Leegmaken wist ook tijdstip en naam: een datum zonder plek
 * is misleidend, en de databasegrendel (`vehicles_last_known_location_complete`) weigert
 * die combinatie sowieso.
 *
 * `now` is een parameter zodat de test niet van de klok afhangt.
 */
export function vehicleLocationPatch(
  raw: string,
  profileId: string | null | undefined,
  now: Date = new Date(),
): {
  last_known_location: string | null;
  last_known_location_at: string | null;
  last_known_location_by: string | null;
} {
  const location = raw.trim();
  if (location === '') {
    return { last_known_location: null, last_known_location_at: null, last_known_location_by: null };
  }
  return {
    last_known_location: location,
    last_known_location_at: now.toISOString(),
    last_known_location_by: profileId ?? null,
  };
}
