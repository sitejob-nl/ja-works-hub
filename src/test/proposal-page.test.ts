import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPOSAL_PAGE_CONFIG,
  mergeProposalPageConfig,
  proposalListFromText,
} from '@/lib/proposal-page';

describe('proposal page configuration', () => {
  it('houdt privacygevoelige aandachtspunten standaard verborgen', () => {
    expect(DEFAULT_PROPOSAL_PAGE_CONFIG.sections.riskFactors).toBe(false);
  });

  it('vult een gedeeltelijke snapshot veilig aan met defaults', () => {
    const config = mergeProposalPageConfig({
      title: 'Voorstel voor ploeg B',
      sections: { skills: false },
      content: { summary: { title: 'Waarom passend', body: 'Direct inzetbaar.' } },
    });

    expect(config.title).toBe('Voorstel voor ploeg B');
    expect(config.sections.skills).toBe(false);
    expect(config.sections.cv).toBe(true);
    expect(config.content.summary).toEqual({ title: 'Waarom passend', body: 'Direct inzetbaar.' });
    expect(config.content.cv.title).toBe('CV');
  });

  it('zet bewerkbare lijsten om naar opgeschoonde waarden', () => {
    expect(proposalListFromText('- MIG/MAG\n• VCA; Heftruck')).toEqual(['MIG/MAG', 'VCA', 'Heftruck']);
  });
});
