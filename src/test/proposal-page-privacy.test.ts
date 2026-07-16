import { describe, expect, it } from 'vitest';
import { resolvePublicProposalPage } from '../../supabase/functions/_shared/proposal-page';

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
