import { describe, it, expect } from 'vitest';
import { scrubText, stripQuery, deepScrub, captureAppException, setObservabilityUser } from '@/lib/observability';

// Deze tests pinnen de PII-scrub vast (privacy-kritisch — Sentry stuurt naar een derde
// partij). Onder vitest is VITE_SENTRY_DSN niet gezet → init is uit, maar de scrub-
// helpers zijn pure functies en blijven testbaar.

describe('scrubText', () => {
  it('maskeert e-mail, IBAN, telefoon en BSN in vrije tekst', () => {
    expect(scrubText('mail jan@example.nl')).toBe('mail [EMAIL]');
    expect(scrubText('IBAN NL91ABNA0417164300 ok')).toContain('[IBAN]');
    expect(scrubText('bel 0612345678')).toContain('[TEL]');
    expect(scrubText('bsn 123456789 fout')).toBe('bsn [BSN] fout');
  });

  it('maskeert IBAN met spaties en +31-telefoon', () => {
    expect(scrubText('NL91 ABNA 0417 1643 00')).toContain('[IBAN]');
    expect(scrubText('+31 6 12 34 56 78')).toContain('[TEL]');
  });

  it('laat niet-strings ongemoeid', () => {
    expect(scrubText(42 as unknown as string)).toBe(42);
    expect(scrubText(null as unknown as string)).toBeNull();
  });
});

describe('stripQuery', () => {
  it('verwijdert de querystring (PII in supabase-filters)', () => {
    expect(stripQuery('https://x.supabase.co/rest/v1/candidates?or=(email.eq.jan@x.nl)&phone=eq.0612345678'))
      .toBe('https://x.supabase.co/rest/v1/candidates');
  });

  it('valt terug op split bij een onparseerbare URL en laat niet-strings staan', () => {
    expect(stripQuery('/rest/v1/x?email=a@b.nl')).toBe('/rest/v1/x');
    expect(stripQuery(undefined)).toBeUndefined();
  });
});

describe('deepScrub', () => {
  it('redact sensitieve sleutels en scrubt PII in waarden', () => {
    const out = deepScrub({ bsn: '123456789', note: 'mail jan@example.nl', nested: { iban: 'x', tel: '0612345678' } });
    expect(out.bsn).toBe('[REDACTED]');
    expect(out.note).toBe('mail [EMAIL]');
    expect(out.nested.iban).toBe('[REDACTED]');
    expect(out.nested.tel).toBe('[TEL]'); // key 'tel' niet sensitief → value-scrub pakt 'm
  });

  it('redact naam- en e-mail-sleutels', () => {
    const out = deepScrub({ first_name: 'Jan', last_name: 'Jansen', email: 'jan@x.nl', age: 30 });
    expect(out.first_name).toBe('[REDACTED]');
    expect(out.last_name).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.age).toBe(30);
  });

  it('laat Date en andere niet-plain objecten heel (geen {}-corruptie)', () => {
    const d = new Date('2026-06-28T00:00:00Z');
    const out = deepScrub({ when: d, list: [1, 'jan@x.nl'] });
    expect(out.when).toBe(d);
    expect(out.list).toEqual([1, '[EMAIL]']);
  });
});

describe('no-op zonder DSN', () => {
  it('captureAppException en setObservabilityUser throwen niet', () => {
    expect(() => captureAppException(new Error('x'), { foo: 'bar' })).not.toThrow();
    expect(() => setObservabilityUser('u1', 'org1')).not.toThrow();
    expect(() => setObservabilityUser(null)).not.toThrow();
  });
});
