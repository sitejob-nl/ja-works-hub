// Server-side password policy for flows that create users via the admin API
// (`auth.admin.createUser`) — which BYPASSES the GoTrue password strength + leaked-password
// settings configured in the dashboard. Used by portal-activate, client-portal-activate and
// register-organization so weak/leaked passwords are actually rejected on those paths.
//
// Mirrors the dashboard Auth policy: min 8 chars + lowercase/uppercase/digit/symbol, and
// replicates the HaveIBeenPwned leaked-password check via the k-anonymity range API.
// Keep the complexity rules in sync with src/lib/password-policy.ts.

export const PASSWORD_MIN_LENGTH = 8;

type Lang = 'nl' | 'en';

const MESSAGES: Record<Lang, Record<string, string>> = {
  nl: {
    missing: 'Wachtwoord is verplicht',
    length: `Wachtwoord moet minimaal ${PASSWORD_MIN_LENGTH} tekens bevatten`,
    lower: 'Wachtwoord moet minimaal één kleine letter bevatten',
    upper: 'Wachtwoord moet minimaal één hoofdletter bevatten',
    digit: 'Wachtwoord moet minimaal één cijfer bevatten',
    symbol: 'Wachtwoord moet minimaal één symbool bevatten',
    leaked: 'Dit wachtwoord komt voor in bekende datalekken. Kies een ander, uniek wachtwoord.',
  },
  en: {
    missing: 'Password is required',
    length: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    lower: 'Password must contain at least one lowercase letter',
    upper: 'Password must contain at least one uppercase letter',
    digit: 'Password must contain at least one digit',
    symbol: 'Password must contain at least one symbol',
    leaked: 'This password appears in known data breaches. Choose a different, unique password.',
  },
};

/** Returns an error message (in `lang`) if the password fails the complexity policy, else null. */
export function validatePasswordStrength(password: unknown, lang: Lang = 'nl'): string | null {
  const m = MESSAGES[lang] ?? MESSAGES.nl;
  if (typeof password !== 'string' || password.length === 0) return m.missing;
  if (password.length < PASSWORD_MIN_LENGTH) return m.length;
  if (!/[a-z]/.test(password)) return m.lower;
  if (!/[A-Z]/.test(password)) return m.upper;
  if (!/[0-9]/.test(password)) return m.digit;
  if (!/[^A-Za-z0-9]/.test(password)) return m.symbol;
  return null;
}

/**
 * HaveIBeenPwned Pwned Passwords lookup via k-anonymity (only the first 5 chars of the
 * SHA-1 hash leave the server). Fails OPEN on any error so a HIBP outage never blocks a
 * legitimate signup — the complexity policy above still applies.
 */
export async function isPasswordLeaked(password: string): Promise<boolean> {
  try {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body
      .split('\n')
      .some((line) => line.split(':')[0].trim().toUpperCase() === suffix);
  } catch {
    return false;
  }
}

/** Full policy check (complexity + leaked). Returns an error message, or null if acceptable. */
export async function assertPasswordAcceptable(
  password: unknown,
  lang: Lang = 'nl',
): Promise<string | null> {
  const strengthError = validatePasswordStrength(password, lang);
  if (strengthError) return strengthError;
  if (await isPasswordLeaked(password as string)) return (MESSAGES[lang] ?? MESSAGES.nl).leaked;
  return null;
}
