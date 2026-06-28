import { describe, expect, it } from 'vitest';
import {
  isLikelyVehiclePlateReference, normalizeVehicleRef, countWorkDays, coerceConditions,
  clampNumber, dateInRange, displayPlate, haversineKm, DEFAULT_FUEL_CONDITIONS,
} from '@/lib/fuel-analysis';

describe('fuel analysis vehicle references', () => {
  it('normalizes Dutch license plate-like references', () => {
    expect(normalizeVehicleRef('GLL-59-L')).toBe('GLL59L');
    expect(normalizeVehicleRef('J090TL')).toBe('J090TL');
  });

  it('separates license plates from generic fuel card labels', () => {
    expect(isLikelyVehiclePlateReference('GLL-59-L')).toBe(true);
    expect(isLikelyVehiclePlateReference('TX780K')).toBe(true);
    expect(isLikelyVehiclePlateReference('VARIERENDE TANKPAS 2.0')).toBe(false);
    expect(isLikelyVehiclePlateReference('ALGEMENE TANKPAS')).toBe(false);
  });
});

describe('countWorkDays', () => {
  // Any 7 consecutive days form one full week, so these hold regardless of the calendar weekday.
  it('counts 5 default workdays (Mon–Fri) in any 7-day span', () => {
    expect(countWorkDays('2026-06-01', '2026-06-07', null)).toBe(5);
    expect(countWorkDays('2026-06-01', '2026-06-14', null)).toBe(10); // two weeks
  });
  it('respects a custom workday set', () => {
    expect(countWorkDays('2026-06-01', '2026-06-07', ['ma', 'wo', 'vr'])).toBe(3);
  });
  it('is inclusive of both endpoints', () => {
    const allDays = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
    expect(countWorkDays('2026-06-10', '2026-06-10', allDays)).toBe(1);
    expect(countWorkDays('2026-06-01', '2026-06-07', allDays)).toBe(7);
  });
});

describe('clampNumber', () => {
  it('clamps within range', () => {
    expect(clampNumber(50, 10, 0, 100)).toBe(50);
    expect(clampNumber(150, 10, 0, 100)).toBe(100);
    expect(clampNumber(-5, 10, 0, 100)).toBe(0);
  });
  it('falls back on non-numeric (NaN) input', () => {
    expect(clampNumber('abc', 10, 0, 100)).toBe(10);
    expect(clampNumber(undefined, 3, 0, 100)).toBe(3);
  });
  it('coerces null to 0 (Number(null) === 0 is finite, so it clamps instead of falling back)', () => {
    expect(clampNumber(null, 7, 0, 100)).toBe(0);
  });
});

describe('coerceConditions', () => {
  it('returns defaults for empty/invalid input', () => {
    expect(coerceConditions(null)).toEqual(DEFAULT_FUEL_CONDITIONS);
    expect(coerceConditions('nope')).toEqual(DEFAULT_FUEL_CONDITIONS);
  });
  it('merges provided values and clamps out-of-range numbers', () => {
    const c = coerceConditions({ tank_capacity_margin_pct: 999, consumption_enabled: false });
    expect(c.tank_capacity_margin_pct).toBe(100); // clamped to max
    expect(c.consumption_enabled).toBe(false);
    expect(c.mileage_jump_max_km).toBe(DEFAULT_FUEL_CONDITIONS.mileage_jump_max_km);
  });
});

describe('dateInRange', () => {
  it('is inclusive of the boundaries', () => {
    expect(dateInRange('2026-06-15', '2026-06-01', '2026-06-30')).toBe(true);
    expect(dateInRange('2026-06-01', '2026-06-01', '2026-06-30')).toBe(true);
    expect(dateInRange('2026-06-30', '2026-06-01', '2026-06-30')).toBe(true);
    expect(dateInRange('2026-07-01', '2026-06-01', '2026-06-30')).toBe(false);
  });
  it('returns false for missing dates', () => {
    expect(dateInRange(null, '2026-06-01', '2026-06-30')).toBe(false);
    expect(dateInRange(undefined, '2026-06-01', '2026-06-30')).toBe(false);
  });
});

describe('displayPlate', () => {
  it('prefers the raw Q8 plate, then license_plate, then the matched vehicle plate', () => {
    expect(displayPlate({ raw_data: { Kentekenplaat: ' GLL-59-L ' } })).toBe('GLL-59-L');
    expect(displayPlate({ license_plate: 'AB-12-CD' })).toBe('AB-12-CD');
    expect(displayPlate({ vehicles: { license_plate: 'XY-99-ZZ' } })).toBe('XY-99-ZZ');
    expect(displayPlate({})).toBe('');
  });
});

describe('haversineKm', () => {
  it('is ~0 for identical points', () => {
    expect(haversineKm(51.44, 5.48, 51.44, 5.48)).toBeCloseTo(0, 5);
  });
  it('approximates Eindhoven–Amsterdam (~110 km)', () => {
    const d = haversineKm(51.44, 5.47, 52.37, 4.90);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});
