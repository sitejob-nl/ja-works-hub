import { describe, expect, it } from 'vitest';
import { isValidBsn, isValidIban } from '@/lib/nl-validate';

describe('isValidBsn (elfproef)', () => {
  it('accepteert geldige BSN-nummers', () => {
    expect(isValidBsn('111222333')).toBe(true);
    expect(isValidBsn('123456782')).toBe(true);
  });

  it('weigert ongeldige of onvolledige nummers', () => {
    expect(isValidBsn('123456789')).toBe(false); // elfproef faalt
    expect(isValidBsn('12345678')).toBe(false); // 8 cijfers
    expect(isValidBsn('1234567890')).toBe(false); // 10 cijfers
    expect(isValidBsn('')).toBe(false);
    expect(isValidBsn('abcdefghi')).toBe(false);
  });

  it('negeert spaties en scheidingstekens', () => {
    expect(isValidBsn('111 222 333')).toBe(true);
  });
});

describe('isValidIban (mod-97)', () => {
  it('accepteert geldige IBANs, ook met spaties en kleine letters', () => {
    expect(isValidIban('NL02ABNA0123456789')).toBe(true);
    expect(isValidIban('nl02 abna 0123 4567 89')).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('BE68539007547034')).toBe(true);
  });

  it('weigert ongeldige IBANs', () => {
    expect(isValidIban('NL02ABNA0123456788')).toBe(false); // checksum fout
    expect(isValidIban('NL02ABNA')).toBe(false); // te kort
    expect(isValidIban('')).toBe(false);
    expect(isValidIban('1234567890')).toBe(false);
  });
});
