import { supabase } from '@/integrations/supabase/client';

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
  const query = [street, postal, city].filter(Boolean).join(' ');
  if (!query.trim()) return null;

  try {
    const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(query)}&rows=1&fq=type:adres`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const doc = data?.response?.docs?.[0];
    if (!doc?.centroide_ll) return null;

    // centroide_ll format: "POINT(lng lat)"
    const match = doc.centroide_ll.match(/POINT\(([\d.]+)\s+([\d.]+)\)/);
    if (!match) return null;

    return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  } catch {
    return null;
  }
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
