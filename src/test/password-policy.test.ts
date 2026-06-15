import { describe, it, expect } from 'vitest';
import { checkPassword, isPasswordValid, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

describe('password-policy', () => {
  it('uses a minimum length of 8 (matches Supabase Auth)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('accepts a password meeting every rule', () => {
    expect(isPasswordValid('Abcdef1!')).toBe(true);
    expect(checkPassword('Abcdef1!')).toEqual({
      length: true, lower: true, upper: true, digit: true, symbol: true,
    });
  });

  it('rejects a too-short password even if it has all classes', () => {
    expect(isPasswordValid('Ab1!xy')).toBe(false); // 6 chars
    expect(checkPassword('Ab1!xy').length).toBe(false);
  });

  it('requires each character class', () => {
    expect(isPasswordValid('abcdef1!')).toBe(false); // no uppercase
    expect(isPasswordValid('ABCDEF1!')).toBe(false); // no lowercase
    expect(isPasswordValid('Abcdefg!')).toBe(false); // no digit
    expect(isPasswordValid('Abcdefg1')).toBe(false); // no symbol
  });
});
