// Client-side mirror of the Supabase Auth password policy configured in the dashboard:
// minimum 8 characters + at least one lowercase letter, uppercase letter, digit and symbol.
// The leaked-password (HaveIBeenPwned) check is enforced server-side only — see
// supabase/functions/_shared/password-policy.ts. Keep the two in sync.

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordChecks {
  length: boolean;
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
}

export function checkPassword(password: string): PasswordChecks {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const c = checkPassword(password);
  return c.length && c.lower && c.upper && c.digit && c.symbol;
}
