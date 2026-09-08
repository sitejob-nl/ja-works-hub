import { describe, expect, it } from 'vitest';
import { getPortalLoginPath, getPortalReturnPath } from '@/lib/portal-return-path';

describe('portal return paths', () => {
  it.each([
    '/portaal',
    '/portaal/',
    '/portaal/uren/weken',
    '/portaal/uren/week/a5d6cf17-d553-491a-8950-d3e47e36939b',
    '/portaal/uren/weken?week=2026-12-28&plaatsing=abc&tab=teruggezet',
  ])('preserves the internal route %s', (path) => {
    expect(getPortalReturnPath(path)).toBe(path);
  });

  it.each([
    null, undefined, '',
    'https://example.com/portaal',
    '//example.com/portaal',
    'javascript:alert(1)',
    '/uren', '/portaal-ander/uren', '/PORTAAL/uren',
    '/portaal//example.com', '/portaal/../superadmin', '/portaal/./uren',
    '/portaal\\example.com', '/\\example.com',
    '/portaal/%2e%2e/superadmin', '/portaal/%252e%252e/superadmin',
    '/portaal/%2F%2Fevil', '/portaal/%5cevil', '/portaal/%255cevil',
    '%2Fportaal%2Furen', '/portaal/%', '/portaal/%0d%0aevil',
    '/portaal/uren\n', ' /portaal/uren', '/portaal/uren\t',
    '/portaal/login', '/portaal/login?returnTo=/portaal',
    '/portaal/activeren/token', '/portaal/uren#fragment',
  ])('falls back safely for %s', (path) => {
    expect(getPortalReturnPath(path)).toBe('/portaal');
  });

  it('round-trips a week deep link and its complete query through login', () => {
    const pathname = '/portaal/uren/week/a5d6cf17-d553-491a-8950-d3e47e36939b';
    const search = '?revision=3&week=2026-12-28&label=week%203&filter=a%26b';
    const login = new URL(getPortalLoginPath(pathname, search), 'https://app.jawerkt.nl');

    expect(login.pathname).toBe('/portaal/login');
    expect(getPortalReturnPath(login.searchParams.get('returnTo'))).toBe(pathname + search);
    expect([...login.searchParams.keys()]).toEqual(['returnTo']);
  });

  it('treats query values as data without changing the internal destination', () => {
    const path = '/portaal/uren/weken?label=https%3A%2F%2Fexample.com';
    expect(getPortalReturnPath(path)).toBe(path);
  });
});
