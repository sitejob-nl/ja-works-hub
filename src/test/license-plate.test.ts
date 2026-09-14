import { describe, expect, it } from 'vitest';
import { formatLicensePlate, requireLicensePlate } from '@/lib/license-plate';

describe('kenteken schrijfwijze', () => {
  it.each([
    'AB-12-34', '12-34-AB', '12-AB-34', 'AB-12-CD', 'AB-CD-12', '12-AB-CD',
    '12-ABC-3', '2-TLH-29', 'AB-123-C', 'A-123-BC', 'GBB-01-B', 'V-12-ABC',
    '1-AB-234', '123-AB-4',
  ])('normaliseert %s met behoud van de cijfer/lettervolgorde', (plate) => {
    expect(formatLicensePlate(plate.toLowerCase().replaceAll('-', ' '))).toBe(plate);
    expect(formatLicensePlate(plate.replaceAll('-', ''))).toBe(plate);
    expect(formatLicensePlate(plate)).toBe(plate);
  });
  it.each(['', '2TLH2', '2TLH299', '2.TLH.29', '2/TLH/29', 'ABCDEF', '123456', '<2TLH29>'])('weigert onvolledige/ongeldige invoer %s', (value) => {
    expect(formatLicensePlate(value)).toBeNull();
    expect(() => requireLicensePlate(value)).toThrow('Vul een Nederlands kenteken');
  });
  it('slaat de voorbeeldinvoer in de vaste schrijfwijze op', () => {
    expect(requireLicensePlate(' 2tlh29 ')).toBe('2-TLH-29');
  });
});
