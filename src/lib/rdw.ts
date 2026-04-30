import { supabase } from '@/integrations/supabase/client';

export type RdwLookupResult = {
  license_plate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  body_type: string | null;
  fuel_type: string | null;
  engine_capacity: number | null;
  power_kw: number | null;
  weight: number | null;
  max_weight: number | null;
  seats: number | null;
  doors: number | null;
  first_registration: string | null;
  first_registration_nl: string | null;
  apk_expiry: string | null;
  insurance_expiry: string | null;
  emission_class: string | null;
  co2_emission: number | null;
  fuel_consumption: number | null;
  status: string | null;
  exported: boolean;
  stolen: boolean;
  wam_insured: boolean;
  raw: Record<string, unknown>;
};

const FUEL_MAP: Record<string, string> = {
  benzine: 'benzine',
  diesel: 'diesel',
  elektriciteit: 'elektrisch',
  elektrisch: 'elektrisch',
  hybride: 'hybride',
  lpg: 'lpg',
  cng: 'lpg',
};

export const normalizeRdwFuel = (rdwFuel: string | null | undefined): string | null => {
  if (!rdwFuel) return null;
  const key = rdwFuel.trim().toLowerCase();
  return FUEL_MAP[key] ?? null;
};

export const yearFromRdwDate = (rdwDate: string | null | undefined): number | null => {
  if (!rdwDate) return null;
  const year = parseInt(rdwDate.substring(0, 4), 10);
  return Number.isFinite(year) ? year : null;
};

export const formatRdwDate = (rdwDate: string | null | undefined): string | null => {
  if (!rdwDate) return null;
  const trimmed = rdwDate.trim();
  if (!/^\d{8}$/.test(trimmed)) return null;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
};

export const lookupRdw = async (licensePlate: string): Promise<RdwLookupResult> => {
  const { data, error } = await supabase.functions.invoke('rdw-lookup', {
    body: { license_plate: licensePlate },
  });
  if (error) throw error;
  const raw = data as RdwLookupResult;
  return {
    ...raw,
    apk_expiry: formatRdwDate(raw.apk_expiry),
    first_registration: formatRdwDate(raw.first_registration),
    first_registration_nl: formatRdwDate(raw.first_registration_nl),
  };
};
