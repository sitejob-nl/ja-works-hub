import { supabase } from '@/integrations/supabase/client';
import { geocodePdokAddress } from '@/lib/pdok';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * Geocode a Dutch address using PDOK Locatieserver (free, no API key).
 * Returns lat/lng or null if not found.
 */
export async function geocodeAddress(
  street: string,
  postal: string,
  city: string
): Promise<{ lat: number; lng: number } | null> {
  return geocodePdokAddress({ street, postal, city });
}

/**
 * Get driving distance and duration between two points using Mapbox Directions API.
 * Returns distance in km and duration in minutes, or null on failure.
 */
export async function getDrivingDistance(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): Promise<{ distanceKm: number; durationMin: number } | null> {
  if (!MAPBOX_TOKEN) return null;

  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;

    return {
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
    };
  } catch {
    return null;
  }
}

/**
 * Geocode and persist lat/lng for a property.
 * Fire-and-forget — does not throw.
 */
export async function geocodeAndSaveProperty(
  propertyId: string,
  street: string,
  postal: string,
  city: string
): Promise<void> {
  const coords = await geocodeAddress(street, postal, city);
  if (!coords) return;

  await supabase
    .from('properties')
    .update({ address_lat: coords.lat, address_lng: coords.lng })
    .eq('id', propertyId);
}

/**
 * Geocode and persist lat/lng for a company.
 * Fire-and-forget — does not throw.
 */
export async function geocodeAndSaveCompany(
  companyId: string,
  street: string,
  postal: string,
  city: string
): Promise<void> {
  const coords = await geocodeAddress(street, postal, city);
  if (!coords) return;

  await supabase
    .from('companies')
    .update({ address_lat: coords.lat, address_lng: coords.lng })
    .eq('id', companyId);
}
