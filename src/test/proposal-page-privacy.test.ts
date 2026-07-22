import { describe, expect, it } from 'vitest';
import {
  buildClientSummary,
  clientSafeSummary,
  isInternalMatchReasoning,
  resolvePublicProposalPage,
} from '../../supabase/functions/_shared/proposal-page';

describe('public proposal page privacy', () => {
  it('stuurt inhoud van verborgen secties niet naar de publieke browser', () => {
    const result = resolvePublicProposalPage({
      proposal_page: {
        title: 'Kandidaatvoorstel',
        intro: 'Bekijk het voorstel.',
        sections: { summary: true, riskFactors: false, cv: false },
        content: {
          summary: { title: 'Samenvatting', body: 'Geschikte kandidaat.' },
          riskFactors: { title: 'Intern', body: 'Niet delen met klant.' },
          cv: { title: 'CV', body: 'Privébestand.' },
        },
      },
    });

    expect(result.sectionEnabled('summary')).toBe(true);
    expect(result.sectionEnabled('riskFactors')).toBe(false);
    expect(result.sectionEnabled('cv')).toBe(false);
    expect(result.proposalPage.content).toEqual({
      summary: { title: 'Samenvatting', body: 'Geschikte kandidaat.' },
    });
  });

  it('respecteert de oude hideReport-schakelaar', () => {
    const result = resolvePublicProposalPage({ sections: { hideReport: true, summary: true } });
    expect(result.sectionEnabled('summary')).toBe(false);
  });
});

describe('klantveilige samenvatting', () => {
  it('herkent interne matcher-reasoning en filtert die weg', () => {
    const reasoning = '30% match. Geen sterke matchsignalen. Blokkers: Mist certificaat: VCA';
    expect(isInternalMatchReasoning(reasoning)).toBe(true);
    expect(clientSafeSummary(reasoning)).toBeNull();
    expect(clientSafeSummary('  ')).toBeNull();
    expect(clientSafeSummary(null)).toBeNull();
  });

  it('laat een echte AI-samenvatting door', () => {
    const summary = 'Ervaren operator met VCA en heftruckcertificaat, per direct beschikbaar.';
    expect(isInternalMatchReasoning(summary)).toBe(false);
    expect(clientSafeSummary(summary)).toBe(summary);
  });

  it('bouwt een neutrale intro zonder score of blokkers', () => {
    const text = buildClientSummary({
      most_recent_role: 'Productiemedewerker',
      skills: ['inpakken', 'orderpicken'],
      certifications: ['VCA'],
      languages: ['Pools', 'Engels'],
      address_city: 'Weert',
      has_drivers_license: true,
    }, 'Milan Horvath');
    expect(text).toContain('Milan is een Productiemedewerker-profiel');
    expect(text).toContain('inpakken en orderpicken');
    expect(text).toContain('VCA');
    expect(text).not.toMatch(/%|blokker/i);
  });
});
