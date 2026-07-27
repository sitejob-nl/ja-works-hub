import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERCEL_NAMESERVERS,
  buildInstructionText,
  dnsInstructions,
} from '../../supabase/functions/_shared/domain-instructions';

/**
 * Deze instructies gaan per mail naar een externe DNS-beheerder. Een fout is stil: een
 * verkeerd record levert geen foutmelding op, alleen een domein dat nooit gaat werken.
 */
describe('dnsInstructions', () => {
  it('geeft een CNAME voor een subdomein', () => {
    const result = dnsInstructions('app.klant.nl', 'exact', 'app.klant.nl', null, null);

    expect(result.kind).toBe('exact');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ type: 'CNAME', name: 'app.klant.nl', value: 'cname.vercel-dns.com' });
    expect(result.nameservers).toBeUndefined();
  });

  it('geeft een A-record voor een apex-domein, want een CNAME mag daar niet', () => {
    const result = dnsInstructions('klant.nl', 'exact', 'klant.nl', null, null);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ type: 'A', name: '@' });
  });

  describe('wildcard', () => {
    // Vercel geeft alleen een wildcard-certificaat uit als het de nameservers beheert;
    // met losse CNAME-records komt er nooit een certificaat.
    it('vraagt nameservers en géén zone-records', () => {
      const result = dnsInstructions('*.klant.nl', 'wildcard', 'app.klant.nl', null, null);

      expect(result.kind).toBe('wildcard');
      expect(result.records).toEqual([]);
      expect(result.nameservers).toEqual(DEFAULT_VERCEL_NAMESERVERS);
    });

    it('gebruikt de nameservers die Vercel zelf opgeeft boven de fallback', () => {
      const result = dnsInstructions('*.klant.nl', 'wildcard', 'app.klant.nl', null, {
        intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com', 'ns3.vercel-dns.com'],
      });

      expect(result.nameservers).toEqual(['ns1.vercel-dns.com', 'ns2.vercel-dns.com', 'ns3.vercel-dns.com']);
    });

    it('waarschuwt over e-mail, want een nameserver-wissel laat de hele zone vervallen', () => {
      const { warning } = dnsInstructions('*.klant.nl', 'wildcard', 'app.klant.nl', null, null);

      expect(warning).toMatch(/MX/);
      expect(warning).toMatch(/e-mail/i);
      expect(warning).toMatch(/exact/i);
    });
  });

  it('neemt de verificatie-records van Vercel over', () => {
    const verification = [{ type: 'TXT', domain: '_vercel.klant.nl', value: 'vc-domain-verify=...' }];
    const result = dnsInstructions('app.klant.nl', 'exact', 'app.klant.nl', { verification }, null);

    expect(result.verification).toEqual(verification);
  });

  it('valt terug op een lege verificatielijst als Vercel niets teruggeeft', () => {
    expect(dnsInstructions('app.klant.nl', 'exact', 'app.klant.nl', null, null).verification).toEqual([]);
  });
});

describe('buildInstructionText', () => {
  const exactRow = {
    domain: 'app.klant.nl',
    apex_domain: 'klant.nl',
    domain_type: 'exact',
    primary_hostname: 'app.klant.nl',
    dns_config: {
      instructions: dnsInstructions('app.klant.nl', 'exact', 'app.klant.nl', null, null),
    },
  };

  it('noemt hostname, zone en het volledige record', () => {
    const text = buildInstructionText(exactRow, 'Klant BV');

    expect(text).toContain('app.klant.nl');
    expect(text).toContain('klant.nl');
    expect(text).toContain('cname.vercel-dns.com');
    expect(text).toContain('Klant BV');
  });

  it('waarschuwt bij een exact domein over proxy/CDN maar niet over uitvallende mail', () => {
    const text = buildInstructionText(exactRow, 'Klant BV');

    expect(text).toMatch(/proxy/i);
    expect(text).toContain('blijven ongewijzigd');
  });

  it('geeft bij een wildcard nameservers en de mail-waarschuwing, geen records', () => {
    const text = buildInstructionText(
      {
        domain: '*.klant.nl',
        apex_domain: 'klant.nl',
        domain_type: 'wildcard',
        primary_hostname: 'app.klant.nl',
        dns_config: {
          instructions: dnsInstructions('*.klant.nl', 'wildcard', 'app.klant.nl', null, null),
        },
      },
      'Klant BV',
    );

    expect(text).toMatch(/nameservers/i);
    expect(text).toContain('ns1.vercel-dns.com');
    expect(text).toMatch(/registrar/i);
    expect(text).toMatch(/valt e-mail op dit domein uit/i);
    expect(text).not.toContain('cname.vercel-dns.com');
  });

  it('neemt verificatie-records op wanneer Vercel die vraagt', () => {
    const text = buildInstructionText(
      {
        domain: 'app.klant.nl',
        apex_domain: 'klant.nl',
        domain_type: 'exact',
        primary_hostname: 'app.klant.nl',
        dns_config: {
          instructions: dnsInstructions('app.klant.nl', 'exact', 'app.klant.nl', {
            verification: [{ type: 'TXT', name: '_vercel.klant.nl', value: 'vc-domain-verify=abc' }],
          }, null),
        },
      },
      'Klant BV',
    );

    expect(text).toContain('vc-domain-verify=abc');
  });
});
