const SENSITIVE_KEY_PATTERNS = [
  /(^|_)bsn($|_)/i,
  /(^|_)iban($|_)/i,
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
];

const REDACTED = '[REDACTED]';

const isSensitiveKey = (key: string) =>
  SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

export function redactAuditValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValues(item)) as T;
  }

  if (!value || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactAuditValues(item);
  }
  return redacted as T;
}
