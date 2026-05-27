import { describe, expect, it } from 'vitest';
import {
  apexFromDomain,
  buildPublicUrl,
  defaultPrimaryHostname,
  domainMatchesHost,
  normalizeDomainInput,
  normalizeHost,
  resolveHostDomain,
} from './public-url';

describe('public-url helpers', () => {
  it('normalizes hosts and wildcard input', () => {
    expect(normalizeHost('https://App.Example.com/path')).toBe('app.example.com');
    expect(normalizeDomainInput('example.com', 'wildcard')).toBe('*.example.com');
    expect(normalizeDomainInput('*.Example.com', 'wildcard')).toBe('*.example.com');
  });

  it('derives apex and default primary hostname', () => {
    expect(apexFromDomain('*.customer.example.com')).toBe('customer.example.com');
    expect(defaultPrimaryHostname('*.example.com', 'wildcard')).toBe('app.example.com');
    expect(defaultPrimaryHostname('portal.example.com', 'exact')).toBe('portal.example.com');
  });

  it('matches exact and wildcard domains', () => {
    expect(domainMatchesHost({ domain: 'app.example.com', domain_type: 'exact' }, 'app.example.com')).toBe(true);
    expect(domainMatchesHost({ domain: '*.example.com', domain_type: 'wildcard' }, 'portal.example.com')).toBe(true);
    expect(domainMatchesHost({ domain: '*.example.com', domain_type: 'wildcard' }, 'example.com')).toBe(false);
  });

  it('prefers exact match over wildcard match', () => {
    const domains = [
      { domain: '*.example.com', domain_type: 'wildcard' as const, primary_hostname: 'app.example.com', status: 'verified' },
      { domain: 'portal.example.com', domain_type: 'exact' as const, primary_hostname: 'portal.example.com', status: 'verified' },
    ];
    expect(resolveHostDomain(domains, 'portal.example.com')?.domain).toBe('portal.example.com');
  });

  it('builds URLs from primary hostnames without duplicate slashes', () => {
    const domain = { domain: '*.example.com', domain_type: 'wildcard' as const, primary_hostname: 'app.example.com', status: 'verified' };
    expect(buildPublicUrl('/portaal/activeren/abc', domain, 'http://localhost:8080')).toBe('https://app.example.com/portaal/activeren/abc');
    expect(buildPublicUrl('profiel/abc', null, 'http://localhost:8080/')).toBe('http://localhost:8080/profiel/abc');
  });
});
