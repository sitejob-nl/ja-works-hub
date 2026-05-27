export type DomainType = 'exact' | 'wildcard';
export type DomainStatus = 'pending' | 'verified' | 'misconfigured' | 'error' | 'removed';

export type PublicDomain = {
  organization_id?: string;
  domain: string;
  domain_type: DomainType;
  primary_hostname?: string | null;
  is_primary?: boolean;
  status?: DomainStatus | string;
};

export function normalizeHost(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
    .replace(/:\d+$/, '');
}

export function normalizeDomainInput(value: string, type: DomainType): string {
  const host = normalizeHost(value);
  if (type === 'wildcard' && host && !host.startsWith('*.')) return `*.${host}`;
  return host;
}

export function apexFromDomain(domain: string): string {
  const clean = normalizeHost(domain).replace(/^\*\./, '');
  const parts = clean.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : clean;
}

export function defaultPrimaryHostname(domain: string, type: DomainType): string {
  const clean = normalizeHost(domain);
  return type === 'wildcard' ? `app.${clean.replace(/^\*\./, '')}` : clean;
}

export function domainMatchesHost(domain: Pick<PublicDomain, 'domain' | 'domain_type'>, hostValue: string): boolean {
  const host = normalizeHost(hostValue);
  const domainName = normalizeHost(domain.domain);
  if (!host || !domainName) return false;
  if (host === domainName) return true;
  if (domain.domain_type !== 'wildcard') return false;

  const suffix = domainName.replace(/^\*\./, '');
  return host !== suffix && host.endsWith(`.${suffix}`);
}

export function resolveHostDomain(domains: PublicDomain[], hostValue: string): PublicDomain | null {
  const verified = domains.filter((domain) => domain.status === 'verified');
  const exact = verified.find((domain) => normalizeHost(domain.domain) === normalizeHost(hostValue));
  if (exact) return exact;

  return verified
    .filter((domain) => domain.domain_type === 'wildcard' && domainMatchesHost(domain, hostValue))
    .sort((a, b) => apexFromDomain(b.domain).length - apexFromDomain(a.domain).length)[0] ?? null;
}

export function publicBaseUrlForDomain(domain: PublicDomain | null, fallbackOrigin?: string): string {
  const hostname = normalizeHost(domain?.primary_hostname || domain?.domain.replace(/^\*\./, 'app.'));
  if (hostname) return `https://${hostname}`;
  const fallback = fallbackOrigin?.replace(/\/+$/, '');
  if (fallback) return fallback;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function buildPublicUrl(path: string, domain: PublicDomain | null, fallbackOrigin?: string): string {
  const base = publicBaseUrlForDomain(domain, fallbackOrigin);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${cleanPath}`;
}
