import { format, startOfWeek } from 'date-fns';

export type FuelAnalysisStatus =
  | 'ok'
  | 'outside_margin'
  | 'missing_norm'
  | 'missing_km'
  | 'unmatched_fuel'
  | 'unmatched_mileage';

export interface FuelAnalysisInput {
  kilometers: number | null;
  actualLiters: number;
  normLitersPer100Km: number | null;
  marginPct: number;
}

export interface FuelAnalysisComputation {
  expectedLiters: number | null;
  deltaLiters: number | null;
  deltaPct: number | null;
  status: FuelAnalysisStatus;
}

export function computeFuelAnalysis(input: FuelAnalysisInput): FuelAnalysisComputation {
  const actualLiters = finiteOrZero(input.actualLiters);
  const marginPct = Math.max(0, finiteOrZero(input.marginPct));

  if (input.kilometers == null) {
    return { expectedLiters: null, deltaLiters: null, deltaPct: null, status: actualLiters > 0 ? 'missing_km' : 'unmatched_fuel' };
  }

  if (input.normLitersPer100Km == null || !Number.isFinite(input.normLitersPer100Km) || input.normLitersPer100Km <= 0) {
    return { expectedLiters: null, deltaLiters: null, deltaPct: null, status: 'missing_norm' };
  }

  const expectedLiters = round2((Math.max(0, input.kilometers) * input.normLitersPer100Km) / 100);
  const deltaLiters = round2(actualLiters - expectedLiters);
  const deltaPct = expectedLiters > 0 ? round2((deltaLiters / expectedLiters) * 100) : null;
  const status = deltaPct != null && Math.abs(deltaPct) > marginPct ? 'outside_margin' : 'ok';

  return { expectedLiters, deltaLiters, deltaPct, status };
}

export function normalizeVehicleRef(value: string | null | undefined) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isLikelyVehiclePlateReference(value: string | null | undefined) {
  const normalized = normalizeVehicleRef(value);
  return normalized.length >= 5
    && normalized.length <= 8
    && /[A-Z]/.test(normalized)
    && /\d/.test(normalized);
}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/* ─── FuelCardAnalysis page helpers (extracted verbatim from src/pages/FuelCardAnalysis.tsx) ───
 * Pure / deterministic helpers, the conditions config and the workday/distance math used by the
 * fuel-card review page. Moved here so they are unit-testable and the page can shrink. */

export type FuelAnalysisConditions = {
  multiple_same_day_enabled: boolean;
  tank_capacity_enabled: boolean;
  tank_capacity_margin_pct: number;
  consumption_enabled: boolean;
  consumption_margin_pct: number;
  route_consumption_enabled: boolean;
  route_consumption_margin_pct: number;
  route_distance_multiplier: number;
  mileage_jump_enabled: boolean;
  mileage_jump_max_km: number;
};

export const DEFAULT_FUEL_CONDITIONS: FuelAnalysisConditions = {
  multiple_same_day_enabled: true,
  tank_capacity_enabled: true,
  tank_capacity_margin_pct: 10,
  consumption_enabled: true,
  consumption_margin_pct: 10,
  route_consumption_enabled: true,
  route_consumption_margin_pct: 10,
  route_distance_multiplier: 1.25,
  mileage_jump_enabled: true,
  mileage_jump_max_km: 300,
};

export const DEFAULT_WORK_DAYS = ['ma', 'di', 'wo', 'do', 'vr'];
export const DAY_KEY: Record<number, string> = { 0: 'zo', 1: 'ma', 2: 'di', 3: 'wo', 4: 'do', 5: 'vr', 6: 'za' };

export type FuelAnalysisDataQuality = {
  vehiclesTotal: number;
  withoutFuelCard: number;
  withoutTankCapacity: number;
  withoutConsumption: number;
  withoutMileage: number;
  withoutDoors: number;
  withoutSeats: number;
};

export const displayPlate = (t: any): string => {
  const raw = (t?.raw_data?.['Kentekenplaat'] as string | undefined)?.trim();
  if (raw) return raw;
  if (t?.license_plate) return t.license_plate;
  if (t?.vehicles?.license_plate) return t.vehicles.license_plate;
  return '';
};

export const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const coerceConditions = (value: unknown): FuelAnalysisConditions => {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<FuelAnalysisConditions>;
  return {
    multiple_same_day_enabled: raw.multiple_same_day_enabled ?? DEFAULT_FUEL_CONDITIONS.multiple_same_day_enabled,
    tank_capacity_enabled: raw.tank_capacity_enabled ?? DEFAULT_FUEL_CONDITIONS.tank_capacity_enabled,
    tank_capacity_margin_pct: clampNumber(raw.tank_capacity_margin_pct, DEFAULT_FUEL_CONDITIONS.tank_capacity_margin_pct, 0, 100),
    consumption_enabled: raw.consumption_enabled ?? DEFAULT_FUEL_CONDITIONS.consumption_enabled,
    consumption_margin_pct: clampNumber(raw.consumption_margin_pct, DEFAULT_FUEL_CONDITIONS.consumption_margin_pct, 0, 300),
    route_consumption_enabled: raw.route_consumption_enabled ?? DEFAULT_FUEL_CONDITIONS.route_consumption_enabled,
    route_consumption_margin_pct: clampNumber(raw.route_consumption_margin_pct, DEFAULT_FUEL_CONDITIONS.route_consumption_margin_pct, 0, 300),
    route_distance_multiplier: clampNumber(raw.route_distance_multiplier, DEFAULT_FUEL_CONDITIONS.route_distance_multiplier, 1, 2.5),
    mileage_jump_enabled: raw.mileage_jump_enabled ?? DEFAULT_FUEL_CONDITIONS.mileage_jump_enabled,
    mileage_jump_max_km: clampNumber(raw.mileage_jump_max_km, DEFAULT_FUEL_CONDITIONS.mileage_jump_max_km, 1, 5000),
  };
};

export const appendFlagNote = (insert: any, note: string) => {
  insert.flag_notes = [insert.flag_notes, note].filter(Boolean).join('\n');
};

export const isoDate = (date: Date) => format(date, 'yyyy-MM-dd');
export const currentWeekStart = () => isoDate(startOfWeek(new Date(), { weekStartsOn: 1 }));

export const dateInRange = (date: string | null | undefined, start: string, end: string) => {
  if (!date) return false;
  return date >= start && date <= end;
};

export const countWorkDays = (startIso: string, endIso: string, workDays: string[] | null | undefined) => {
  const wanted = new Set((workDays?.length ? workDays : DEFAULT_WORK_DAYS).map(day => day.toLowerCase()));
  let count = 0;
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    if (wanted.has(DAY_KEY[cursor.getDay()])) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

export const haversineKm = (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
