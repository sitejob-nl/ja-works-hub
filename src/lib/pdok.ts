export type AddressValue = {
  street: string;
  postal: string;
  city: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
};

export type PdokSuggestion = {
  id: string;
  label: string;
};

export type PdokAddress = AddressValue & {
  id: string;
  label: string;
};

const PDOK_BASE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';

const parsePoint = (point: string | null | undefined): { lat: number; lng: number } | null => {
  const match = point?.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
  if (!match) return null;
  return { lng: Number(match[1]), lat: Number(match[2]) };
};

const cleanPostal = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, '').toUpperCase();

const buildStreet = (doc: any) => {
  const houseNumber = [doc.huisnummer, doc.huisletter, doc.huisnummertoevoeging].filter(Boolean).join('');
  return [doc.straatnaam, houseNumber].filter(Boolean).join(' ').trim();
};

const toPdokAddress = (doc: any): PdokAddress | null => {
  const coords = parsePoint(doc?.centroide_ll);
  if (!doc?.id || !coords) return null;

  return {
    id: doc.id,
    label: doc.weergavenaam ?? [buildStreet(doc), doc.postcode, doc.woonplaatsnaam].filter(Boolean).join(', '),
    street: buildStreet(doc),
    postal: cleanPostal(doc.postcode),
    city: doc.woonplaatsnaam ?? '',
    country: 'Nederland',
    lat: coords.lat,
    lng: coords.lng,
  };
};

export async function suggestPdokAddresses(query: string, rows = 6): Promise<PdokSuggestion[]> {
  if (query.trim().length < 3) return [];

  const params = new URLSearchParams({
    q: query,
    rows: String(rows),
    fq: 'type:adres',
    fl: 'id,weergavenaam,type',
  });

  const res = await fetch(`${PDOK_BASE_URL}/suggest?${params.toString()}`);
  if (!res.ok) return [];

  const data = await res.json();
  return (data?.response?.docs ?? [])
    .filter((doc: any) => doc.id && doc.weergavenaam)
    .map((doc: any) => ({ id: doc.id, label: doc.weergavenaam }));
}

export async function lookupPdokAddress(id: string): Promise<PdokAddress | null> {
  const params = new URLSearchParams({
    id,
    fl: 'id,weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam,centroide_ll',
  });

  const res = await fetch(`${PDOK_BASE_URL}/lookup?${params.toString()}`);
  if (!res.ok) return null;

  const data = await res.json();
  return toPdokAddress(data?.response?.docs?.[0]);
}

export async function geocodePdokAddress(address: Pick<AddressValue, 'street' | 'postal' | 'city'>): Promise<{ lat: number; lng: number } | null> {
  const query = [address.street, address.postal, address.city].filter(Boolean).join(' ');
  if (!query.trim()) return null;

  const params = new URLSearchParams({
    q: query,
    rows: '1',
    fq: 'type:adres',
    fl: 'id,weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam,centroide_ll',
  });

  try {
    const res = await fetch(`${PDOK_BASE_URL}/free?${params.toString()}`);
    if (!res.ok) return null;

    const data = await res.json();
    const addressResult = toPdokAddress(data?.response?.docs?.[0]);
    if (!addressResult?.lat || !addressResult?.lng) return null;

    return { lat: addressResult.lat, lng: addressResult.lng };
  } catch {
    return null;
  }
}

export async function resolveAddressCoordinates(address: AddressValue): Promise<AddressValue> {
  if (address.lat != null && address.lng != null) return address;

  const coords = await geocodePdokAddress(address);
  if (!coords) return { ...address, lat: null, lng: null };

  return { ...address, lat: coords.lat, lng: coords.lng };
}
