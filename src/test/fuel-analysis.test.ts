import { describe, expect, it } from 'vitest';
import { isLikelyVehiclePlateReference, normalizeVehicleRef } from '@/lib/fuel-analysis';

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
