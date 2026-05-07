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

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}
