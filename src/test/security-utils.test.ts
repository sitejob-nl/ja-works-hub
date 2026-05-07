// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { redactAuditValues } from '@/lib/audit-redaction';
import { sanitizeHtml } from '@/lib/sanitize-html';

describe('security utilities', () => {
  it('redacts sensitive audit keys recursively', () => {
    expect(redactAuditValues({
      name: 'Jan',
      bsn: '123456789',
      nested: {
        iban: 'NL00TEST0123456789',
        access_token: 'secret',
      },
    })).toEqual({
      name: 'Jan',
      bsn: '[REDACTED]',
      nested: {
        iban: '[REDACTED]',
        access_token: '[REDACTED]',
      },
    });
  });

  it('removes script tags and event handlers from html previews', () => {
    const html = sanitizeHtml('<p onclick="alert(1)">Hoi</p><script>alert(1)</script>');
    expect(html).toContain('<p>Hoi</p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('script');
  });
});
